import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from '@mikro-orm/postgresql';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { OutboxMessageEntity } from '../persistence/entities/outbox-message.entity';
import { sqsClient, QUEUE_URL } from './sqs.client';

@Injectable()
export class OutboxRelayService {
    private readonly logger = new Logger(OutboxRelayService.name);
    private isProcessing = false;

    constructor(private readonly em: EntityManager) { }

    @Cron(CronExpression.EVERY_5_SECONDS)
    async processOutboxMessages(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const fork = this.em.fork();

        try {
            const pendingMessages = await fork.find(
                OutboxMessageEntity,
                { publishedAt: null },
                { limit: 20, orderBy: { occurredAt: 'ASC' } },
            );

            if (pendingMessages.length === 0) {
                this.isProcessing = false;
                return;
            }

            for (const message of pendingMessages) {
                try {
                    const command = new SendMessageCommand({
                        QueueUrl: QUEUE_URL,
                        MessageBody: JSON.stringify(message.payload),
                        MessageAttributes: {
                            EventType: {
                                DataType: 'String',
                                StringValue: message.eventType,
                            },
                            AggregateId: {
                                DataType: 'String',
                                StringValue: message.aggregateId,
                            },
                        },
                    });

                    await sqsClient.send(command);

                    message.publishedAt = new Date();
                    await fork.flush();
                    this.logger.log(`[Outbox] Evento ${message.eventType} (ID: ${message.id}) publicado no SQS com sucesso.`);
                } catch (error: any) {
                    message.attempts += 1;
                    message.nextAttemptAt = new Date(Date.now() + 10000); // Retry em 10s
                    await fork.flush();
                    this.logger.error(`[Outbox] Erro ao publicar mensagem ${message.id}: ${error.message}`);
                }
            }
        } catch (error: any) {
            this.logger.error(`[Outbox Worker] Erro no ciclo de relay: ${error.message}`);
        } finally {
            this.isProcessing = false;
        }
    }
}