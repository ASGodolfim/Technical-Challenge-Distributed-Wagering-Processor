export type WagerTransactionKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

export function affectsBalance(kind: WagerTransactionKind): boolean {
    return kind !== 'LOSS';
}