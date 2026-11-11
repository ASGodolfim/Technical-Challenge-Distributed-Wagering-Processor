import { Money } from '../../src/domain/money';

describe('Contratos HTTP e Estrutura de Resposta', () => {
    test('deve formatar objeto de moeda aninhado corretamente', () => {
        const money = Money.from({ amount: '25.00', currency: 'BRL' });
        expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    });

    test('deve calcular reconciliacao de saldo do ledger em centavos com precisao', () => {
        const initial = Money.from({ amount: '100.00', currency: 'BRL' }).cents;
        const bet = Money.from({ amount: '30.00', currency: 'BRL' }).cents;
        const win = Money.from({ amount: '50.00', currency: 'BRL' }).cents;

        const finalCents = initial - bet + win;
        const calculated = Money.fromCents(finalCents, 'BRL');

        expect(calculated.toJSON()).toEqual({ amount: '120.00', currency: 'BRL' });
    });
});