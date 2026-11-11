import { IntegrationEvent } from './integration-event';

export interface WalletBalanceChangedData {
    walletId: string;
    transactionId: string;
    direction: 'CREDIT' | 'DEBIT';
    money: { amount: string; currency: string };
    balanceBefore: { amount: string; currency: string };
    balanceAfter: { amount: string; currency: string };
    walletVersion: number;
}

export class WalletBalanceChangedEvent extends IntegrationEvent<WalletBalanceChangedData> {
    constructor(props: {
        aggregateId: string;
        correlationId: string;
        causationId?: string;
        version?: number;
        data: WalletBalanceChangedData;
    }) {
        super({
            ...props,
            eventType: 'WalletBalanceChanged',
        });
    }
}