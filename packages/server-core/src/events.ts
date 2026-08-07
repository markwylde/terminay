import { assertJsonValue, type JsonValue } from "@terminay/protocol";
import type {
  EventJournalOptions,
  EventListener,
  EventReplay,
  OrderedEvent,
  ResyncSnapshot,
  OrderedEventJournalLike,
} from "./types.js";

/**
 * Small transport-independent ordered event log.
 *
 * The journal deliberately has no knowledge of subscriptions or transports.
 * It retains a bounded delta and asks the owner for a snapshot when a client
 * requests a revision older than the retained window.
 */
export class OrderedEventJournal implements OrderedEventJournalLike {
  private readonly maxEvents: number;
  private readonly events: OrderedEvent[] = [];
  private readonly listeners = new Set<EventListener>();
  private readonly snapshotProvider: (() => ResyncSnapshot | Promise<ResyncSnapshot>) | undefined;
  private nextRevision: number;
  private currentCursor: string;

  constructor(options: EventJournalOptions = {}) {
    this.maxEvents = options.maxEvents ?? 1024;
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents <= 0) throw new RangeError("maxEvents must be positive");
    this.nextRevision = options.initialRevision ?? 0;
    this.currentCursor = options.initialCursor ?? String(this.nextRevision);
    if (!Number.isSafeInteger(this.nextRevision) || this.nextRevision < 0) throw new RangeError("initialRevision must be non-negative");
    this.snapshotProvider = options.snapshot;
  }

  get revision(): number {
    return this.nextRevision;
  }

  get cursor(): string {
    return this.currentCursor;
  }

  append(event: string, payload: JsonValue): OrderedEvent {
    validateEvent(event, payload);
    if (this.nextRevision === Number.MAX_SAFE_INTEGER) throw new RangeError("event revision exhausted");
    const nextRevision = this.nextRevision + 1;
    const next: OrderedEvent = Object.freeze({ revision: nextRevision, cursor: String(nextRevision), event, payload });
    this.nextRevision = nextRevision;
    this.currentCursor = next.cursor;
    this.events.push(next);
    while (this.events.length > this.maxEvents) this.events.shift();
    this.publish(next);
    return next;
  }

  /**
   * Notify current subscribers without retaining the event or advancing the
   * durable revision. High-volume streams use this path when feature-owned
   * replay/checkpoint authorities, rather than the generic journal, own
   * recovery.
   */
  publishTransient(event: string, payload: JsonValue): OrderedEvent {
    validateEvent(event, payload);
    const transient = Object.freeze({
      revision: this.nextRevision,
      cursor: this.currentCursor,
      event,
      payload,
    });
    this.publish(transient);
    return transient;
  }

  replay(afterRevision = 0): EventReplay | Promise<EventReplay> {
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) throw new RangeError("afterRevision must be non-negative");
    const oldest = this.events[0]?.revision;
    if (oldest !== undefined && afterRevision < oldest - 1) {
      if (!this.snapshotProvider) {
        return { kind: "resync", events: [] };
      }
      return Promise.resolve(this.snapshotProvider()).then((snapshot) => {
        if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < afterRevision) throw new RangeError("snapshot revision is invalid");
        return { kind: "resync", events: [], snapshot };
      });
    }
    return { kind: "events", events: this.events.filter((event) => event.revision > afterRevision) };
  }

  replaySince(afterRevision = 0): EventReplay | Promise<EventReplay> {
    return this.replay(afterRevision);
  }

  subscribe(listener: EventListener): () => void {
    if (typeof listener !== "function") throw new TypeError("event listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.events.length = 0;
    this.listeners.clear();
  }

  private publish(event: OrderedEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* listeners are observers, not commit participants */ }
    }
  }
}

function validateEvent(event: string, payload: JsonValue): void {
  if (typeof event !== "string" || event.length === 0 || event.length > 256) throw new TypeError("event name is invalid");
  assertJsonValue(payload);
}
