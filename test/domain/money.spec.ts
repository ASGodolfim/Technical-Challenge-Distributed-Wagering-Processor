import { Money } from '../../src/domain/money';

describe('Money Value Object', () => {
    test('deve criar uma instancia valida a partir de string com 2 casas decimais', () => {
        const money = Money.from({ amount: '100.50', currency: 'BRL' });
        expect(money.toJSON()).toEqual({ amount: '100.50', currency: 'BRL' });
    });

    test('deve somar dois valores com precisao de inteiros (cents)', () => {
        const m1 = Money.from({ amount: '10.25', currency: 'BRL' });
        const m2 = Money.from({ amount: '5.75', currency: 'BRL' });
        const result = m1.add(m2);

        expect(result.toJSON().amount).toBe('16.00');
    });

    test('deve subtrair dois valores corretamente', () => {
        const m1 = Money.from({ amount: '50.00', currency: 'BRL' });
        const m2 = Money.from({ amount: '12.34', currency: 'BRL' });
        const result = m1.subtract(m2);

        expect(result.toJSON().amount).toBe('37.66');
    });

    test('deve identificar saldo negativo', () => {
        const m1 = Money.from({ amount: '10.00', currency: 'BRL' });
        const m2 = Money.from({ amount: '15.00', currency: 'BRL' });
        const result = m1.subtract(m2);

        expect(result.isNegative()).toBe(true);
    });

    test('deve lancar erro ao operar com moedas diferentes', () => {
        const brl = Money.from({ amount: '10.00', currency: 'BRL' });
        const usd = Money.from({ amount: '10.00', currency: 'USD' });

        expect(() => brl.add(usd)).toThrow();
    });
});