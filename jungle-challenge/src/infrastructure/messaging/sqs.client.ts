import { SQSClient, CreateQueueCommand } from '@aws-sdk/client-sqs';

export const sqsClient = new SQSClient({
    region: 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
    credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
    },
});

export const QUEUE_NAME = 'wallet-events';
export const QUEUE_URL = process.env.SQS_QUEUE_URL || `http://localhost:4566/000000000000/${QUEUE_NAME}`;

export async function ensureQueueExists(): Promise<void> {
    try {
        await sqsClient.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
        console.log(`✅ Fila SQS '${QUEUE_NAME}' criada/verificada no LocalStack.`);
    } catch (error: any) {
        console.warn(`⚠️ Aviso na criação da fila SQS: ${error.message}`);
    }
}