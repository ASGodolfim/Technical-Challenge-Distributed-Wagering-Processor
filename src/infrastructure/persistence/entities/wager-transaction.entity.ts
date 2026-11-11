import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wager_transactions' })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
@Unique({ properties: ['idempotencyKey'] })
export class WagerTransactionEntity {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string;

    @Property({ type: 'varchar', length: 100, fieldName: 'provider_id' })
    providerId!: string;

    @Property({ type: 'varchar', length: 255, fieldName: 'external_transaction_id' })
    externalTransactionId!: string;

    @Property({ type: 'varchar', length: 255, fieldName: 'idempotency_key' })
    idempotencyKey!: string;

    @Property({ type: 'varchar', length: 64, fieldName: 'payload_hash' })
    payloadHash!: string;

    @Property({ type: 'uuid', fieldName: 'wallet_id' })
    walletId!: string;

    @Property({ type: 'uuid', fieldName: 'player_id' })
    playerId!: string;

    @Property({ type: 'varchar', length: 100, fieldName: 'round_id' })
    roundId!: string;

    @Property({ type: 'varchar', length: 100, fieldName: 'game_id' })
    gameId!: string;

    @Property({ type: 'varchar', length: 50 })
    kind!: string; // BET, WIN, LOSS, REFUND, ROLLBACK, OPENING

    @Property({ type: 'numeric', precision: 14, scale: 2, fieldName: 'money_amount' })
    moneyAmount!: string;

    @Property({ type: 'varchar', length: 3 })
    currency!: string;

    @Property({ type: 'varchar', length: 255, nullable: true, fieldName: 'reference_external_transaction_id' })
    referenceExternalTransactionId?: string;

    @Property({ type: 'varchar', length: 50 })
    status!: string; // PENDING, PENDING_REFERENCE, PROCESSED, REJECTED, FAILED

    @Property({ type: 'uuid', nullable: true, fieldName: 'reference_transaction_id' })
    referenceTransactionId?: string;

    @Property({ type: 'varchar', length: 100, nullable: true, fieldName: 'failure_code' })
    failureCode?: string;

    @Property({ type: 'timestamptz', nullable: true, fieldName: 'processed_at' })
    processedAt?: Date;

    @Property({ type: 'timestamptz', fieldName: 'created_at', onCreate: () => new Date() })
    createdAt!: Date;
}