import type { WagerTransactionKind } from '../../domain/wager-transaction.kind';

export type { WagerTransactionKind };
export type WagerTransactionStatus = 'PROCESSED' | 'REJECTED' | 'PENDING_REFERENCE';

export class MoneyDto {
    amount!: string;
    currency!: string;
}

export class ProcessWagerRequestDto {
    providerId!: string;
    externalTransactionId!: string;
    playerId!: string;
    walletId!: string;
    roundId!: string;
    gameId!: string;
    kind!: WagerTransactionKind;
    money!: MoneyDto;
    referenceExternalTransactionId?: string;
    correlationId?: string;
}

export class ProcessWagerResponseDto {
    transactionId!: string;
    status!: WagerTransactionStatus;
    balance!: MoneyDto;
    idempotentReplay!: boolean;
    failureCode?: string;
}