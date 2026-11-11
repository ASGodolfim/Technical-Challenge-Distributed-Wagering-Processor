import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ScheduleModule } from '@nestjs/schedule';
import mikroOrmConfig from './mikro-orm.config';

// Entidades
import { WalletEntity } from './infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from './infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { OutboxMessageEntity } from './infrastructure/persistence/entities/outbox-message.entity';
import { InboxMessageEntity } from './infrastructure/persistence/entities/inbox-message.entity';

// Serviços
import { WagerService } from './application/services/wager.service';
import { WalletService } from './application/services/wallet.service';
import { OutboxRelayService } from './infrastructure/messaging/outbox-relay.service';
import { SqsConsumerService } from './infrastructure/messaging/sqs-consumer.service';

// Controllers
import { WageringController } from './infrastructure/http/wager.controller';
import { WalletsController } from './infrastructure/http/wallets.controller';
import { HealthController } from './infrastructure/http/health.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MikroOrmModule.forRoot(mikroOrmConfig),
    MikroOrmModule.forFeature([
      WalletEntity,
      WagerTransactionEntity,
      WalletLedgerEntryEntity,
      OutboxMessageEntity,
      InboxMessageEntity,
    ]),
  ],
  controllers: [WageringController, WalletsController, HealthController],
  providers: [WagerService, WalletService, OutboxRelayService, SqsConsumerService],
})
export class AppModule { }