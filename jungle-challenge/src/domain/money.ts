import { Decimal } from 'decimal.js';

export interface MoneyProps {
    amount: string;
    currency: string;
}

export class Money {
    private constructor(
        private readonly value: Decimal,
        public readonly currency: string,
    ) { }

    static from(props: MoneyProps): Money {
        if (!/^-?\d+\.\d{2}$/.test(props.amount)) {
            throw new Error('Formato de valor inválido. Deve ser uma string decimal com 2 casas exatas (ex: "25.00").');
        }

        const value = new Decimal(props.amount);
        if (value.isNaN() || !value.isFinite()) {
            throw new Error('Valor monetário inválido.');
        }

        return new Money(value, props.currency.toUpperCase());
    }

    static zero(currency: string = 'BRL'): Money {
        return new Money(new Decimal('0.00'), currency.toUpperCase());
    }

    add(other: Money): Money {
        this.assertSameCurrency(other);
        return new Money(this.value.plus(other.value), this.currency);
    }

    subtract(other: Money): Money {
        this.assertSameCurrency(other);
        return new Money(this.value.minus(other.value), this.currency);
    }

    isNegative(): boolean {
        return this.value.isNegative();
    }

    isZero(): boolean {
        return this.value.isZero();
    }

    toJSON(): MoneyProps {
        return {
            amount: this.value.toFixed(2),
            currency: this.currency,
        };
    }

    private assertSameCurrency(other: Money): void {
        if (this.currency !== other.currency) {
            throw new Error(`Conflito de moeda: ${this.currency} vs ${other.currency}`);
        }
    }
}