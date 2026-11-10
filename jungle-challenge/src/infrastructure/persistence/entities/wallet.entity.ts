import { Entity, PrimaryKey, Property, Check, Unique } from '@mikro-orm/decorators/legacy';
import { Money } from '../../../domain/money';

@Entity({ tableName: 'wallets' })
@Check({ expression: 'balance_amount >= 0' })
@Unique({ properties: ['playerId', 'currency'] })
export class WalletEntity {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string;

    @Property({ type: 'uuid', fieldName: 'player_id' })
    playerId!: string;

    @Property({ type: 'varchar', length: 3 })
    currency!: string;

    @Property({ type: 'numeric', precision: 14, scale: 2, fieldName: 'balance_amount' })
    balanceAmount!: string;

    @Property({ version: true })
    version!: number;

    @Property({ type: 'timestamptz', fieldName: 'created_at', onCreate: () => new Date() })
    createdAt!: Date;

    @Property({ type: 'timestamptz', fieldName: 'updated_at', onUpdate: () => new Date(), onCreate: () => new Date() })
    updatedAt!: Date;
}