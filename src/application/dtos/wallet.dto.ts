import { MoneyDto } from './wager.dto';

export class CreateWalletDto {
    playerId!: string;
    initialBalance?: MoneyDto;
}

export class LedgerQueryDto {
    cursor?: string;
    limit?: string;
}

export class PaginatedLedgerResponseDto {
    data!: Array<{
        id: string;
        transactionId: string;
        direction: 'CREDIT' | 'DEBIT';
        amount: MoneyDto;
        balanceBefore: MoneyDto;
        balanceAfter: MoneyDto;
        createdAt: string;
    }>;
    nextCursor!: string | null;
}

export class ReconciliationResponseDto {
    walletId!: string;
    storedBalance!: MoneyDto;
    calculatedLedgerBalance!: MoneyDto;
    consistent!: boolean;
}