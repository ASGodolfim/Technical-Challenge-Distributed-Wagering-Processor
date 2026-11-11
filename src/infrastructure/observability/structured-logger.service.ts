import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { getLogContext } from './request-context';

const SENSITIVE_FINANCIAL_KEYS = new Set([
    'amount',
    'balance',
    'balanceAmount',
    'balanceBefore',
    'balanceAfter',
    'money',
    'moneyAmount',
    'initialBalance',
    'storedBalance',
    'calculatedLedgerBalance',
    'cents',
]);

function sanitizeMetadata(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return {};
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (SENSITIVE_FINANCIAL_KEYS.has(key)) {
            continue; // Nunca expõe valores financeiros nos logs
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            sanitized[key] = sanitizeMetadata(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

@Injectable()
export class StructuredLogger implements LoggerService {
    log(message: unknown, ...optionalParams: unknown[]) {
        this.write('info', message, optionalParams);
    }

    error(message: unknown, ...optionalParams: unknown[]) {
        this.write('error', message, optionalParams);
    }

    warn(message: unknown, ...optionalParams: unknown[]) {
        this.write('warn', message, optionalParams);
    }

    debug(message: unknown, ...optionalParams: unknown[]) {
        this.write('debug', message, optionalParams);
    }

    verbose(message: unknown, ...optionalParams: unknown[]) {
        this.write('verbose', message, optionalParams);
    }

    setLogLevels?(_levels: LogLevel[]) { }

    private write(level: string, message: unknown, optionalParams: unknown[]) {
        const contextStore = getLogContext();
        let serviceContext = 'Application';
        let extraMeta: Record<string, unknown> = {};
        let stack: string | undefined;

        for (const param of optionalParams) {
            if (typeof param === 'string') {
                if (level === 'error' && param.includes('\n')) {
                    stack = param;
                } else {
                    serviceContext = param;
                }
            } else if (param && typeof param === 'object') {
                extraMeta = { ...extraMeta, ...sanitizeMetadata(param) };
            }
        }

        let msgText = '';
        let objectMessageMeta: Record<string, unknown> = {};

        if (typeof message === 'string') {
            msgText = message;
        } else if (message instanceof Error) {
            msgText = message.message;
        } else if (message && typeof message === 'object') {
            const sanitizedObj = sanitizeMetadata(message);
            if (typeof sanitizedObj.message === 'string') {
                msgText = sanitizedObj.message;
                delete sanitizedObj.message;
            } else {
                msgText = JSON.stringify(sanitizedObj);
            }
            objectMessageMeta = sanitizedObj;
        } else {
            msgText = String(message);
        }

        const mergedMeta = { ...objectMessageMeta, ...extraMeta };

        const logEntry: Record<string, unknown> = {
            timestamp: new Date().toISOString(),
            level,
            context: serviceContext,
            message: msgText,
            correlationId: (mergedMeta.correlationId as string) ?? contextStore.correlationId ?? null,
            walletId: (mergedMeta.walletId as string) ?? contextStore.walletId ?? null,
            transactionId: (mergedMeta.transactionId as string) ?? contextStore.transactionId ?? null,
            providerId: (mergedMeta.providerId as string) ?? contextStore.providerId ?? null,
            ...mergedMeta,
        };

        if (stack) {
            logEntry.stack = stack;
        }

        const serialized = JSON.stringify(logEntry);
        if (level === 'error') {
            process.stderr.write(`${serialized}\n`);
        } else {
            process.stdout.write(`${serialized}\n`);
        }
    }
}