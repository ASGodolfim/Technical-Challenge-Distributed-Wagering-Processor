import { SQSClient } from '@aws-sdk/client-sqs';

export const sqsClient = new SQSClient({
    region: 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
    credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
    },
});

export const QUEUE_URL = process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/wallet-events';