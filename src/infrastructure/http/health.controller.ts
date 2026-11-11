import { Controller, Get, HttpStatus, HttpCode } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { sqsClient } from '../messaging/sqs.client';
import { ListQueuesCommand } from '@aws-sdk/client-sqs';

@Controller('health')
export class HealthController {
    constructor(private readonly em: EntityManager) { }

    @Get('live')
    @HttpCode(HttpStatus.OK)
    getLive() {
        return { status: 'ok' };
    }

    @Get('ready')
    async getReady() {
        let pgStatus = 'down';
        let sqsStatus = 'down';

        try {
            await this.em.getConnection().execute('SELECT 1');
            pgStatus = 'up';
        } catch { }

        try {
            await sqsClient.send(new ListQueuesCommand({}));
            sqsStatus = 'up';
        } catch { }

        const isReady = pgStatus === 'up' && sqsStatus === 'up';
        return {
            status: isReady ? 'ok' : 'down',
            checks: {
                postgres: pgStatus,
                sqs: sqsStatus,
            },
        };
    }
}