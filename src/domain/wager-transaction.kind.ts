export type WagerTransactionKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK' | 'OPENING';

export function affectsBalance(kind: WagerTransactionKind): boolean {
    return kind !== 'LOSS';
}