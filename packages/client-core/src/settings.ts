import type { JsonValue } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";

export const SETTINGS_OPERATIONS = Object.freeze({
  get: "settings.get",
  update: "settings.update",
  reset: "settings.reset",
} as const);

export const SETTINGS_EVENTS = Object.freeze({ changed: "settings.changed" } as const);

export interface SettingsEventTransport extends QueryCommandTransport {
  /**
   * Settings are server-owned state.  A transport which cannot surface the
   * canonical change stream must not leave a renderer quietly displaying a
   * stale host-side projection as if it were authoritative.
   */
  subscribe(event: string, listener: (payload: JsonValue) => void): () => void;
}

/** Transport-neutral settings facade. Hosts may bridge the event subscription
 * while the canonical settings queries/commands move to the server protocol. */
export class SettingsClient {
  constructor(private readonly transport: SettingsEventTransport) {}

  async get<T = JsonValue>(options: QueryOptions = {}): Promise<T> {
    return (await this.transport.query<JsonValue>(SETTINGS_OPERATIONS.get, {}, options)) as unknown as T;
  }

  async update<T = JsonValue>(settings: JsonValue, options: CommandOptions = {}): Promise<T> {
    return (await this.transport.command<JsonValue>(SETTINGS_OPERATIONS.update, { settings }, options)) as unknown as T;
  }

  async reset<T = JsonValue>(options: CommandOptions = {}): Promise<T> {
    return (await this.transport.command<JsonValue>(SETTINGS_OPERATIONS.reset, {}, options)) as unknown as T;
  }

  onChanged(listener: (settings: JsonValue) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("settings listener is required");
    if (typeof this.transport.subscribe !== "function") {
      throw new Error("settings change subscription is unavailable");
    }
    return this.transport.subscribe(SETTINGS_EVENTS.changed, listener);
  }
}
