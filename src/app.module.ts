import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ScheduleModule } from '@nestjs/schedule';
import mikroOrmConfig from './mikro-orm.config';

import { WalletEntity } from './infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from './infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { OutboxMessageEntity } from './infrastructure/persistence/entities/outbox-message.entity';
import { InboxMessageEntity } from './infrastructure/persistence/entities/inbox-message.entity';

import { WagerService } from './application/services/wager.service';
import { WalletService } from './application/services/wallet.service';
import { OutboxRelayService } from './infrastructure/messaging/outbox-relay.service';
import { SqsConsumerService } from './infrastructure/messaging/sqs-consumer.service';
import { PendingReferenceWorkerService } from './infrastructure/messaging/pending-reference-worker.service';

import { WageringController } from './infrastructure/http/wager.controller';
import { WalletsController } from './infrastructure/http/wallets.controller';
import { HealthController } from './infrastructure/http/health.controller';
import { AuthGuard } from './infrastructure/http/guards/auth.guard';
import { CorrelationMiddleware } from './infrastructure/observability/correlation.middleware';
import { StructuredLogger } from './infrastructure/observability/structured-logger.service';

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
  providers: [
    StructuredLogger,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    WagerService,
    WalletService,
    OutboxRelayService,
    SqsConsumerService,
    PendingReferenceWorkerService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}