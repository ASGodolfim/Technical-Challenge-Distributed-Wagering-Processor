import { AsyncLocalStorage } from 'async_hooks';

export interface LogContext {
    correlationId?: string;
    walletId?: string;
    transactionId?: string;
    providerId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext {
    return requestContextStorage.getStore() ?? {};
}

export function setLogContext(partial: Partial<LogContext>): void {
    const store = requestContextStorage.getStore();
    if (store) {
        Object.assign(store, partial);
    }
}

export function runWithLogContext<T>(initial: LogContext, fn: () => T): T {
    return requestContextStorage.run({ ...initial }, fn);
}