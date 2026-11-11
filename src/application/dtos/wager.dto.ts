export type WagerTransactionKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

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
    status: 'PROCESSED' | 'REJECTED';
    balanceAmount: string;
    currency: string;
    failureCode?: string;
}