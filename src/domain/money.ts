export interface MoneyProps {
    amount: string;
    currency: string;
}

export class Money {
    private constructor(
        private readonly _cents: number,
        public readonly currency: string,
    ) { }

    static from(props: MoneyProps): Money {
        const { amount, currency } = props;

        if (!currency || currency.trim().length !== 3) {
            throw new Error(`Moeda inválida: ${currency}`);
        }

        if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) {
            throw new Error(`Formato de valor monetário inválido: ${amount}`);
        }

        const isNegative = amount.startsWith('-');
        const clean = isNegative ? amount.slice(1) : amount;
        const [wholePart, decimalPart = ''] = clean.split('.');
        const paddedDecimals = decimalPart.padEnd(2, '0');

        const totalCents = parseInt(wholePart, 10) * 100 + parseInt(paddedDecimals, 10);
        return new Money(isNegative ? -totalCents : totalCents, currency.toUpperCase());
    }

    static fromCents(cents: number, currency: string): Money {
        if (!Number.isInteger(cents)) {
            throw new Error(`Valor em centavos deve ser um inteiro: ${cents}`);
        }
        return new Money(cents, currency.toUpperCase());
    }

    get cents(): number {
        return this._cents;
    }

    add(other: Money): Money {
        this.assertSameCurrency(other);
        return new Money(this._cents + other._cents, this.currency);
    }

    subtract(other: Money): Money {
        this.assertSameCurrency(other);
        return new Money(this._cents - other._cents, this.currency);
    }

    isNegative(): boolean {
        return this._cents < 0;
    }

    isZero(): boolean {
        return this._cents === 0;
    }

    toJSON(): MoneyProps {
        return {
            amount: (this._cents / 100).toFixed(2),
            currency: this.currency,
        };
    }

    private assertSameCurrency(other: Money): void {
        if (this.currency !== other.currency) {
            throw new Error(`Operação inválida entre moedas diferentes: ${this.currency} e ${other.currency}`);
        }
    }
}