import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from './mikro-orm.config';
import { WalletEntity } from './infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from './infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from './infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from './infrastructure/persistence/entities/outbox-message.entity';
import { WagerService } from './application/services/wager.service';
import { WagerController } from './infrastructure/http/wager.controller';
import { OutboxRelayService } from './infrastructure/messaging/outbox-relay.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MikroOrmModule.forRoot(mikroOrmConfig),
    MikroOrmModule.forFeature([
      WalletEntity,
      WagerTransactionEntity,
      WalletLedgerEntryEntity,
      InboxMessageEntity,
      OutboxMessageEntity,
    ]),
  ],
  controllers: [WagerController],
  providers: [WagerService, OutboxRelayService],
})
export class AppModule { }
