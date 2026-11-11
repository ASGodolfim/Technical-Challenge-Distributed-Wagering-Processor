export type WagerTransactionKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
export type WagerTransactionStatus = 'PROCESSED' | 'REJECTED' | 'PENDING_REFERENCE';

export interface ProcessWagerDto {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    amount: string;
    currency: string;
    referenceExternalTransactionId?: string;
    correlationId?: string;
}

export interface ProcessWagerResult {
    transactionId: string;
    status: WagerTransactionStatus;
    balanceAmount: string;
    currency: string;
    failureCode?: string;
}