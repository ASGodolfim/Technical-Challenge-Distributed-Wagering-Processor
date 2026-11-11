import { StructuredLogger } from '../../src/infrastructure/observability/structured-logger.service';
import { runWithLogContext, setLogContext } from '../../src/infrastructure/observability/request-context';
import { AuthGuard } from '../../src/infrastructure/http/guards/auth.guard';
import { Reflector } from '@nestjs/core';

describe('Observabilidade JSON & AuthGuard No-Op', () => {
    test('StructuredLogger deve emitir JSON com correlationId, walletId, transactionId, providerId e ocultar valores financeiros', () => {
        const logger = new StructuredLogger();
        const captured: string[] = [];
        const originalWrite = process.stdout.write.bind(process.stdout);

        (process.stdout as any).write = (chunk: string) => {
            captured.push(chunk);
            return true;
        };

        try {
            runWithLogContext({ correlationId: 'corr-phase5' }, () => {
                setLogContext({
                    walletId: 'wallet-abc',
                    transactionId: 'tx-xyz',
                    providerId: 'pragmatic',
                });

                logger.log({
                    message: 'Operação auditada',
                    amount: '999.99',
                    balanceAfter: '1500.00',
                    money: { amount: '999.99', currency: 'BRL' },
                    safeField: 'allowed',
                });
            });
        } finally {
            (process.stdout as any).write = originalWrite;
        }

        expect(captured.length).toBe(1);
        const parsed = JSON.parse(captured[0]);

        expect(parsed.correlationId).toBe('corr-phase5');
        expect(parsed.walletId).toBe('wallet-abc');
        expect(parsed.transactionId).toBe('tx-xyz');
        expect(parsed.providerId).toBe('pragmatic');
        expect(parsed.safeField).toBe('allowed');

        expect(parsed.amount).toBeUndefined();
        expect(parsed.balanceAfter).toBeUndefined();
        expect(parsed.money).toBeUndefined();
    });

    test('AuthGuard no-op deve permitir acesso às rotas protegidas e públicas', () => {
        const reflector = new Reflector();
        const guard = new AuthGuard(reflector);

        const mockContext = {
            getHandler: () => () => { },
            getClass: () => class TestController { },
        } as any;

        expect(guard.canActivate(mockContext)).toBe(true);
    });
});