import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletEntity } from '../../infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from '../../infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { Money } from '../../domain/money';
import { CreateWalletDto, PaginatedLedgerResponseDto, ReconciliationResponseDto } from '../dtos/wallet.dto';
import * as crypto from 'crypto';

@Injectable()
export class WalletService {
    constructor(private readonly em: EntityManager) { }

    async createWallet(dto: CreateWalletDto) {
        const initialAmount = dto.initialBalance?.amount ?? '0.00';
        const currency = dto.initialBalance?.currency ?? 'BRL';
        const initialMoney = Money.from({ amount: initialAmount, currency });

        return await this.em.transactional(async (em) => {
            const walletId = crypto.randomUUID();
            const wallet = em.create(WalletEntity, {
                id: walletId,
                playerId: dto.playerId,
                balanceAmount: initialMoney.toJSON().amount,
                currency,
                version: 1,
            });
            await em.persist(wallet);

            if (!initialMoney.isZero()) {
                const txId = crypto.randomUUID();
                const openingTx = em.create(WagerTransactionEntity, {
                    id: txId,
                    providerId: 'system',
                    externalTransactionId: `opening-${txId}`,
                    idempotencyKey: `idem-opening-${txId}`,
                    payloadHash: 'system_opening',
                    walletId: wallet.id,
                    playerId: dto.playerId,
                    roundId: 'opening-round',
                    gameId: 'system',
                    kind: 'OPENING',
                    moneyAmount: initialMoney.toJSON().amount,
                    currency,
                    status: 'PROCESSED',
                    processedAt: new Date(),
                });
                await em.persist(openingTx);

                const ledgerEntry = em.create(WalletLedgerEntryEntity, {
                    walletId: wallet.id,
                    transactionId: txId,
                    direction: 'CREDIT',
                    moneyAmount: initialMoney.toJSON().amount,
                    currency,
                    balanceBefore: '0.00',
                    balanceAfter: initialMoney.toJSON().amount,
                });
                await em.persist(ledgerEntry);
            }

            await em.flush();
            return {
                id: wallet.id,
                playerId: wallet.playerId,
                balance: { amount: wallet.balanceAmount, currency: wallet.currency },
                createdAt: wallet.createdAt,
            };
        });
    }

    async getWalletById(walletId: string) {
        const wallet = await this.em.findOne(WalletEntity, { id: walletId });
        if (!wallet) throw new NotFoundException('Carteira não encontrada.');
        return {
            id: wallet.id,
            playerId: wallet.playerId,
            balance: { amount: wallet.balanceAmount, currency: wallet.currency },
            createdAt: wallet.createdAt,
        };
    }

    async getLedgerPaginated(walletId: string, cursor?: string, limitStr = '50'): Promise<PaginatedLedgerResponseDto> {
        const limit = Math.min(parseInt(limitStr, 10) || 50, 100);
        const qb = this.em.createQueryBuilder(WalletLedgerEntryEntity, 'l')
            .where({ walletId })
            .orderBy({ createdAt: 'DESC', id: 'DESC' })
            .limit(limit + 1);

        if (cursor) {
            try {
                const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
                qb.andWhere({
                    $or: [
                        { createdAt: { $lt: new Date(decoded.createdAt) } },
                        { createdAt: new Date(decoded.createdAt), id: { $lt: decoded.id } },
                    ],
                });
            } catch {
                // ignora cursor invalido
            }
        }

        const entries = await qb.getResult();
        const hasNext = entries.length > limit;
        const items = hasNext ? entries.slice(0, limit) : entries;

        let nextCursor: string | null = null;
        if (hasNext && items.length > 0) {
            const lastItem = items[items.length - 1];
            nextCursor = Buffer.from(
                JSON.stringify({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id }),
            ).toString('base64');
        }

        return {
            data: items.map((e) => ({
                id: e.id,
                transactionId: e.transactionId,
                direction: e.direction as any,
                amount: { amount: e.moneyAmount, currency: e.currency },
                balanceBefore: { amount: e.balanceBefore, currency: e.currency },
                balanceAfter: { amount: e.balanceAfter, currency: e.currency },
                createdAt: e.createdAt.toISOString(),
            })),
            nextCursor,
        };
    }

    async reconcile(walletId: string): Promise<ReconciliationResponseDto> {
        const wallet = await this.em.findOne(WalletEntity, { id: walletId });
        if (!wallet) throw new NotFoundException('Carteira não encontrada.');

        const entries = await this.em.find(WalletLedgerEntryEntity, { walletId });
        let calculatedCents = 0;

        for (const entry of entries) {
            const cents = Money.from({ amount: entry.moneyAmount, currency: entry.currency }).cents;
            if (entry.direction === 'CREDIT') {
                calculatedCents += cents;
            } else {
                calculatedCents -= cents;
            }
        }

        const calculatedBalance = Money.fromCents(calculatedCents, wallet.currency);
        const storedBalance = Money.from({ amount: wallet.balanceAmount, currency: wallet.currency });

        return {
            walletId: wallet.id,
            storedBalance: storedBalance.toJSON(),
            calculatedLedgerBalance: calculatedBalance.toJSON(),
            consistent: storedBalance.cents === calculatedBalance.cents,
        };
    }
}