import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from '@mikro-orm/postgresql';
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { sqsClient } from './sqs.client';
import { InboxMessageEntity } from '../persistence/entities/inbox-message.entity';

@Injectable()
export class SqsConsumerService {
    private readonly logger = new Logger(SqsConsumerService.name);
    private readonly consumerName = 'wagering-events-consumer';
    private readonly queueUrl =
        process.env.SQS_QUEUE_URL || 'http://localhost:9324/000000000000/wallet-events-queue';

    constructor(private readonly em: EntityManager) { }

    @Cron(CronExpression.EVERY_5_SECONDS)
    async pollMessages() {
        try {
            const response = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: this.queueUrl,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 1,
                }),
            );

            if (!response.Messages || response.Messages.length === 0) return;

            for (const msg of response.Messages) {
                if (!msg.MessageId || !msg.Body || !msg.ReceiptHandle) continue;
                await this.consumeWithInboxDeduplication(msg.MessageId, msg.Body, msg.ReceiptHandle);
            }
        } catch (error) {
            this.logger.error('Erro ao ler mensagens do SQS', error);
        }
    }

    async consumeWithInboxDeduplication(
        messageId: string,
        rawBody: string,
        receiptHandle: string,
    ): Promise<boolean> {
        const fork = this.em.fork();
        const parsed = JSON.parse(rawBody);
        const eventType = parsed.eventType ?? 'UnknownEvent';

        try {
            const processed = await fork.transactional(async (em) => {
                // Deduplicação transacional por chave composta (consumerName, messageId)
                const alreadyProcessed = await em.findOne(InboxMessageEntity, {
                    consumerName: this.consumerName,
                    messageId,
                });

                if (alreadyProcessed) {
                    this.logger.debug(`Mensagem duplicada ignorada via Inbox: (${this.consumerName}, ${messageId})`);
                    return false;
                }

                const inboxRecord = em.create(InboxMessageEntity, {
                    consumerName: this.consumerName,
                    messageId,
                    eventType,
                    processedAt: new Date(),
                });
                await em.persist(inboxRecord);

                // Processamento idempotente do evento recebido
                this.logger.log(`Evento [${eventType}] consumido (eventId=${parsed.eventId}, correlationId=${parsed.correlationId})`);

                await em.flush();
                return true;
            });

            await sqsClient.send(
                new DeleteMessageCommand({
                    QueueUrl: this.queueUrl,
                    ReceiptHandle: receiptHandle,
                }),
            );

            return processed;
        } catch (err: any) {
            // Trata corrida concorrente onde a restrição UNIQUE (23505) bloqueou inserção duplicada
            if (err?.code === '23505') {
                this.logger.debug(`Concorrência bloqueada pela constraint UNIQUE do Inbox: ${messageId}`);
                await sqsClient.send(
                    new DeleteMessageCommand({
                        QueueUrl: this.queueUrl,
                        ReceiptHandle: receiptHandle,
                    }),
                );
                return false;
            }
            throw err;
        }
    }
}