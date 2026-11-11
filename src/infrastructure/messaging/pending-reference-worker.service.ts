import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { WagerTransactionEntity } from '../persistence/entities/wager-transaction.entity';
import { WalletEntity } from '../persistence/entities/wallet.entity';
import { WalletLedgerEntryEntity } from '../persistence/entities/wallet-ledger-entry.entity';
import { OutboxMessageEntity } from '../persistence/entities/outbox-message.entity';
import { Money } from '../../domain/money';
import { WagerTransactionProcessedEvent } from '../../domain/events/wager-transaction-processed.event';
import { WagerTransactionRejectedEvent } from '../../domain/events/wager-transaction-rejected.event';
import { WalletBalanceChangedEvent } from '../../domain/events/wallet-balance-changed.event';

@Injectable()
export class PendingReferenceWorkerService {
    private readonly logger = new Logger(PendingReferenceWorkerService.name);
    private readonly MAX_RETRIES = 5;
    private readonly BASE_DELAY_MS = 2000; // 2s, 4s, 8s, 16s, 32s

    constructor(private readonly em: EntityManager) { }

    calculateNextRetry(attempt: number): Date {
        const delayMs = this.BASE_DELAY_MS * Math.pow(2, attempt);
        return new Date(Date.now() + delayMs);
    }

    @Cron(CronExpression.EVERY_5_SECONDS)
    async processPendingReferences() {
        const fork = this.em.fork();
        const now = new Date();

        const pendingList = await fork.find(
            WagerTransactionEntity,
            {
                status: 'PENDING_REFERENCE',
                $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
            },
            { limit: 20, orderBy: { createdAt: 'ASC' } },
        );

        for (const pending of pendingList) {
            await this.reprocessSingle(pending.id);
        }
    }

    async reprocessSingle(txId: string): Promise<void> {
        const fork = this.em.fork();

        await fork.transactional(async (em) => {
            const tx = await em.findOne(
                WagerTransactionEntity,
                { id: txId, status: 'PENDING_REFERENCE' },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
            );

            if (!tx) return;

            const refTx = await em.findOne(WagerTransactionEntity, {
                providerId: tx.providerId,
                externalTransactionId: tx.referenceExternalTransactionId,
            });

            if (!refTx) {
                const nextAttempt = (tx.retryCount ?? 0) + 1;

                if (nextAttempt >= this.MAX_RETRIES) {
                    tx.status = 'REJECTED';
                    tx.failureCode = 'REFERENCE_TRANSACTION_NOT_FOUND';
                    tx.retryCount = nextAttempt;
                    tx.processedAt = new Date();

                    const rejectedEvent = new WagerTransactionRejectedEvent({
                        aggregateId: tx.id,
                        correlationId: tx.id,
                        data: {
                            transactionId: tx.id,
                            providerId: tx.providerId,
                            externalTransactionId: tx.externalTransactionId,
                            walletId: tx.walletId,
                            playerId: tx.playerId,
                            roundId: tx.roundId,
                            gameId: tx.gameId,
                            kind: tx.kind,
                            money: { amount: tx.moneyAmount, currency: tx.currency },
                            failureCode: tx.failureCode,
                            referenceExternalTransactionId: tx.referenceExternalTransactionId,
                        },
                    });

                    await em.persist(
                        em.create(OutboxMessageEntity, {
                            aggregateId: tx.id,
                            eventType: rejectedEvent.eventType,
                            payload: rejectedEvent.toJSON(),
                            occurredAt: rejectedEvent.occurredAt,
                            attempts: 0,
                        }),
                    );

                    this.logger.warn(`Transação ${tx.id} marcada como REJECTED após ${nextAttempt} tentativas.`);
                } else {
                    tx.retryCount = nextAttempt;
                    tx.nextRetryAt = this.calculateNextRetry(nextAttempt);
                }

                await em.flush();
                return;
            }

            const wallet = await em.findOne(
                WalletEntity,
                { id: tx.walletId, playerId: tx.playerId },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
            );

            if (!wallet) return;

            const currentBalance = Money.from({ amount: wallet.balanceAmount, currency: wallet.currency });
            const operationMoney = Money.from({ amount: tx.moneyAmount, currency: tx.currency });

            const alreadyReversed = await em.findOne(WagerTransactionEntity, {
                providerId: tx.providerId,
                referenceExternalTransactionId: tx.referenceExternalTransactionId,
                status: 'PROCESSED',
            });

            const invalidContext =
                refTx.status !== 'PROCESSED' ||
                refTx.walletId !== tx.walletId ||
                refTx.playerId !== tx.playerId ||
                refTx.currency !== tx.currency ||
                refTx.roundId !== tx.roundId ||
                Boolean(alreadyReversed) ||
                (tx.kind === 'REFUND' && refTx.kind !== 'BET') ||
                (tx.kind === 'ROLLBACK' && !['BET', 'WIN', 'REFUND'].includes(refTx.kind));

            if (invalidContext) {
                tx.status = 'REJECTED';
                tx.failureCode = 'INVALID_REFERENCE_TRANSACTION';
                tx.processedAt = new Date();

                const rejectedEvent = new WagerTransactionRejectedEvent({
                    aggregateId: tx.id,
                    correlationId: tx.id,
                    data: {
                        transactionId: tx.id,
                        providerId: tx.providerId,
                        externalTransactionId: tx.externalTransactionId,
                        walletId: tx.walletId,
                        playerId: tx.playerId,
                        roundId: tx.roundId,
                        gameId: tx.gameId,
                        kind: tx.kind,
                        money: operationMoney.toJSON(),
                        failureCode: tx.failureCode,
                        referenceExternalTransactionId: tx.referenceExternalTransactionId,
                    },
                });

                await em.persist(
                    em.create(OutboxMessageEntity, {
                        aggregateId: tx.id,
                        eventType: rejectedEvent.eventType,
                        payload: rejectedEvent.toJSON(),
                        occurredAt: rejectedEvent.occurredAt,
                        attempts: 0,
                    }),
                );
                await em.flush();
                return;
            }

            let newBalance = currentBalance;
            let direction: 'CREDIT' | 'DEBIT';

            if (refTx.kind === 'BET') {
                newBalance = currentBalance.add(operationMoney);
                direction = 'CREDIT';
            } else {
                if (currentBalance.subtract(operationMoney).isNegative()) {
                    tx.status = 'REJECTED';
                    tx.failureCode = 'INSUFFICIENT_FUNDS_FOR_ROLLBACK';
                    tx.processedAt = new Date();

                    const rejectedEvent = new WagerTransactionRejectedEvent({
                        aggregateId: tx.id,
                        correlationId: tx.id,
                        data: {
                            transactionId: tx.id,
                            providerId: tx.providerId,
                            externalTransactionId: tx.externalTransactionId,
                            walletId: tx.walletId,
                            playerId: tx.playerId,
                            roundId: tx.roundId,
                            gameId: tx.gameId,
                            kind: tx.kind,
                            money: operationMoney.toJSON(),
                            failureCode: tx.failureCode,
                            referenceExternalTransactionId: tx.referenceExternalTransactionId,
                        },
                    });

                    await em.persist(
                        em.create(OutboxMessageEntity, {
                            aggregateId: tx.id,
                            eventType: rejectedEvent.eventType,
                            payload: rejectedEvent.toJSON(),
                            occurredAt: rejectedEvent.occurredAt,
                            attempts: 0,
                        }),
                    );
                    await em.flush();
                    return;
                }
                newBalance = currentBalance.subtract(operationMoney);
                direction = 'DEBIT';
            }

            wallet.balanceAmount = newBalance.toJSON().amount;
            tx.status = 'PROCESSED';
            tx.processedAt = new Date();

            await em.persist(
                em.create(WalletLedgerEntryEntity, {
                    walletId: wallet.id,
                    transactionId: tx.id,
                    direction,
                    moneyAmount: operationMoney.toJSON().amount,
                    currency: tx.currency,
                    balanceBefore: currentBalance.toJSON().amount,
                    balanceAfter: newBalance.toJSON().amount,
                }),
            );

            const processedEvent = new WagerTransactionProcessedEvent({
                aggregateId: tx.id,
                correlationId: tx.id,
                data: {
                    transactionId: tx.id,
                    providerId: tx.providerId,
                    externalTransactionId: tx.externalTransactionId,
                    walletId: tx.walletId,
                    playerId: tx.playerId,
                    roundId: tx.roundId,
                    gameId: tx.gameId,
                    kind: tx.kind,
                    money: operationMoney.toJSON(),
                    referenceExternalTransactionId: tx.referenceExternalTransactionId,
                },
            });

            const balanceEvent = new WalletBalanceChangedEvent({
                aggregateId: wallet.id,
                correlationId: tx.id,
                causationId: processedEvent.eventId,
                data: {
                    walletId: wallet.id,
                    transactionId: tx.id,
                    direction,
                    money: operationMoney.toJSON(),
                    balanceBefore: currentBalance.toJSON(),
                    balanceAfter: newBalance.toJSON(),
                    walletVersion: wallet.version + 1,
                },
            });

            await em.persist(
                em.create(OutboxMessageEntity, {
                    aggregateId: tx.id,
                    eventType: processedEvent.eventType,
                    payload: processedEvent.toJSON(),
                    occurredAt: processedEvent.occurredAt,
                    attempts: 0,
                }),
            );

            await em.persist(
                em.create(OutboxMessageEntity, {
                    aggregateId: wallet.id,
                    eventType: balanceEvent.eventType,
                    payload: balanceEvent.toJSON(),
                    occurredAt: balanceEvent.occurredAt,
                    attempts: 0,
                }),
            );

            await em.flush();
            this.logger.log(`Transação pendente ${tx.id} reprocessada com sucesso.`);
        });
    }
}