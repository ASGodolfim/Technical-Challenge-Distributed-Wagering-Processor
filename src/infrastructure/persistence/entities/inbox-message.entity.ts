import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'inbox_messages' })
@Unique({ properties: ['consumerName', 'messageId'] })
export class InboxMessageEntity {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string;

    @Property({ type: 'varchar', length: 255, fieldName: 'message_id' })
    messageId!: string;

    @Property({ type: 'varchar', length: 100, fieldName: 'consumer_name' })
    consumerName!: string;

    @Property({ type: 'varchar', length: 64, fieldName: 'payload_hash' })
    payloadHash!: string;

    @Property({ type: 'timestamptz', fieldName: 'received_at', onCreate: () => new Date() })
    receivedAt!: Date;

    @Property({ type: 'timestamptz', nullable: true, fieldName: 'processed_at' })
    processedAt?: Date;
}