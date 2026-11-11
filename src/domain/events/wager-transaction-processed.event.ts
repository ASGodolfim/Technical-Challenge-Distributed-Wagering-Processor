import { IntegrationEvent } from './integration-event';

export interface WagerTransactionProcessedData {
    transactionId: string;
    providerId: string;
    externalTransactionId: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
}

export class WagerTransactionProcessedEvent extends IntegrationEvent<WagerTransactionProcessedData> {
    constructor(props: {
        aggregateId: string;
        correlationId: string;
        causationId?: string;
        version?: number;
        data: WagerTransactionProcessedData;
    }) {
        super({
            ...props,
            eventType: 'WagerTransactionProcessed',
        });
    }
}