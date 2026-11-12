import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { setLogContext, getLogContext } from '../../infrastructure/observability/request-context';
import { WalletEntity } from '../../infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from '../../infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { OutboxMessageEntity } from '../../infrastructure/persistence/entities/outbox-message.entity';
import { Money } from '../../domain/money';
import { WalletBalanceChangedEvent } from '../../domain/events/wallet-balance-changed.event';
import { WagerTransactionPendingReferenceEvent } from '../../domain/events/wager-pending-reference.event';
import { WagerTransactionProcessedEvent } from '../../domain/events/wager-transaction-processed.event';
import { WagerTransactionRejectedEvent } from '../../domain/events/wager-transaction-rejected.event';
import { ProcessWagerRequestDto, ProcessWagerResponseDto } from '../dtos/wager.dto';
import { affectsBalance } from '../../domain/wager-transaction.kind';
import * as crypto from 'crypto';

function sortKeysRecursively(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeysRecursively);
    }
    if (value !== null && typeof value === 'object') {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[key] = sortKeysRecursively((value as Record<string, unknown>)[key]);
        }
        return sorted;
    }
    return value;
}

export function computeCanonicalPayloadHash(dto: ProcessWagerRequestDto): string {
    const businessSubset = {
        externalTransactionId: dto.externalTransactionId,
        gameId: dto.gameId,
        kind: dto.kind,
        money: {
            amount: dto.money?.amount,
            currency: dto.money?.currency,
        },
        playerId: dto.playerId,
        providerId: dto.providerId,
        referenceExternalTransactionId: dto.referenceExternalTransactionId ?? null,
        roundId: dto.roundId,
        walletId: dto.walletId,
    };

    const canonicalJson = JSON.stringify(sortKeysRecursively(businessSubset));
    return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}

@Injectable()
export class WagerService {
    private readonly logger = new Logger(WagerService.name);

    constructor(private readonly em: EntityManager) { }

    async processWager(dto: ProcessWagerRequestDto, idempotencyKey: string): Promise<ProcessWagerResponseDto> {
        setLogContext({
            walletId: dto.walletId,
            providerId: dto.providerId,
            ...(dto.correlationId ? { correlationId: dto.correlationId } : {}),
        });

        if (!idempotencyKey) {
            throw new BadRequestException('O header Idempotency-Key é obrigatório.');
        }

        const operationMoney = Money.from({ amount: dto.money.amount, currency: dto.money.currency });
        const payloadHash = computeCanonicalPayloadHash(dto);

        return await this.em.transactional(async (em) => {
            const existingTx = await em.findOne(WagerTransactionEntity, {
                $or: [
                    { idempotencyKey },
                    { providerId: dto.providerId, externalTransactionId: dto.externalTransactionId },
                ],
            });

            if (existingTx) {
                if (existingTx.payloadHash !== payloadHash) {
                    throw new ConflictException('Idempotency key reusada com payload diferente.');
                }

                const wallet = await em.findOne(WalletEntity, { id: existingTx.walletId });
                setLogContext({ transactionId: existingTx.id });
                this.logger.log({
                    message: 'Idempotent replay returned',
                    status: existingTx.status,
                    kind: dto.kind,
                });

                return {
                    transactionId: existingTx.id,
                    status: existingTx.status as any,
                    balance: {
                        amount: wallet?.balanceAmount ?? '0.00',
                        currency: existingTx.currency,
                    },
                    idempotentReplay: true,
                    failureCode: existingTx.failureCode,
                };

            }

            const wallet = await em.findOne(
                WalletEntity,
                { id: dto.walletId, playerId: dto.playerId },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
            );

            if (!wallet) {
                throw new BadRequestException('Carteira não encontrada para o jogador informado.');
            }

            const committedTxAfterLock = await em.findOne(WagerTransactionEntity, {
                $or: [
                    { idempotencyKey },
                    { providerId: dto.providerId, externalTransactionId: dto.externalTransactionId },
                ],
            });

            if (committedTxAfterLock) {
                if (committedTxAfterLock.payloadHash !== payloadHash) {
                    throw new ConflictException('Idempotency key reusada com payload diferente.');
                }

                return {
                    transactionId: committedTxAfterLock.id,
                    status: committedTxAfterLock.status as any,
                    balance: {
                        amount: wallet.balanceAmount,
                        currency: committedTxAfterLock.currency,
                    },
                    idempotentReplay: true,
                    failureCode: committedTxAfterLock.failureCode,
                };
            }

            const currentBalance = Money.from({ amount: wallet.balanceAmount, currency: wallet.currency });
            let newBalance = currentBalance;
            let direction: 'DEBIT' | 'CREDIT' | null = null;

            if (dto.kind === 'BET') {
                if (currentBalance.subtract(operationMoney).isNegative()) {
                    return this.rejectTransaction(em, dto, wallet, currentBalance, idempotencyKey, payloadHash, 'INSUFFICIENT_FUNDS');
                }
                newBalance = currentBalance.subtract(operationMoney);
                direction = 'DEBIT';
            } else if (dto.kind === 'WIN') {
                newBalance = currentBalance.add(operationMoney);
                direction = 'CREDIT';
            } else if (dto.kind === 'LOSS') {
                newBalance = currentBalance;
                direction = null;
            } else if (dto.kind === 'REFUND' || dto.kind === 'ROLLBACK') {
                if (!dto.referenceExternalTransactionId) {
                    throw new BadRequestException(`referenceExternalTransactionId é obrigatório para operações de ${dto.kind}.`);
                }

                const refTx = await em.findOne(WagerTransactionEntity, {
                    providerId: dto.providerId,
                    externalTransactionId: dto.referenceExternalTransactionId,
                });

                if (!refTx) {
                    return this.handlePendingReference(em, dto, wallet, currentBalance, idempotencyKey, payloadHash);
                }

                if (refTx.status !== 'PROCESSED') {
                    throw new BadRequestException(`Transação de referência '${dto.referenceExternalTransactionId}' não está PROCESSED.`);
                }

                if (
                    refTx.walletId !== dto.walletId ||
                    refTx.playerId !== dto.playerId ||
                    refTx.currency !== dto.money.currency ||
                    refTx.roundId !== dto.roundId
                ) {
                    throw new BadRequestException(`Atributos da transação de referência divergentes.`);
                }

                const alreadyReversed = await em.findOne(WagerTransactionEntity, {
                    providerId: dto.providerId,
                    referenceExternalTransactionId: dto.referenceExternalTransactionId,
                    status: 'PROCESSED',
                });

                if (alreadyReversed) {
                    throw new BadRequestException(`Transação de referência '${dto.referenceExternalTransactionId}' já foi revertida.`);
                }

                if (dto.kind === 'REFUND') {
                    if (refTx.kind !== 'BET') {
                        throw new BadRequestException(`REFUND só pode ser aplicado a transações BET.`);
                    }
                    newBalance = currentBalance.add(operationMoney);
                    direction = 'CREDIT';
                } else {
                    const allowedKinds = ['BET', 'WIN', 'REFUND'];
                    if (!allowedKinds.includes(refTx.kind)) {
                        throw new BadRequestException(`ROLLBACK só pode ser aplicado a BET, WIN ou REFUND.`);
                    }

                    if (refTx.kind === 'BET') {
                        newBalance = currentBalance.add(operationMoney);
                        direction = 'CREDIT';
                    } else {
                        if (currentBalance.subtract(operationMoney).isNegative()) {
                            return this.rejectTransaction(em, dto, wallet, currentBalance, idempotencyKey, payloadHash, 'INSUFFICIENT_FUNDS_FOR_ROLLBACK');
                        }
                        newBalance = currentBalance.subtract(operationMoney);
                        direction = 'DEBIT';
                    }
                }
            }

            const isBalanceAffected = affectsBalance(dto.kind);

            if (isBalanceAffected && direction !== null) {
                wallet.balanceAmount = newBalance.toJSON().amount;
            }

            const wagerTxId = crypto.randomUUID();
            const correlationId = dto.correlationId ?? getLogContext().correlationId ?? wagerTxId;
            setLogContext({ correlationId, transactionId: wagerTxId });
            this.logger.log({
                message: 'Wager transaction processed',
                kind: dto.kind,
                status: 'PROCESSED',
            });

            const wagerTx = em.create(WagerTransactionEntity, {
                id: wagerTxId,
                providerId: dto.providerId,
                externalTransactionId: dto.externalTransactionId,
                idempotencyKey,
                payloadHash,
                walletId: wallet.id,
                playerId: dto.playerId,
                roundId: dto.roundId,
                gameId: dto.gameId,
                kind: dto.kind,
                moneyAmount: operationMoney.toJSON().amount,
                currency: dto.money.currency,
                referenceExternalTransactionId: dto.referenceExternalTransactionId,
                status: 'PROCESSED',
                processedAt: new Date(),
            });
            await em.persist(wagerTx);

            const processedEvent = new WagerTransactionProcessedEvent({
                aggregateId: wagerTxId,
                correlationId,
                causationId: wagerTxId,
                data: {
                    transactionId: wagerTxId,
                    providerId: dto.providerId,
                    externalTransactionId: dto.externalTransactionId,
                    walletId: wallet.id,
                    playerId: dto.playerId,
                    roundId: dto.roundId,
                    gameId: dto.gameId,
                    kind: dto.kind,
                    money: operationMoney.toJSON(),
                    referenceExternalTransactionId: dto.referenceExternalTransactionId,
                },
            });

            await em.persist(
                em.create(OutboxMessageEntity, {
                    aggregateId: wagerTxId,
                    eventType: processedEvent.eventType,
                    payload: processedEvent.toJSON(),
                    occurredAt: processedEvent.occurredAt,
                    attempts: 0,
                }),
            );

            if (isBalanceAffected && direction !== null) {
                const ledgerEntry = em.create(WalletLedgerEntryEntity, {
                    walletId: wallet.id,
                    transactionId: wagerTxId,
                    direction,
                    moneyAmount: operationMoney.toJSON().amount,
                    currency: dto.money.currency,
                    balanceBefore: currentBalance.toJSON().amount,
                    balanceAfter: newBalance.toJSON().amount,
                });
                await em.persist(ledgerEntry);

                const balanceEvent = new WalletBalanceChangedEvent({
                    aggregateId: wallet.id,
                    correlationId,
                    causationId: processedEvent.eventId,
                    data: {
                        walletId: wallet.id,
                        transactionId: wagerTxId,
                        direction,
                        money: operationMoney.toJSON(),
                        balanceBefore: currentBalance.toJSON(),
                        balanceAfter: newBalance.toJSON(),
                        walletVersion: wallet.version + 1,
                    },
                });

                await em.persist(
                    em.create(OutboxMessageEntity, {
                        aggregateId: wallet.id,
                        eventType: balanceEvent.eventType,
                        payload: balanceEvent.toJSON(),
                        occurredAt: balanceEvent.occurredAt,
                        attempts: 0,
                    }),
                );
            }

            await em.flush();

            return {
                transactionId: wagerTxId,
                status: 'PROCESSED',
                balance: {
                    amount: wallet.balanceAmount,
                    currency: dto.money.currency,
                },
                idempotentReplay: false,
            };
        });
    }

    private async handlePendingReference(
        em: EntityManager,
        dto: ProcessWagerRequestDto,
        wallet: WalletEntity,
        currentBalance: Money,
        idempotencyKey: string,
        payloadHash: string,
    ): Promise<ProcessWagerResponseDto> {
        const txId = crypto.randomUUID();
        const correlationId = dto.correlationId ?? getLogContext().correlationId ?? txId;
        setLogContext({ correlationId, transactionId: txId });
        this.logger.warn({
            message: 'Wager transaction marked as PENDING_REFERENCE',
            kind: dto.kind,
            status: 'PENDING_REFERENCE',
        });

        const pendingTx = em.create(WagerTransactionEntity, {
            id: txId,
            providerId: dto.providerId,
            externalTransactionId: dto.externalTransactionId,
            idempotencyKey,
            payloadHash,
            walletId: wallet.id,
            playerId: dto.playerId,
            roundId: dto.roundId,
            gameId: dto.gameId,
            kind: dto.kind,
            moneyAmount: Money.from({ amount: dto.money.amount, currency: dto.money.currency }).toJSON().amount,
            currency: dto.money.currency,
            referenceExternalTransactionId: dto.referenceExternalTransactionId,
            status: 'PENDING_REFERENCE',
            retryCount: 0,
            nextRetryAt: new Date(Date.now() + 2000), // primeira tentativa após 2s
            processedAt: new Date(),
        });
        await em.persist(pendingTx);

        const pendingEvent = new WagerTransactionPendingReferenceEvent({
            aggregateId: txId,
            correlationId,
            causationId: txId,
            data: {
                transactionId: txId,
                providerId: dto.providerId,
                externalTransactionId: dto.externalTransactionId,
                referenceExternalTransactionId: dto.referenceExternalTransactionId!,
                walletId: wallet.id,
                playerId: dto.playerId,
                kind: dto.kind,
                amount: dto.money.amount,
                currency: dto.money.currency,
            },
        });

        await em.persist(
            em.create(OutboxMessageEntity, {
                aggregateId: txId,
                eventType: pendingEvent.eventType,
                payload: pendingEvent.toJSON(),
                occurredAt: pendingEvent.occurredAt,
                attempts: 0,
            }),
        );
        await em.flush();

        return {
            transactionId: txId,
            status: 'PENDING_REFERENCE',
            balance: {
                amount: currentBalance.toJSON().amount,
                currency: dto.money.currency,
            },
            idempotentReplay: false,
        };
    }

    private async rejectTransaction(
        em: EntityManager,
        dto: ProcessWagerRequestDto,
        wallet: WalletEntity,
        currentBalance: Money,
        idempotencyKey: string,
        payloadHash: string,
        failureCode: string,
    ): Promise<ProcessWagerResponseDto> {
        const rejectedTxId = crypto.randomUUID();
        const correlationId = dto.correlationId ?? getLogContext().correlationId ?? rejectedTxId;
        setLogContext({ correlationId, transactionId: rejectedTxId });
        this.logger.warn({
            message: 'Wager transaction rejected',
            kind: dto.kind,
            status: 'REJECTED',
            failureCode,
        });
        const operationMoney = Money.from({ amount: dto.money.amount, currency: dto.money.currency });

        const rejectedTx = em.create(WagerTransactionEntity, {
            id: rejectedTxId,
            providerId: dto.providerId,
            externalTransactionId: dto.externalTransactionId,
            idempotencyKey,
            payloadHash,
            walletId: wallet.id,
            playerId: dto.playerId,
            roundId: dto.roundId,
            gameId: dto.gameId,
            kind: dto.kind,
            moneyAmount: operationMoney.toJSON().amount,
            currency: dto.money.currency,
            referenceExternalTransactionId: dto.referenceExternalTransactionId,
            status: 'REJECTED',
            failureCode,
            processedAt: new Date(),
        });
        await em.persist(rejectedTx);

        const rejectedEvent = new WagerTransactionRejectedEvent({
            aggregateId: rejectedTxId,
            correlationId,
            causationId: rejectedTxId,
            data: {
                transactionId: rejectedTxId,
                providerId: dto.providerId,
                externalTransactionId: dto.externalTransactionId,
                walletId: wallet.id,
                playerId: dto.playerId,
                roundId: dto.roundId,
                gameId: dto.gameId,
                kind: dto.kind,
                money: operationMoney.toJSON(),
                failureCode,
                referenceExternalTransactionId: dto.referenceExternalTransactionId,
            },
        });

        await em.persist(
            em.create(OutboxMessageEntity, {
                aggregateId: rejectedTxId,
                eventType: rejectedEvent.eventType,
                payload: rejectedEvent.toJSON(),
                occurredAt: rejectedEvent.occurredAt,
                attempts: 0,
            }),
        );

        await em.flush();

        return {
            transactionId: rejectedTx.id,
            status: 'REJECTED',
            balance: {
                amount: currentBalance.toJSON().amount,
                currency: dto.money.currency,
            },
            idempotentReplay: false,
            failureCode,
        };
    }

    async getTransactionById(transactionId: string) {
        const tx = await this.em.findOne(WagerTransactionEntity, { id: transactionId });
        if (!tx) throw new BadRequestException('Transação não encontrada.');
        return tx;
    }

    async getTransactionByExternalId(providerId: string, externalTransactionId: string) {
        const tx = await this.em.findOne(WagerTransactionEntity, { providerId, externalTransactionId });
        if (!tx) throw new BadRequestException('Transação externa não encontrada.');
        return tx;
    }
}