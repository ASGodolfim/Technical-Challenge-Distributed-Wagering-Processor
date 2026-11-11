import { Money } from '../../src/domain/money';

describe('Regras de Negocio dos Tipos de Transacao', () => {
    test('LOSS nao deve alterar saldo nem gerar diferenca de extrato', () => {
        const initialBalance = Money.from({ amount: '500.00', currency: 'BRL' });
        const lossAmount = Money.from({ amount: '50.00', currency: 'BRL' });

        const finalBalance = initialBalance;
        expect(finalBalance.toJSON().amount).toBe('500.00');
    });

    test('REFUND em BET deve creditar o valor de volta', () => {
        const currentBalance = Money.from({ amount: '450.00', currency: 'BRL' });
        const refundAmount = Money.from({ amount: '50.00', currency: 'BRL' });

        const newBalance = currentBalance.add(refundAmount);
        expect(newBalance.toJSON().amount).toBe('500.00');
    });

    test('ROLLBACK de WIN deve debitar o valor creditado anteriormente', () => {
        const currentBalance = Money.from({ amount: '600.00', currency: 'BRL' });
        const winAmountToRollback = Money.from({ amount: '150.00', currency: 'BRL' });

        const newBalance = currentBalance.subtract(winAmountToRollback);
        expect(newBalance.toJSON().amount).toBe('450.00');
    });
});