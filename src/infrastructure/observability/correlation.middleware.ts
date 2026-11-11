import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { runWithLogContext } from './request-context';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction) {
        const incomingHeader = req.headers['x-correlation-id'];
        const correlationId =
            typeof incomingHeader === 'string' && incomingHeader.trim().length > 0
                ? incomingHeader.trim()
                : crypto.randomUUID();

        res.setHeader('X-Correlation-Id', correlationId);

        const walletId = typeof req.params?.walletId === 'string' ? req.params.walletId : undefined;
        const providerId = typeof req.params?.providerId === 'string' ? req.params.providerId : undefined;
        const transactionId =
            typeof req.params?.transactionId === 'string' ? req.params.transactionId : undefined;

        runWithLogContext({ correlationId, walletId, providerId, transactionId }, () => {
            next();
        });
    }
}