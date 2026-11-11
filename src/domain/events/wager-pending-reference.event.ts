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

export class WagerTransactionPendingReferenceEvent {
    public readonly eventType = 'WagerTransactionPendingReference';
    public readonly occurredAt: Date;

    constructor(
        public readonly aggregateId: string,
        public readonly correlationId: string,
        public readonly data: WagerPendingReferencePayload,
    ) {
        this.occurredAt = new Date();
    }

    toJSON() {
        return {
            eventType: this.eventType,
            occurredAt: this.occurredAt.toISOString(),
            aggregateId: this.aggregateId,
            correlationId: this.correlationId,
            data: this.data,
        };
    }
}