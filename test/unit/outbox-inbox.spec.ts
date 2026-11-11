import { WagerTransactionProcessedEvent } from '../../src/domain/events/wager-transaction-processed.event';
import { WagerTransactionRejectedEvent } from '../../src/domain/events/wager-transaction-rejected.event';
import { PendingReferenceWorkerService } from '../../src/infrastructure/messaging/pending-reference-worker.service';

describe('Fase 3: Envelope IntegrationEvent e Backoff Exponencial', () => {
    test('deve preencher todos os campos obrigatórios de IntegrationEvent<T>', () => {
        const processed = new WagerTransactionProcessedEvent({
            aggregateId: 'tx-1',
            correlationId: 'corr-1',
            causationId: 'cause-1',
            data: {
                transactionId: 'tx-1',
                providerId: 'pragmatic',
                externalTransactionId: 'ext-1',
                walletId: 'w-1',
                playerId: 'p-1',
                roundId: 'r-1',
                gameId: 'g-1',
                kind: 'BET',
                money: { amount: '50.00', currency: 'BRL' },
            },
        });

        const json = processed.toJSON();
        expect(typeof json.eventId).toBe('string');
        expect(json.eventType).toBe('WagerTransactionProcessed');
        expect(json.aggregateId).toBe('tx-1');
        expect(json.correlationId).toBe('corr-1');
        expect(json.causationId).toBe('cause-1');
        expect(typeof json.occurredAt).toBe('string');
        expect(json.version).toBe(1);
        expect(json.data.transactionId).toBe('tx-1');
    });

    test('deve emitir WagerTransactionRejectedEvent com failureCode', () => {
        const rejected = new WagerTransactionRejectedEvent({
            aggregateId: 'tx-2',
            correlationId: 'corr-2',
            data: {
                transactionId: 'tx-2',
                providerId: 'pragmatic',
                externalTransactionId: 'ext-2',
                walletId: 'w-1',
                playerId: 'p-1',
                roundId: 'r-1',
                gameId: 'g-1',
                kind: 'BET',
                money: { amount: '999.00', currency: 'BRL' },
                failureCode: 'INSUFFICIENT_FUNDS',
            },
        });

        expect(rejected.toJSON().eventType).toBe('WagerTransactionRejected');
        expect(rejected.toJSON().data.failureCode).toBe('INSUFFICIENT_FUNDS');
    });

    test('deve calcular backoff exponencial progressivo no worker', () => {
        const worker = new PendingReferenceWorkerService({} as any);
        const before = Date.now();
        const retry1 = worker.calculateNextRetry(1).getTime() - before;
        const retry3 = worker.calculateNextRetry(3).getTime() - before;

        expect(retry1).toBeGreaterThanOrEqual(3900);
        expect(retry3).toBeGreaterThanOrEqual(15900);
        expect(retry3).toBeGreaterThan(retry1);
    });
});