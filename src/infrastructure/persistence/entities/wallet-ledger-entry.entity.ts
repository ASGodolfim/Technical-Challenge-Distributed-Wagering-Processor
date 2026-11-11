import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallet_ledger_entries' })
export class WalletLedgerEntryEntity {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string;

    @Property({ type: 'uuid', fieldName: 'wallet_id' })
    walletId!: string;

    @Property({ type: 'uuid', fieldName: 'transaction_id' })
    transactionId!: string;

    @Property({ type: 'varchar', length: 20 })
    direction!: string; // DEBIT, CREDIT

    @Property({ type: 'numeric', precision: 14, scale: 2, fieldName: 'money_amount' })
    moneyAmount!: string;

    @Property({ type: 'varchar', length: 3 })
    currency!: string;

    @Property({ type: 'numeric', precision: 14, scale: 2, fieldName: 'balance_before' })
    balanceBefore!: string;

    @Property({ type: 'numeric', precision: 14, scale: 2, fieldName: 'balance_after' })
    balanceAfter!: string;

    @Property({ type: 'timestamptz', fieldName: 'created_at', onCreate: () => new Date() })
    createdAt!: Date;
}