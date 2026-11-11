import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import * as crypto from 'crypto';

@Entity({ tableName: 'inbox_messages' })
@Unique({ properties: ['consumerName', 'messageId'] })
export class InboxMessageEntity {
    @PrimaryKey({ type: 'uuid' })
    id: string = crypto.randomUUID();

    @Property({ type: 'string' })
    consumerName!: string;

    @Property({ type: 'string' })
    messageId!: string;

    @Property({ type: 'string', nullable: true })
    eventType?: string;

    @Property({ type: 'Date' })
    processedAt: Date = new Date();
}