import * as crypto from 'crypto';

export interface IntegrationEventProps<T> {
    eventId?: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt?: Date;
    version?: number;
    data: T;
}

export abstract class IntegrationEvent<T = Record<string, unknown>> {
    public readonly eventId: string;
    public readonly eventType: string;
    public readonly aggregateId: string;
    public readonly correlationId: string;
    public readonly causationId: string;
    public readonly occurredAt: Date;
    public readonly version: number;
    public readonly data: T;

    protected constructor(props: IntegrationEventProps<T>) {
        this.eventId = props.eventId ?? crypto.randomUUID();
        this.eventType = props.eventType;
        this.aggregateId = props.aggregateId;
        this.correlationId = props.correlationId;
        this.causationId = props.causationId ?? props.correlationId;
        this.occurredAt = props.occurredAt ?? new Date();
        this.version = props.version ?? 1;
        this.data = props.data;
    }

    toJSON() {
        return {
            eventId: this.eventId,
            eventType: this.eventType,
            aggregateId: this.aggregateId,
            correlationId: this.correlationId,
            causationId: this.causationId,
            occurredAt: this.occurredAt.toISOString(),
            version: this.version,
            data: this.data,
        };
    }
}