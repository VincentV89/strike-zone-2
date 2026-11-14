declare interface KVNamespace {
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

declare interface RateLimitApi {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

declare interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
