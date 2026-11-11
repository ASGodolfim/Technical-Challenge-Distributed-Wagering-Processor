export interface ProcessWagerDto {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
    amount: string; // Ex: "50.00"
    currency: string;
    referenceExternalTransactionId?: string;
    correlationId?: string;
}

export interface ProcessWagerResult {
    transactionId: string;
    status: 'PROCESSED' | 'REJECTED' | 'FAILED';
    balanceAmount: string;
    currency: string;
    failureCode?: string;
}