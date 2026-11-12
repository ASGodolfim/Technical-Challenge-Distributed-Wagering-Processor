import { MiddlewareConsumer, Module, NestModule, OnModuleInit } from '@nestjs/common';
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

import { CreateQueueCommand } from '@aws-sdk/client-sqs';
import { sqsClient } from './infrastructure/messaging/sqs.client';

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

export class AppModule implements NestModule, OnModuleInit {
  async onModuleInit() {
    const queueUrl =
      process.env.SQS_QUEUE_URL || 'http://localhost:9324/000000000000/wallet-events-queue';
    const queueName = queueUrl.split('/').pop() || 'wallet-events-queue';
    await sqsClient.send(new CreateQueueCommand({ QueueName: queueName })).catch(() => { });
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}