import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { WalletEntity } from '../../infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from '../../infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { OutboxMessageEntity } from '../../infrastructure/persistence/entities/outbox-message.entity';
import { Money } from '../../domain/money';
import { WalletBalanceChangedEvent } from '../../domain/events/wallet-balance-changed.event';
import { WagerTransactionPendingReferenceEvent } from '../../domain/events/wager-pending-reference.event';
import { ProcessWagerDto, ProcessWagerResult } from '../dtos/wager.dto';
import { affectsBalance } from '../../domain/wager-transaction.kind';
import * as crypto from 'crypto';

@Injectable()
export class WagerService {
    constructor(private readonly em: EntityManager) { }

    async processWager(dto: ProcessWagerDto): Promise<ProcessWagerResult> {
        const operationMoney = Money.from({ amount: dto.amount, currency: dto.currency });
        const payloadHash = crypto
            .createHash('sha256')
            .update(JSON.stringify(dto))
            .digest('hex');

        return await this.em.transactional(async (em) => {
            const existingTx = await em.findOne(WagerTransactionEntity, {
                $or: [
                    { idempotencyKey: dto.idempotencyKey },
                    { providerId: dto.providerId, externalTransactionId: dto.externalTransactionId },
                ],
            });

            if (existingTx) {
                if (existingTx.payloadHash !== payloadHash) {
                    throw new ConflictException('Idempotency key reusada com payload diferente.');
                }

                const wallet = await em.findOne(WalletEntity, { id: existingTx.walletId });
                return {
                    transactionId: existingTx.id,
                    status: existingTx.status as any,
                    balanceAmount: wallet?.balanceAmount ?? '0.00',
                    currency: existingTx.currency,
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

            const currentBalance = Money.from({ amount: wallet.balanceAmount, currency: wallet.currency });
            let newBalance = currentBalance;
            let direction: 'DEBIT' | 'CREDIT' | null = null;

            if (dto.kind === 'BET') {
                if (currentBalance.subtract(operationMoney).isNegative()) {
                    return this.rejectTransaction(em, dto, wallet, currentBalance, payloadHash, 'INSUFFICIENT_FUNDS');
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
                    return this.handlePendingReference(em, dto, wallet, currentBalance, payloadHash);
                }

                if (refTx.status !== 'PROCESSED') {
                    throw new BadRequestException(
                        `A transação de referência '${dto.referenceExternalTransactionId}' está com status '${refTx.status}' (deve ser PROCESSED).`,
                    );
                }

                if (
                    refTx.walletId !== dto.walletId ||
                    refTx.playerId !== dto.playerId ||
                    refTx.currency !== dto.currency ||
                    refTx.roundId !== dto.roundId
                ) {
                    throw new BadRequestException(
                        `Atributos da transação de referência divergentes (wallet, player, currency ou roundId).`,
                    );
                }

                const alreadyReversed = await em.findOne(WagerTransactionEntity, {
                    providerId: dto.providerId,
                    referenceExternalTransactionId: dto.referenceExternalTransactionId,
                    status: 'PROCESSED',
                });

                if (alreadyReversed) {
                    throw new BadRequestException(
                        `A transação de referência '${dto.referenceExternalTransactionId}' já foi revertida previamente pela transação '${alreadyReversed.externalTransactionId}'.`,
                    );
                }

                if (dto.kind === 'REFUND') {
                    if (refTx.kind !== 'BET') {
                        throw new BadRequestException(`REFUND só pode ser aplicado a transações BET (encontrado: '${refTx.kind}').`);
                    }
                    newBalance = currentBalance.add(operationMoney);
                    direction = 'CREDIT';
                } else {
                    const allowedKinds = ['BET', 'WIN', 'REFUND'];
                    if (!allowedKinds.includes(refTx.kind)) {
                        throw new BadRequestException(`ROLLBACK só pode ser aplicado a BET, WIN ou REFUND (encontrado: '${refTx.kind}').`);
                    }

                    if (refTx.kind === 'BET') {
                        newBalance = currentBalance.add(operationMoney);
                        direction = 'CREDIT';
                    } else {
                        if (currentBalance.subtract(operationMoney).isNegative()) {
                            return this.rejectTransaction(em, dto, wallet, currentBalance, payloadHash, 'INSUFFICIENT_FUNDS_FOR_ROLLBACK');
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
            const wagerTx = em.create(WagerTransactionEntity, {
                id: wagerTxId,
                providerId: dto.providerId,
                externalTransactionId: dto.externalTransactionId,
                idempotencyKey: dto.idempotencyKey,
                payloadHash,
                walletId: wallet.id,
                playerId: dto.playerId,
                roundId: dto.roundId,
                gameId: dto.gameId,
                kind: dto.kind,
                moneyAmount: operationMoney.toJSON().amount,
                currency: dto.currency,
                referenceExternalTransactionId: dto.referenceExternalTransactionId,
                status: 'PROCESSED',
                processedAt: new Date(),
            });
            await em.persist(wagerTx);

            if (isBalanceAffected && direction !== null) {
                const ledgerEntry = em.create(WalletLedgerEntryEntity, {
                    walletId: wallet.id,
                    transactionId: wagerTxId,
                    direction,
                    moneyAmount: operationMoney.toJSON().amount,
                    currency: dto.currency,
                    balanceBefore: currentBalance.toJSON().amount,
                    balanceAfter: newBalance.toJSON().amount,
                });
                await em.persist(ledgerEntry);

                const balanceEvent = new WalletBalanceChangedEvent({
                    aggregateId: wallet.id,
                    correlationId: dto.correlationId ?? wagerTxId,
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

                const outboxMsg = em.create(OutboxMessageEntity, {
                    aggregateId: wallet.id,
                    eventType: balanceEvent.eventType,
                    payload: balanceEvent.toJSON(),
                    occurredAt: balanceEvent.occurredAt,
                    attempts: 0,
                });
                await em.persist(outboxMsg);
            }

            await em.flush();

            return {
                transactionId: wagerTxId,
                status: 'PROCESSED',
                balanceAmount: wallet.balanceAmount,
                currency: dto.currency,
            };
        });
    }

    private async handlePendingReference(
        em: EntityManager,
        dto: ProcessWagerDto,
        wallet: WalletEntity,
        currentBalance: Money,
        payloadHash: string,
    ): Promise<ProcessWagerResult> {
        const txId = crypto.randomUUID();
        const pendingTx = em.create(WagerTransactionEntity, {
            id: txId,
            providerId: dto.providerId,
            externalTransactionId: dto.externalTransactionId,
            idempotencyKey: dto.idempotencyKey,
            payloadHash,
            walletId: wallet.id,
            playerId: dto.playerId,
            roundId: dto.roundId,
            gameId: dto.gameId,
            kind: dto.kind,
            moneyAmount: Money.from({ amount: dto.amount, currency: dto.currency }).toJSON().amount,
            currency: dto.currency,
            referenceExternalTransactionId: dto.referenceExternalTransactionId,
            status: 'PENDING_REFERENCE',
            processedAt: new Date(),
        });
        await em.persist(pendingTx);

        const pendingEvent = new WagerTransactionPendingReferenceEvent(wallet.id, dto.correlationId ?? txId, {
            transactionId: txId,
            providerId: dto.providerId,
            externalTransactionId: dto.externalTransactionId,
            referenceExternalTransactionId: dto.referenceExternalTransactionId!,
            walletId: wallet.id,
            playerId: dto.playerId,
            kind: dto.kind,
            amount: dto.amount,
            currency: dto.currency,
        });

        const outboxMsg = em.create(OutboxMessageEntity, {
            aggregateId: wallet.id,
            eventType: pendingEvent.eventType,
            payload: pendingEvent.toJSON(),
            occurredAt: pendingEvent.occurredAt,
            attempts: 0,
        });
        await em.persist(outboxMsg);
        await em.flush();

        return {
            transactionId: txId,
            status: 'PENDING_REFERENCE',
            balanceAmount: currentBalance.toJSON().amount,
            currency: dto.currency,
        };
    }

    private async rejectTransaction(
        em: EntityManager,
        dto: ProcessWagerDto,
        wallet: WalletEntity,
        currentBalance: Money,
        payloadHash: string,
        failureCode: string,
    ): Promise<ProcessWagerResult> {
        const rejectedTxId = crypto.randomUUID();
        const rejectedTx = em.create(WagerTransactionEntity, {
            id: rejectedTxId,
            providerId: dto.providerId,
            externalTransactionId: dto.externalTransactionId,
            idempotencyKey: dto.idempotencyKey,
            payloadHash,
            walletId: wallet.id,
            playerId: dto.playerId,
            roundId: dto.roundId,
            gameId: dto.gameId,
            kind: dto.kind,
            moneyAmount: Money.from({ amount: dto.amount, currency: dto.currency }).toJSON().amount,
            currency: dto.currency,
            referenceExternalTransactionId: dto.referenceExternalTransactionId,
            status: 'REJECTED',
            failureCode,
            processedAt: new Date(),
        });
        await em.persist(rejectedTx).flush();

        return {
            transactionId: rejectedTx.id,
            status: 'REJECTED',
            balanceAmount: currentBalance.toJSON().amount,
            currency: dto.currency,
            failureCode,
        };
    }
}