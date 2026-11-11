import { Migration } from '@mikro-orm/migrations';

export class Migration20261111222811 extends Migration {

  override name = 'Migration20261111222811';

  override up(): void | Promise<void> {
    this.addSql(`alter table "inbox_messages" drop column "payload_hash", drop column "received_at";`);
    this.addSql(`alter table "inbox_messages" add "event_type" varchar(255) null;`);
    this.addSql(`alter table "inbox_messages" alter column "consumer_name" type varchar(255) using ("consumer_name"::varchar(255));`);
    this.addSql(`alter table "inbox_messages" alter column "id" drop default;`);
    this.addSql(`alter table "inbox_messages" alter column "processed_at" set not null;`);

    this.addSql(`alter table "wager_transactions" add "retry_count" int not null default 0, add "next_retry_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "inbox_messages" drop column "event_type";`);
    this.addSql(`alter table "inbox_messages" add "payload_hash" varchar(64) not null, add "received_at" timestamptz(6) not null;`);
    this.addSql(`alter table "inbox_messages" alter column "id" set default gen_random_uuid();`);
    this.addSql(`alter table "inbox_messages" alter column "consumer_name" type varchar(100) using ("consumer_name"::varchar(100));`);
    this.addSql(`alter table "inbox_messages" alter column "processed_at" drop not null;`);

    this.addSql(`alter table "wager_transactions" drop column "retry_count", drop column "next_retry_at";`);
  }

}
