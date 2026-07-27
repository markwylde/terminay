import type {
  ClientCommandResult,
  ClientQueryResult,
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

/** Adapt the canonical TerminayClient envelope API to feature-facing result
 * values. The transport remains injectable for browser, Desktop, and tests. */
export class TerminayClientFacade implements QueryCommandTransport {
  constructor(private readonly client: Pick<TerminayClient, "query" | "command">) {}

  async query<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, options: QueryOptions = {}): Promise<T> {
    const result: ClientQueryResult<T> = await this.client.query<T>(operation, payload, options);
    return (result.result ?? null) as T;
  }

  async command<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, options: CommandOptions = {}): Promise<T> {
    const result: ClientCommandResult<T> = await this.client.command<T>(operation, payload, options);
    return (result.result ?? null) as T;
  }
}
