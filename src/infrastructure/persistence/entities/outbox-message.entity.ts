import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'outbox_messages' })
export class OutboxMessageEntity {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string;

    @Property({ type: 'uuid', fieldName: 'aggregate_id' })
    aggregateId!: string;

    @Property({ type: 'varchar', length: 100, fieldName: 'event_type' })
    eventType!: string;

    @Property({ type: 'jsonb' })
    payload!: Record<string, unknown>;

    @Property({ type: 'timestamptz', fieldName: 'occurred_at' })
    occurredAt!: Date;

    @Property({ type: 'integer', default: 0 })
    attempts!: number;

    @Property({ type: 'timestamptz', nullable: true, fieldName: 'next_attempt_at' })
    nextAttemptAt?: Date;

    @Property({ type: 'timestamptz', nullable: true, fieldName: 'published_at' })
    publishedAt?: Date;
}