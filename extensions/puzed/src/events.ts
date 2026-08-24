import type { Event } from "./api-types.js";
import type { PuzedClient } from "./client.js";

export type EventCursorStore = { load(profileId: string): Promise<string | undefined>; save(profileId: string, cursor: string): Promise<void> };
export type Invalidation = { kind: "entity"; event: Event } | { kind: "resync" } | { kind: "ready" };

export async function consumeEventStream(response: Response, onInvalidation: (value: Invalidation) => Promise<void> | void, onCursor?: (cursor: string) => Promise<void> | void): Promise<void> {
  if (!response.body) throw new Error("Puzed event stream has no body.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read(); buffer += value ?? "";
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary).replace(/\r/g, ""); buffer = buffer.slice(boundary + 2);
      let name = ""; let data = ""; let cursor = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
        else if (line.startsWith("id:")) cursor = line.slice(3).trim();
      }
      if (name === "ready" || name === "resync") await onInvalidation({ kind: name });
      else if (data) await onInvalidation({ kind: "entity", event: JSON.parse(data) as Event });
      if (cursor) await onCursor?.(cursor);
    }
    if (done) break;
  }
}

export class PuzedEventSubscription {
  constructor(private readonly profileId: string, private readonly client: PuzedClient, private readonly cursorStore: EventCursorStore, private readonly invalidate: (value: Invalidation) => Promise<void> | void) {}
  async run(signal: AbortSignal): Promise<void> {
    let delay = 250;
    while (!signal.aborted) {
      try {
        const response = await this.client.openEventStream(await this.cursorStore.load(this.profileId), signal);
        await consumeEventStream(response, this.invalidate, (cursor) => this.cursorStore.save(this.profileId, cursor));
        delay = 250;
      } catch (error) {
        if (signal.aborted) return;
        await new Promise<void>((resolve) => { const timer = setTimeout(resolve, delay); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); });
        delay = Math.min(delay * 2, 10_000);
      }
    }
  }
}

/** Ensures one long-lived authenticated stream owns each profile/org pair. */
export class PuzedEventStreamRegistry {
  readonly #streams = new Map<string, { controller: AbortController; promise: Promise<void>; references: number }>();
  acquire(profileId: string, organizationId: string, create: () => PuzedEventSubscription): { completion: Promise<void>; release(): void } {
    const key = `${profileId}:${organizationId}`;
    let stream = this.#streams.get(key);
    if (stream) stream.references++;
    else {
      const controller = new AbortController();
      const promise = create().run(controller.signal).finally(() => this.#streams.delete(key));
      stream = { controller, promise, references: 1 };
      this.#streams.set(key, stream);
    }
    let released = false;
    return { completion: stream.promise, release: () => {
      if (released) return; released = true;
      const current = this.#streams.get(key); if (!current) return;
      current.references--; if (current.references === 0) current.controller.abort();
    } };
  }
  stop(profileId: string, organizationId: string): void { this.#streams.get(`${profileId}:${organizationId}`)?.controller.abort(); }
  shutdown(): void { for (const stream of this.#streams.values()) stream.controller.abort(); }
  active(profileId: string, organizationId: string): boolean { return this.#streams.has(`${profileId}:${organizationId}`); }
}
