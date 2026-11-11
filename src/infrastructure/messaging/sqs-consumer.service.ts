import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from '@mikro-orm/postgresql';
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { InboxMessageEntity } from '../persistence/entities/inbox-message.entity';
import { sqsClient, QUEUE_URL } from './sqs.client';
import * as crypto from 'crypto';

@Injectable()
export class SqsConsumerService {
    private readonly logger = new Logger(SqsConsumerService.name);
    private isConsuming = false;

    constructor(private readonly em: EntityManager) { }

    @Cron(CronExpression.EVERY_5_SECONDS)
    async consumeMessages(): Promise<void> {
        if (this.isConsuming) return;
        this.isConsuming = true;

        try {
            const receiveCommand = new ReceiveMessageCommand({
                QueueUrl: QUEUE_URL,
                MaxNumberOfMessages: 10,
                WaitTimeSeconds: 2,
                MessageAttributeNames: ['All'],
            });

            const response = await sqsClient.send(receiveCommand);

            if (!response.Messages || response.Messages.length === 0) {
                this.isConsuming = false;
                return;
            }

            for (const message of response.Messages) {
                if (!message.MessageId || !message.Body) continue;

                const fork = this.em.fork();
                const consumerName = 'WalletBalanceChangedConsumer';

                try {
                    await fork.transactional(async (em) => {
                        const existingInbox = await em.findOne(InboxMessageEntity, {
                            consumerName,
                            messageId: message.MessageId,
                        });

                        if (existingInbox) {
                            this.logger.warn(`[Inbox] Mensagem ${message.MessageId} já processada anteriormente. Descartando.`);
                            return;
                        }

                        const payloadHash = crypto
                            .createHash('sha256')
                            .update(message.Body)
                            .digest('hex');

                        const inboxRecord = em.create(InboxMessageEntity, {
                            messageId: message.MessageId,
                            consumerName,
                            payloadHash,
                            receivedAt: new Date(),
                            processedAt: new Date(),
                        });
                        await em.persist(inboxRecord);

                        const eventPayload = JSON.parse(message.Body);
                        this.logger.log(`[Inbox Consumer] Evento ${eventPayload.eventType} processado com sucesso.`);
                    });

                    await sqsClient.send(
                        new DeleteMessageCommand({
                            QueueUrl: QUEUE_URL,
                            ReceiptHandle: message.ReceiptHandle,
                        }),
                    );
                } catch (error: any) {
                    this.logger.error(`[Inbox Consumer] Erro ao processar mensagem ${message.MessageId}: ${error.message}`);
                }
            }
        } catch (error: any) {
        } finally {
            this.isConsuming = false;
        }
    }
}