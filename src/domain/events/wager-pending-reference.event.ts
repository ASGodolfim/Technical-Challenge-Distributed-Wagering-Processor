import { IntegrationEvent } from './integration-event';

export interface WagerPendingReferencePayload {
    transactionId: string;
    providerId: string;
    externalTransactionId: string;
    referenceExternalTransactionId: string;
    walletId: string;
    playerId: string;
    kind: string;
    amount: string;
    currency: string;
}

export class WagerTransactionPendingReferenceEvent extends IntegrationEvent<WagerPendingReferencePayload> {
    constructor(props: {
        aggregateId: string;
        correlationId: string;
        causationId?: string;
        version?: number;
        data: WagerPendingReferencePayload;
    }) {
        super({
            ...props,
            eventType: 'WagerTransactionPendingReference',
        });
    }
}