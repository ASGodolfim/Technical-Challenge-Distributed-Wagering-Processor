import { Controller, Post, Get, Body, Headers, Param } from '@nestjs/common';
import { WagerService } from '../../application/services/wager.service';
import { ProcessWagerRequestDto } from '../../application/dtos/wager.dto';

@Controller()
export class WageringController {
    constructor(private readonly wagerService: WagerService) { }

    @Post('/wagering/transactions')
    async processTransaction(
        @Headers('idempotency-key') idempotencyKey: string,
        @Body() body: ProcessWagerRequestDto,
    ) {
        return await this.wagerService.processWager(body, idempotencyKey);
    }

    @Get('/wagering/transactions/:transactionId')
    async getById(@Param('transactionId') transactionId: string) {
        return await this.wagerService.getTransactionById(transactionId);
    }

    @Get('/providers/:providerId/wagering/transactions/:externalTransactionId')
    async getByExternalId(
        @Param('providerId') providerId: string,
        @Param('externalTransactionId') externalTransactionId: string,
    ) {
        return await this.wagerService.getTransactionByExternalId(providerId, externalTransactionId);
    }
}