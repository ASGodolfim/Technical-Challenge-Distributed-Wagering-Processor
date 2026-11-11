import { WagerTransactionKind } from '../../domain/wager-transaction.kind';

export { WagerTransactionKind };
export type WagerTransactionStatus = 'PROCESSED' | 'REJECTED' | 'PENDING_REFERENCE';

export interface MoneyDto {
    amount: string;
    currency: string;
}

export interface ProcessWagerRequestDto {
    providerId: string;
    externalTransactionId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyDto;
    referenceExternalTransactionId?: string;
    correlationId?: string;
}

export interface ProcessWagerResponseDto {
    transactionId: string;
    status: WagerTransactionStatus;
    balance: MoneyDto;
    idempotentReplay: boolean;
    failureCode?: string;
}