import { IntegrationEvent } from './integration-event';

export interface WagerTransactionRejectedData {
    transactionId: string;
    providerId: string;
    externalTransactionId: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: { amount: string; currency: string };
    failureCode: string;
    referenceExternalTransactionId?: string;
}

export class WagerTransactionRejectedEvent extends IntegrationEvent<WagerTransactionRejectedData> {
    constructor(props: {
        aggregateId: string;
        correlationId: string;
        causationId?: string;
        version?: number;
        data: WagerTransactionRejectedData;
    }) {
        super({
            ...props,
            eventType: 'WagerTransactionRejected',
        });
    }
}