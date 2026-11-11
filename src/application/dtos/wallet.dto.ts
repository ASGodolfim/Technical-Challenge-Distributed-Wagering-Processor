import { MoneyDto } from './wager.dto';

export interface CreateWalletDto {
    playerId: string;
    initialBalance?: MoneyDto;
}

export interface LedgerQueryDto {
    cursor?: string;
    limit?: string;
}

export interface PaginatedLedgerResponseDto {
    data: Array<{
        id: string;
        transactionId: string;
        direction: 'CREDIT' | 'DEBIT';
        amount: MoneyDto;
        balanceBefore: MoneyDto;
        balanceAfter: MoneyDto;
        createdAt: string;
    }>;
    nextCursor: string | null;
}

export interface ReconciliationResponseDto {
    walletId: string;
    storedBalance: MoneyDto;
    calculatedLedgerBalance: MoneyDto;
    consistent: boolean;
}