import { IntegrationEvent, IntegrationEventProps } from './integration-event';

export interface WalletBalanceChangedData {
    walletId: string;
    transactionId: string;
    direction: 'DEBIT' | 'CREDIT';
    money: { amount: string; currency: string };
    balanceBefore: { amount: string; currency: string };
    balanceAfter: { amount: string; currency: string };
    walletVersion: number;
}

export class WalletBalanceChangedEvent extends IntegrationEvent<WalletBalanceChangedData> {
    readonly eventType = 'WalletBalanceChanged';
    readonly version = 1;

    constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
        super(props);
    }
}