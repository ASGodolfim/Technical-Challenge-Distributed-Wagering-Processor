import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { WalletService } from '../../application/services/wallet.service';
import { CreateWalletDto } from '../../application/dtos/wallet.dto';

@Controller('wallets')
export class WalletsController {
    constructor(private readonly walletService: WalletService) { }

    @Post()
    async createWallet(@Body() body: CreateWalletDto) {
        return await this.walletService.createWallet(body);
    }

    @Get(':walletId')
    async getWallet(@Param('walletId') walletId: string) {
        return await this.walletService.getWalletById(walletId);
    }

    @Get(':walletId/ledger')
    async getLedger(
        @Param('walletId') walletId: string,
        @Query('cursor') cursor?: string,
        @Query('limit') limit?: string,
    ) {
        return await this.walletService.getLedgerPaginated(walletId, cursor, limit);
    }

    @Post(':walletId/reconciliation')
    async reconcile(@Param('walletId') walletId: string) {
        return await this.walletService.reconcile(walletId);
    }
}