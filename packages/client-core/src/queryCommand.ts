import type {
  ClientCommandResult,
  ClientEvent,
  ClientQueryResult,
  ClientSubscription,
  CommandOptions,
  QueryOptions,
} from "./types.js";
import type { TerminayClient } from "./client.js";
import type { JsonValue } from "@terminay/protocol";

/**
 * Small feature-facing transport contract. Shared UI code depends on query
 * and command operations, not on Electron preload methods or a particular
 * socket/WebRTC implementation.
 */
export interface QueryCommandTransport {
  query<T extends JsonValue = JsonValue>(operation: string, payload?: JsonValue, options?: QueryOptions): Promise<T>;
  command<T extends JsonValue = JsonValue>(operation: string, payload?: JsonValue, options?: CommandOptions): Promise<T>;
}

/** Optional binary extension used by bounded server upload contracts. */
export interface BinaryCommandTransport extends QueryCommandTransport {
  commandWithBody<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue | undefined, body: Uint8Array, options?: CommandOptions): Promise<T>;
}

export interface BinaryQueryTransport extends QueryCommandTransport {
  queryWithBody<T extends JsonValue = JsonValue>(operation: string, payload?: JsonValue, options?: QueryOptions): Promise<{ readonly result: T; readonly body: Uint8Array }>;
}

/** A feature operation failure with the operation retained for actionable UI. */
export class ClientOperationError extends Error {
	readonly operation: string;
	readonly kind: 'query' | 'command';
	override readonly cause: unknown;

	constructor(kind: 'query' | 'command', operation: string, cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = 'ClientOperationError';
		this.kind = kind;
		this.operation = operation;
		this.cause = cause;
	}
}

/** Adapt the canonical TerminayClient envelope API to feature-facing result
 * values. The transport remains injectable for browser, Desktop, and tests. */
export class TerminayClientFacade implements QueryCommandTransport {
  constructor(private readonly client: Pick<TerminayClient, "query" | "command"> & Partial<Pick<TerminayClient, "subscribe" | "queryWithBody">>) {}

  async query<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, options: QueryOptions = {}): Promise<T> {
		try {
			const result: ClientQueryResult<T> = await this.client.query<T>(operation, payload, options);
			return (result.result ?? null) as T;
		} catch (error) {
			throw new ClientOperationError('query', operation, error);
		}
  }

  async command<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, options: CommandOptions = {}): Promise<T> {
		try {
			const result: ClientCommandResult<T> = await this.client.command<T>(operation, payload, options);
			return (result.result ?? null) as T;
		} catch (error) {
			throw new ClientOperationError('command', operation, error);
		}
  }

  /** Bridge the client's asynchronous subscription primitive to the small
   * synchronous listener contract used by feature facades. */
  subscribe(event: string, listener: (payload: JsonValue) => void, onResync?: () => void): () => void {
    const subscribe = this.client.subscribe;
    // Query/command-only compatibility transports cannot keep a server-owned
    // projection current.  Returning a no-op here let feature facades retain
    // stale state while appearing subscribed, which recreated a second
    // renderer authority during migration.  Callers that need events must use
    // the canonical subscribed client or fail visibly.
    if (typeof subscribe !== "function") {
      throw new Error("canonical event subscriptions are unavailable on this transport");
    }
    let active = true;
    let subscription: ClientSubscription<JsonValue> | undefined;
    const pending = subscribe.call(this.client, event) as Promise<ClientSubscription<JsonValue>>;
    void pending.then((next) => {
      if (!active) {
        void next.unsubscribe().catch(() => undefined);
        return;
      }
      subscription = next;
      next.onEvent((value) => listener(value.payload));
      if (onResync !== undefined) next.onResync(onResync);
    }).catch(() => undefined);
    return () => {
      active = false;
      void subscription?.unsubscribe().catch(() => undefined);
    };
  }

  /** Establish a canonical subscription before returning its disposer. Feature
   * projection clients use this form when setup must fail visibly and replay
   * gaps require a feature-owned resnapshot. */
  async subscribeEvents(
    event: string,
    listener: (payload: JsonValue) => void,
    onResync?: () => void,
  ): Promise<() => void> {
    const subscribe = this.client.subscribe;
    if (typeof subscribe !== "function") {
      throw new Error("canonical event subscriptions are unavailable on this transport");
    }
    const subscription = await subscribe.call(this.client, event) as ClientSubscription<JsonValue>;
    const removeListener = subscription.onEvent((value) => listener(value.payload));
    const removeResync = onResync === undefined ? () => undefined : subscription.onResync(onResync);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      removeListener();
      removeResync();
      void subscription.unsubscribe().catch(() => undefined);
    };
  }

  /** Variant for projection clients whose transport contract consumes the
   * canonical event envelope (revision/cursor plus payload). */
  async subscribeClientEvents<T extends JsonValue = JsonValue>(
    event: string,
    listener: (message: ClientEvent<T>) => void,
    onResync?: () => void,
  ): Promise<() => void> {
    const subscribe = this.client.subscribe;
    if (typeof subscribe !== "function") {
      throw new Error("canonical event subscriptions are unavailable on this transport");
    }
    const subscription = await subscribe.call(this.client, event) as ClientSubscription<T>;
    const removeListener = subscription.onEvent(listener);
    const removeResync = onResync === undefined ? () => undefined : subscription.onResync(onResync);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      removeListener();
      removeResync();
      void subscription.unsubscribe().catch(() => undefined);
    };
  }

  async commandWithBody<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, body: Uint8Array = new Uint8Array(), options: CommandOptions = {}): Promise<T> {
		const binaryClient = this.client as unknown as Pick<TerminayClient, "commandWithBody">;
		if (typeof binaryClient.commandWithBody !== "function") throw new ClientBinaryUploadUnavailableError();
		const result = await binaryClient.commandWithBody<T>(operation, payload, Uint8Array.from(body), options);
    return (result.result ?? null) as T;
  }

  async queryWithBody<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, options: QueryOptions = {}): Promise<{ readonly result: T; readonly body: Uint8Array }> {
    const binaryClient = this.client.queryWithBody;
    if (typeof binaryClient !== "function") throw new ClientBinaryQueryUnavailableError();
    const response = await binaryClient.call(this.client, operation, payload, options);
    return { result: (response.envelope.result ?? null) as T, body: response.body };
  }
}

export class ClientBinaryUploadUnavailableError extends Error {
  constructor() {
    super("the connected client transport does not support binary command bodies");
    this.name = "ClientBinaryUploadUnavailableError";
  }
}

export class ClientBinaryQueryUnavailableError extends Error {
  constructor() {
    super("the connected client transport does not support binary query result bodies");
    this.name = "ClientBinaryQueryUnavailableError";
  }
}
