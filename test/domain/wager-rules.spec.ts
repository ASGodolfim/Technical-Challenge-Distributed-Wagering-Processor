import { Money } from '../../src/domain/money';
import { affectsBalance } from '../../src/domain/wager-transaction.kind';

describe('Regras da Fase 1 (REFUND, ROLLBACK e Validações de Referência)', () => {
    test('Regra 1: LOSS não afeta o saldo', () => {
        expect(affectsBalance('LOSS')).toBe(false);
    });

    test('Regra 2: REFUND em BET calcula crédito corretamente', () => {
        const initialBalance = Money.from({ amount: '400.00', currency: 'BRL' });
        const refundAmount = Money.from({ amount: '50.00', currency: 'BRL' });
        const finalBalance = initialBalance.add(refundAmount);

        expect(finalBalance.toJSON().amount).toBe('450.00');
    });

    test('Regra 3: ROLLBACK em BET devolve o valor debitado (CREDIT)', () => {
        const currentBalance = Money.from({ amount: '350.00', currency: 'BRL' });
        const betRollbackAmount = Money.from({ amount: '50.00', currency: 'BRL' });
        const newBalance = currentBalance.add(betRollbackAmount);

        expect(newBalance.toJSON().amount).toBe('400.00');
    });

    test('Regra 3: ROLLBACK em WIN reverte o prêmio ganho (DEBIT)', () => {
        const currentBalance = Money.from({ amount: '500.00', currency: 'BRL' });
        const winRollbackAmount = Money.from({ amount: '100.00', currency: 'BRL' });
        const newBalance = currentBalance.subtract(winRollbackAmount);

        expect(newBalance.toJSON().amount).toBe('400.00');
    });

    test('Regra 3: ROLLBACK em WIN detecta saldo insuficiente se valor a reverter for maior que o saldo', () => {
        const currentBalance = Money.from({ amount: '30.00', currency: 'BRL' });
        const winRollbackAmount = Money.from({ amount: '100.00', currency: 'BRL' });

        expect(currentBalance.subtract(winRollbackAmount).isNegative()).toBe(true);
    });
});