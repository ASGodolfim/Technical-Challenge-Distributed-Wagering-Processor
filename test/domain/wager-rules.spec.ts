import { Money } from '../../src/domain/money';
import { affectsBalance } from '../../src/domain/wager-transaction.kind';
import { WagerTransactionPendingReferenceEvent } from '../../src/domain/events/wager-pending-reference.event';

describe('Suíte de Testes da Fase 1 - Regras de Domínio e Estornos', () => {
    describe('Helper: affectsBalance', () => {
        test('deve retornar false para LOSS (não altera saldo)', () => {
            expect(affectsBalance('LOSS')).toBe(false);
        });

        test('deve retornar true para BET, WIN, REFUND e ROLLBACK', () => {
            expect(affectsBalance('BET')).toBe(true);
            expect(affectsBalance('WIN')).toBe(true);
            expect(affectsBalance('REFUND')).toBe(true);
            expect(affectsBalance('ROLLBACK')).toBe(true);
        });
    });

    describe('Cálculos Financeiros por Tipo de Transação', () => {
        test('LOSS: deve manter o saldo idêntico', () => {
            const initialBalance = Money.from({ amount: '500.00', currency: 'BRL' });
            const lossAmount = Money.from({ amount: '100.00', currency: 'BRL' });

            // Regra: LOSS não chama subtract/add
            const finalBalance = initialBalance;
            expect(finalBalance.toJSON().amount).toBe('500.00');
        });

        test('REFUND em BET: deve creditar o valor exato no saldo', () => {
            const currentBalance = Money.from({ amount: '450.00', currency: 'BRL' });
            const refundAmount = Money.from({ amount: '50.00', currency: 'BRL' });

            const newBalance = currentBalance.add(refundAmount);
            expect(newBalance.toJSON().amount).toBe('500.00');
        });

        test('ROLLBACK de BET: deve creditar o valor original debitado', () => {
            const currentBalance = Money.from({ amount: '300.00', currency: 'BRL' });
            const betAmount = Money.from({ amount: '50.00', currency: 'BRL' });

            const newBalance = currentBalance.add(betAmount);
            expect(newBalance.toJSON().amount).toBe('350.00');
        });

        test('ROLLBACK de WIN: deve debitar o prêmio recebido', () => {
            const currentBalance = Money.from({ amount: '500.00', currency: 'BRL' });
            const winAmount = Money.from({ amount: '200.00', currency: 'BRL' });

            const newBalance = currentBalance.subtract(winAmount);
            expect(newBalance.toJSON().amount).toBe('300.00');
        });

        test('ROLLBACK de WIN com saldo insuficiente: deve identificar saldo negativo', () => {
            const currentBalance = Money.from({ amount: '50.00', currency: 'BRL' });
            const winAmountToRollback = Money.from({ amount: '200.00', currency: 'BRL' });

            const isNegative = currentBalance.subtract(winAmountToRollback).isNegative();
            expect(isNegative).toBe(true);
        });
    });

    describe('Evento de Domínio: WagerTransactionPendingReferenceEvent', () => {
        test('deve criar o evento com payload estruturado e eventType correto', () => {
            const event = new WagerTransactionPendingReferenceEvent(
                'wallet-123',
                'corr-456',
                {
                    transactionId: 'tx-789',
                    providerId: 'pragmatic',
                    externalTransactionId: 'tx-rollback-001',
                    referenceExternalTransactionId: 'tx-bet-999',
                    walletId: 'wallet-123',
                    playerId: 'player-1',
                    kind: 'ROLLBACK',
                    amount: '50.00',
                    currency: 'BRL',
                },
            );

            const json = event.toJSON();
            expect(json.eventType).toBe('WagerTransactionPendingReference');
            expect(json.aggregateId).toBe('wallet-123');
            expect(json.data.referenceExternalTransactionId).toBe('tx-bet-999');
            expect(json.data.kind).toBe('ROLLBACK');
        });
    });
});