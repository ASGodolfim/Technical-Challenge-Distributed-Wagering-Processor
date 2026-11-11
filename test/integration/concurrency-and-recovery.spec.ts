import * as crypto from 'crypto';
import {
    createAppInstance,
    ensureSqsQueueExists,
    assertWalletLedgerInvariant,
    TestAppInstance,
} from './test-helpers';
import { WalletLedgerEntryEntity } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WagerTransactionEntity } from '../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { OutboxMessageEntity } from '../../src/infrastructure/persistence/entities/outbox-message.entity';
import { InboxMessageEntity } from '../../src/infrastructure/persistence/entities/inbox-message.entity';
import { SqsConsumerService } from '../../src/infrastructure/messaging/sqs-consumer.service';
import { PendingReferenceWorkerService } from '../../src/infrastructure/messaging/pending-reference-worker.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { sqsClient } from '../../src/infrastructure/messaging/sqs.client';
import {
    SendMessageCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

describe('Concorrência Real, Multi-Instância & Crash Recovery', () => {
    let instances: TestAppInstance[] = [];
    let queueUrl: string;

    beforeAll(async () => {
        queueUrl = await ensureSqsQueueExists();
        const app1 = await createAppInstance();
        const app2 = await createAppInstance();
        const app3 = await createAppInstance();
        instances = [app1, app2, app3];

        for (const inst of instances) {
            const scheduler = inst.app.get(SchedulerRegistry);
            scheduler.getCronJobs().forEach((job) => job.stop());
        }
    });

    afterAll(async () => {
        for (const inst of instances) {
            await inst.app.close();
        }
    });

    async function createTestWallet(baseUrl: string, initialAmount: string) {
        const playerId = crypto.randomUUID();
        const res = await fetch(`${baseUrl}/wallets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId,
                initialBalance: { amount: initialAmount, currency: 'BRL' },
            }),
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        return { walletId: data.id as string, playerId };
    }

    test('Concorrência 1: 50 requisições simultâneas idênticas devem gerar apenas 1 débito', async () => {
        const primary = instances[0];
        const { walletId, playerId } = await createTestWallet(primary.baseUrl, '500.00');

        const sharedIdempotencyKey = `idem-50x-${crypto.randomUUID()}`;
        const sharedExternalTxId = `ext-50x-${crypto.randomUUID()}`;
        const payload = {
            providerId: 'pragmatic',
            externalTransactionId: sharedExternalTxId,
            playerId,
            walletId,
            roundId: crypto.randomUUID(),
            gameId: 'gates-of-olympus',
            kind: 'BET',
            money: { amount: '25.00', currency: 'BRL' },
        };

        const responses = await Promise.all(
            Array.from({ length: 50 }, () =>
                fetch(`${primary.baseUrl}/wagering/transactions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Idempotency-Key': sharedIdempotencyKey,
                    },
                    body: JSON.stringify(payload),
                }).then((r) => r.json()),
            ),
        );

        const originals = responses.filter((r) => r.idempotentReplay === false);
        const replays = responses.filter((r) => r.idempotentReplay === true);

        expect(originals.length).toBe(1);
        expect(replays.length).toBe(49);

        const uniqueTxIds = new Set(responses.map((r) => r.transactionId));
        expect(uniqueTxIds.size).toBe(1);
        expect(originals[0].balance.amount).toBe('475.00');

        const fork = primary.em.fork();
        const debitEntries = await fork.find(WalletLedgerEntryEntity, {
            walletId,
            direction: 'DEBIT',
        });
        expect(debitEntries.length).toBe(1);

        await assertWalletLedgerInvariant(primary.em, walletId, primary.baseUrl);
    });

    test('Concorrência 2 (Race Condition): Saldo R$ 100,00 com 2 apostas simultâneas de R$ 80,00 -> 1 PROCESSED, 1 REJECTED, saldo R$ 20,00', async () => {
        const primary = instances[0];
        const { walletId, playerId } = await createTestWallet(primary.baseUrl, '100.00');
        const roundId = `round-${crypto.randomUUID()}`;

        const bet1 = {
            providerId: 'evolution',
            externalTransactionId: `ext-race-1-${crypto.randomUUID()}`,
            playerId,
            walletId,
            roundId: crypto.randomUUID(),
            gameId: 'crazy-time',
            kind: 'BET',
            money: { amount: '80.00', currency: 'BRL' },
        };

        const bet2 = {
            providerId: 'evolution',
            externalTransactionId: `ext-race-2-${crypto.randomUUID()}`,
            playerId,
            walletId,
            roundId: crypto.randomUUID(),
            gameId: 'crazy-time',
            kind: 'BET',
            money: { amount: '80.00', currency: 'BRL' },
        };

        const [res1, res2] = await Promise.all([
            fetch(`${primary.baseUrl}/wagering/transactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': `idem-race-1-${crypto.randomUUID()}`,
                },
                body: JSON.stringify(bet1),
            }).then((r) => r.json()),
            fetch(`${primary.baseUrl}/wagering/transactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': `idem-race-2-${crypto.randomUUID()}`,
                },
                body: JSON.stringify(bet2),
            }).then((r) => r.json()),
        ]);

        const results = [res1, res2];
        const processed = results.filter((r) => r.status === 'PROCESSED');
        const rejected = results.filter((r) => r.status === 'REJECTED');

        expect(processed.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect(rejected[0].failureCode).toBe('INSUFFICIENT_FUNDS');

        const walletRes = await fetch(`${primary.baseUrl}/wallets/${walletId}`).then((r) => r.json());
        expect(walletRes.balance.amount).toBe('20.00');

        await assertWalletLedgerInvariant(primary.em, walletId, primary.baseUrl);
    });

    test('Concorrência 3 (Multi-Instância): 3 instâncias NestJS disputando a mesma wallet com 30 apostas simultâneas', async () => {
        const [inst1, inst2, inst3] = instances;
        const { walletId, playerId } = await createTestWallet(inst1.baseUrl, '1000.00');

        const requests = Array.from({ length: 30 }, (_, index) => {
            const targetInstance = instances[index % 3];
            return fetch(`${targetInstance.baseUrl}/wagering/transactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': `idem-multi-${index}-${crypto.randomUUID()}`,
                },
                body: JSON.stringify({
                    providerId: 'hacksaw',
                    externalTransactionId: `ext-multi-${index}-${crypto.randomUUID()}`,
                    playerId,
                    walletId,
                    roundId: crypto.randomUUID(),
                    gameId: 'wanted-dead-or-a-wild',
                    kind: 'BET',
                    money: { amount: '10.00', currency: 'BRL' },
                }),
            }).then((r) => r.json());
        });

        const responses = await Promise.all(requests);
        expect(responses.every((r) => r.status === 'PROCESSED')).toBe(true);

        const walletRes = await fetch(`${inst2.baseUrl}/wallets/${walletId}`).then((r) => r.json());
        expect(walletRes.balance.amount).toBe('700.00');

        await assertWalletLedgerInvariant(inst3.em, walletId, inst3.baseUrl);
    });

    test('Crash Recovery: Morte após commit no banco e antes do Outbox/ACK não perde nem duplica eventos', async () => {
        const primary = instances[0];
        const { walletId, playerId } = await createTestWallet(primary.baseUrl, '200.00');

        const originalSend = sqsClient.send.bind(sqsClient);
        (sqsClient as any).send = async () => {
            throw new Error('SIMULATED_SQS_OUTAGE_BEFORE_RELAY');
        };

        const txRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `idem-crash-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
                providerId: 'pragmatic',
                externalTransactionId: `ext-crash-${crypto.randomUUID()}`,
                playerId,
                walletId,
                roundId: crypto.randomUUID(),
                gameId: 'sweet-bonanza',
                kind: 'BET',
                money: { amount: '50.00', currency: 'BRL' },
            }),
        }).then((r) => r.json());

        expect(txRes.status).toBe('PROCESSED');
        expect(txRes.balance.amount).toBe('150.00');

        const fork = primary.em.fork();
        const outboxRecords = await fork.find(OutboxMessageEntity, {
            aggregateId: txRes.transactionId,
        });
        expect(outboxRecords.length).toBeGreaterThanOrEqual(1);

        (sqsClient as any).send = originalSend;

        let residual;
        do {
            residual = await sqsClient.send(
                new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 0 }),
            );
            for (const msg of residual.Messages ?? []) {
                if (msg.ReceiptHandle) {
                    await sqsClient.send(
                        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }),
                    );
                }
            }
        } while (residual.Messages && residual.Messages.length > 0);

        const eventPayload = JSON.stringify(outboxRecords[0].payload);
        await sqsClient.send(
            new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: eventPayload,
            }),
        );

        const received = await sqsClient.send(
            new ReceiveMessageCommand({
                QueueUrl: queueUrl,
                MaxNumberOfMessages: 1,
                WaitTimeSeconds: 2,
            }),
        );

        const sqsMsg = received.Messages?.[0];
        expect(sqsMsg).toBeDefined();

        const consumer = primary.app.get(SqsConsumerService);

        (sqsClient as any).send = async (cmd: any) => {
            if (cmd?.constructor?.name === 'DeleteMessageCommand') {
                throw new Error('SIMULATED_WORKER_CRASH_BEFORE_SQS_ACK');
            }
            return originalSend(cmd);
        };

        await expect(
            consumer.consumeWithInboxDeduplication(
                sqsMsg!.MessageId!,
                sqsMsg!.Body!,
                sqsMsg!.ReceiptHandle!,
            ),
        ).rejects.toThrow('SIMULATED_WORKER_CRASH_BEFORE_SQS_ACK');

        const inboxFork = primary.em.fork();
        const savedInbox = await inboxFork.findOne(InboxMessageEntity, {
            messageId: sqsMsg!.MessageId!,
        });
        expect(savedInbox).not.toBeNull();

        (sqsClient as any).send = originalSend;

        const reprocessed = await consumer.consumeWithInboxDeduplication(
            sqsMsg!.MessageId!,
            sqsMsg!.Body!,
            sqsMsg!.ReceiptHandle!,
        );
        expect(reprocessed).toBe(false);

        await assertWalletLedgerInvariant(primary.em, walletId, primary.baseUrl);
    });

    test('Seção 13.1a (Referência Fora de Ordem - Resolvida): ROLLBACK antes da BET fica PENDING_REFERENCE e processa após BET chegar', async () => {
        const primary = instances[0];
        const { walletId, playerId } = await createTestWallet(primary.baseUrl, '100.00');
        const roundId = crypto.randomUUID();
        const betExtId = `ext-bet-ooo-${crypto.randomUUID()}`;
        const rollbackExtId = `ext-rb-ooo-${crypto.randomUUID()}`;

        const rollbackRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `idem-rb-ooo-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
                providerId: 'pragmatic',
                externalTransactionId: rollbackExtId,
                referenceExternalTransactionId: betExtId,
                playerId,
                walletId,
                roundId,
                gameId: 'gates-of-olympus',
                kind: 'ROLLBACK',
                money: { amount: '30.00', currency: 'BRL' },
            }),
        }).then((r) => r.json());

        expect(rollbackRes.status).toBe('PENDING_REFERENCE');
        expect(rollbackRes.balance.amount).toBe('100.00');

        const betRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `idem-bet-ooo-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
                providerId: 'pragmatic',
                externalTransactionId: betExtId,
                playerId,
                walletId,
                roundId,
                gameId: 'gates-of-olympus',
                kind: 'BET',
                money: { amount: '30.00', currency: 'BRL' },
            }),
        }).then((r) => r.json());

        expect(betRes.status).toBe('PROCESSED');
        expect(betRes.balance.amount).toBe('70.00');

        const worker = primary.app.get(PendingReferenceWorkerService);
        await worker.reprocessSingle(rollbackRes.transactionId);

        const updatedRollback = await fetch(
            `${primary.baseUrl}/wagering/transactions/${rollbackRes.transactionId}`,
        ).then((r) => r.json());
        expect(updatedRollback.status).toBe('PROCESSED');

        const walletRes = await fetch(`${primary.baseUrl}/wallets/${walletId}`).then((r) => r.json());
        expect(walletRes.balance.amount).toBe('100.00');

        await assertWalletLedgerInvariant(primary.em, walletId, primary.baseUrl);
    });

    test('Seção 13.1b (Referência Fora de Ordem - Expirada): Rejeita com REFERENCE_TRANSACTION_NOT_FOUND após limite de tentativas', async () => {
        const primary = instances[0];
        const { walletId, playerId } = await createTestWallet(primary.baseUrl, '100.00');

        const refundRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `idem-ref-exp-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
                providerId: 'pragmatic',
                externalTransactionId: `ext-ref-exp-${crypto.randomUUID()}`,
                referenceExternalTransactionId: `ext-bet-missing-${crypto.randomUUID()}`,
                playerId,
                walletId,
                roundId: crypto.randomUUID(),
                gameId: 'gates-of-olympus',
                kind: 'REFUND',
                money: { amount: '25.00', currency: 'BRL' },
            }),
        }).then((r) => r.json());

        expect(refundRes.status).toBe('PENDING_REFERENCE');

        const worker = primary.app.get(PendingReferenceWorkerService);
        for (let attempt = 0; attempt < 5; attempt++) {
            await worker.reprocessSingle(refundRes.transactionId);
        }

        const fork = primary.em.fork();
        const expiredTx = await fork.findOneOrFail(WagerTransactionEntity, {
            id: refundRes.transactionId,
        });
        expect(expiredTx.status).toBe('REJECTED');
        expect(expiredTx.failureCode).toBe('REFERENCE_TRANSACTION_NOT_FOUND');

        const rejectedOutbox = await fork.findOne(OutboxMessageEntity, {
            aggregateId: refundRes.transactionId,
            eventType: 'WagerTransactionRejected',
        });
        expect(rejectedOutbox).not.toBeNull();

        await assertWalletLedgerInvariant(primary.em, walletId, primary.baseUrl);
    });

    test('Seção 13.2 (Conflito de Idempotência): Mesma Idempotency-Key com payload diferente retorna HTTP 409 sem replay', async () => {
        const primary = instances[0];
        const { walletId, playerId } = await createTestWallet(primary.baseUrl, '100.00');
        const sharedIdempotencyKey = `idem-conflict-${crypto.randomUUID()}`;
        const roundId = crypto.randomUUID();

        const firstRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': sharedIdempotencyKey,
            },
            body: JSON.stringify({
                providerId: 'evolution',
                externalTransactionId: `ext-conf-1-${crypto.randomUUID()}`,
                playerId,
                walletId,
                roundId,
                gameId: 'lightning-roulette',
                kind: 'BET',
                money: { amount: '20.00', currency: 'BRL' },
            }),
        });
        expect(firstRes.status).toBe(201);
        const firstBody = await firstRes.json();
        expect(firstBody.status).toBe('PROCESSED');
        expect(firstBody.balance.amount).toBe('80.00');

        const conflictRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': sharedIdempotencyKey,
            },
            body: JSON.stringify({
                providerId: 'evolution',
                externalTransactionId: `ext-conf-1-${crypto.randomUUID()}`,
                playerId,
                walletId,
                roundId,
                gameId: 'lightning-roulette',
                kind: 'BET',
                money: { amount: '50.00', currency: 'BRL' },
            }),
        });

        expect(conflictRes.status).toBe(409);

        const walletRes = await fetch(`${primary.baseUrl}/wallets/${walletId}`).then((r) => r.json());
        expect(walletRes.balance.amount).toBe('80.00');

        await assertWalletLedgerInvariant(primary.em, walletId, primary.baseUrl);
    });

    test('Seção 13.3 (Regra do LOSS): LOSS retorna PROCESSED, não altera saldo e não cria entrada no WalletLedgerEntry', async () => {
        const primary = instances[0];
        const { walletId, playerId } = await createTestWallet(primary.baseUrl, '100.00');

        const forkBefore = primary.em.fork();
        const entriesBefore = await forkBefore.find(WalletLedgerEntryEntity, { walletId });
        expect(entriesBefore.length).toBe(1); // Apenas o OPENING

        const lossRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `idem-loss-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
                providerId: 'hacksaw',
                externalTransactionId: `ext-loss-${crypto.randomUUID()}`,
                playerId,
                walletId,
                roundId: crypto.randomUUID(),
                gameId: 'chaos-crew',
                kind: 'LOSS',
                money: { amount: '25.00', currency: 'BRL' },
            }),
        }).then((r) => r.json());

        expect(lossRes.status).toBe('PROCESSED');
        expect(lossRes.balance.amount).toBe('100.00');
        expect(lossRes.idempotentReplay).toBe(false);

        const forkAfter = primary.em.fork();
        const entriesAfter = await forkAfter.find(WalletLedgerEntryEntity, { walletId });
        expect(entriesAfter.length).toBe(1);

        await assertWalletLedgerInvariant(primary.em, walletId, primary.baseUrl);
    });

    test('Seção 13.4 (Saldo Insuficiente em ROLLBACK): Estorno de WIN sem saldo rejeita com INSUFFICIENT_FUNDS_FOR_ROLLBACK', async () => {
        const primary = instances[0];
        const { walletId, playerId } = await createTestWallet(primary.baseUrl, '50.00');
        const roundId = crypto.randomUUID();
        const winExtId = `ext-win-${crypto.randomUUID()}`;

        const winRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `idem-win-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
                providerId: 'pragmatic',
                externalTransactionId: winExtId,
                playerId,
                walletId,
                roundId,
                gameId: 'sweet-bonanza',
                kind: 'WIN',
                money: { amount: '100.00', currency: 'BRL' },
            }),
        }).then((r) => r.json());

        expect(winRes.status).toBe('PROCESSED');
        expect(winRes.balance.amount).toBe('150.00');

        const betRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `idem-bet-spend-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
                providerId: 'pragmatic',
                externalTransactionId: `ext-bet-spend-${crypto.randomUUID()}`,
                playerId,
                walletId,
                roundId: crypto.randomUUID(),
                gameId: 'sweet-bonanza',
                kind: 'BET',
                money: { amount: '120.00', currency: 'BRL' },
            }),
        }).then((r) => r.json());

        expect(betRes.status).toBe('PROCESSED');
        expect(betRes.balance.amount).toBe('30.00');

        // 3. Provedor solicita ROLLBACK do WIN de R$ 100,00 (saldo atual é apenas R$ 30,00)
        const rollbackWinRes = await fetch(`${primary.baseUrl}/wagering/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `idem-rb-win-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
                providerId: 'pragmatic',
                externalTransactionId: `ext-rb-win-${crypto.randomUUID()}`,
                referenceExternalTransactionId: winExtId,
                playerId,
                walletId,
                roundId,
                gameId: 'sweet-bonanza',
                kind: 'ROLLBACK',
                money: { amount: '100.00', currency: 'BRL' },
            }),
        }).then((r) => r.json());

        expect(rollbackWinRes.status).toBe('REJECTED');
        expect(rollbackWinRes.failureCode).toBe('INSUFFICIENT_FUNDS_FOR_ROLLBACK');
        expect(rollbackWinRes.failureCode).not.toBe('INSUFFICIENT_FUNDS');
        expect(rollbackWinRes.balance.amount).toBe('30.00');

        await assertWalletLedgerInvariant(primary.em, walletId, primary.baseUrl);
    });
});