import { WagerTransactionPendingReferenceEvent } from '../../src/domain/events/wager-pending-reference.event';
describe('Evento de Domínio: WagerTransactionPendingReferenceEvent', () => {
    test('deve criar o evento com envelope IntegrationEvent completo', () => {
        const event = new WagerTransactionPendingReferenceEvent({
            aggregateId: 'tx-789',
            correlationId: 'corr-456',
            causationId: 'cause-456',
            data: {
                transactionId: 'tx-789',
                providerId: 'pragmatic',
                externalTransactionId: 'tx-rollback-001',
                referenceExternalTransactionId: 'tx-bet-999',
                walletId: 'wallet-123',
                playerId: 'player-1',
                kind: 'ROLLBACK',
                amount: '50.00',
                currency: 'BRL',
            },
        });

        const json = event.toJSON();
        expect(json.eventType).toBe('WagerTransactionPendingReference');
        expect(json.aggregateId).toBe('tx-789');
        expect(json.correlationId).toBe('corr-456');
        expect(json.data.referenceExternalTransactionId).toBe('tx-bet-999');
    });
});