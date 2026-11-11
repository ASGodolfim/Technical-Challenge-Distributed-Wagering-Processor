import { Migration } from '@mikro-orm/migrations';

export class Migration20261110194640 extends Migration {

  override name = 'Migration20261110194640';

  override up(): void | Promise<void> {
    this.addSql(`create table "inbox_messages" ("id" uuid not null default gen_random_uuid(), "message_id" varchar(255) not null, "consumer_name" varchar(100) not null, "payload_hash" varchar(64) not null, "received_at" timestamptz not null, "processed_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "inbox_messages" add constraint "inbox_messages_consumer_name_message_id_unique" unique ("consumer_name", "message_id");`);

    this.addSql(`create table "outbox_messages" ("id" uuid not null default gen_random_uuid(), "aggregate_id" uuid not null, "event_type" varchar(100) not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null default 0, "next_attempt_at" timestamptz null, "published_at" timestamptz null, primary key ("id"));`);

    this.addSql(`create table "wager_transactions" ("id" uuid not null default gen_random_uuid(), "provider_id" varchar(100) not null, "external_transaction_id" varchar(255) not null, "idempotency_key" varchar(255) not null, "payload_hash" varchar(64) not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" varchar(100) not null, "game_id" varchar(100) not null, "kind" varchar(50) not null, "money_amount" numeric(14,2) not null, "currency" varchar(3) not null, "reference_external_transaction_id" varchar(255) null, "status" varchar(50) not null, "reference_transaction_id" uuid null, "failure_code" varchar(100) null, "processed_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`);

    this.addSql(`create table "wallets" ("id" uuid not null default gen_random_uuid(), "player_id" uuid not null, "currency" varchar(3) not null, "balance_amount" numeric(14,2) not null, "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`);

    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null default gen_random_uuid(), "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" varchar(20) not null, "money_amount" numeric(14,2) not null, "currency" varchar(3) not null, "balance_before" numeric(14,2) not null, "balance_after" numeric(14,2) not null, "created_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`alter table "wallets" add constraint "wallets_check" check (balance_amount >= 0);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallets" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
  }

}
