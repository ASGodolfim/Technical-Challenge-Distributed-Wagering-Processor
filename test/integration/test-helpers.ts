import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../../src/app.module';
import { WalletEntity } from '../../src/infrastructure/persistence/entities/wallet.entity';
import { WalletLedgerEntryEntity } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { Money } from '../../src/domain/money';
import { sqsClient } from '../../src/infrastructure/messaging/sqs.client';
import { CreateQueueCommand } from '@aws-sdk/client-sqs';

export interface TestAppInstance {
    app: INestApplication;
    baseUrl: string;
    em: EntityManager;
}

export async function createAppInstance(): Promise<TestAppInstance> {
    const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');

    const baseUrl = await app.getUrl();
    const em = app.get(EntityManager);

    return { app, baseUrl, em };
}

export async function ensureSqsQueueExists(): Promise<string> {
    const queueUrl =
        process.env.SQS_QUEUE_URL || 'http://localhost:9324/000000000000/wallet-events-queue';
    const queueName = queueUrl.split('/').pop() || 'wallet-events-queue';

    await sqsClient.send(new CreateQueueCommand({ QueueName: queueName }));
    return queueUrl;
}

export async function assertWalletLedgerInvariant(
    em: EntityManager,
    walletId: string,
    baseUrl?: string,
): Promise<void> {
    const fork = em.fork();
    const wallet = await fork.findOneOrFail(WalletEntity, { id: walletId });
    const entries = await fork.find(WalletLedgerEntryEntity, { walletId });

    let calculatedCents = 0;
    for (const entry of entries) {
        const entryCents = Money.from({ amount: entry.moneyAmount, currency: entry.currency }).cents;
        if (entry.direction === 'CREDIT') {
            calculatedCents += entryCents;
        } else if (entry.direction === 'DEBIT') {
            calculatedCents -= entryCents;
        }
    }

    const storedCents = Money.from({ amount: wallet.balanceAmount, currency: wallet.currency }).cents;

    expect(storedCents).toBe(calculatedCents);

    if (baseUrl) {
        const res = await fetch(`${baseUrl}/wallets/${walletId}/reconciliation`, {
            method: 'POST',
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.consistent).toBe(true);
        expect(body.storedBalance.amount).toBe(body.calculatedLedgerBalance.amount);
    }
}