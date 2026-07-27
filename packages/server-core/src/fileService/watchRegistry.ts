import type { FileMetadata } from "./types.js";

/** File changes are intentionally small protocol facts. File contents are
 * fetched through a separately bounded file session read, never embedded in a
 * watch event. */
export type FileWatchEventKind = "created" | "changed" | "deleted" | "renamed" | "unavailable" | "resync";

export interface FileWatchKey {
  readonly serverId: string;
  readonly projectId: string;
  readonly resource: string;
}

export interface FileWatchEventInput {
  readonly projectId: string;
  readonly resource: string;
  readonly kind: Exclude<FileWatchEventKind, "resync">;
  readonly relatedResource?: string;
  readonly revision?: number;
  readonly metadata?: FileMetadata;
}

export interface FileWatchEvent extends FileWatchKey {
  readonly sequence: number;
  readonly kind: FileWatchEventKind;
  readonly relatedResource?: string;
  readonly revision?: number;
  readonly metadata?: FileMetadata;
}

export interface FileWatchSubscriptionOptions {
  readonly clientId: string;
  readonly projectId: string;
  readonly resource: string;
  readonly signal?: AbortSignal;
  /** Start after this sequence. New subscriptions default to the current
   * cursor, so they do not receive unrelated history. */
  readonly afterSequence?: number;
}

export interface FileWatchSubscription {
  readonly subscriptionId: string;
  readonly key: FileWatchKey;
  readonly clientId: string;
}

export interface FileWatchBatch {
  readonly subscriptionId: string;
  readonly cursor: number;
  readonly events: readonly FileWatchEvent[];
  /** A consumer must fetch a fresh bounded snapshot before trusting later
   * events when this is true. */
  readonly resyncRequired: boolean;
}

export interface FileWatchRegistryOptions {
  readonly serverId: string;
  readonly maxSubscriptions?: number;
  readonly maxQueueEvents?: number;
  readonly maxBatchEvents?: number;
  readonly maxResourceLength?: number;
}

export interface FileWatchPublishResult {
  readonly accepted: boolean;
  readonly deduplicated: boolean;
  readonly sequence?: number;
  readonly subscribers: number;
}

interface SubscriptionState {
  readonly subscription: FileWatchSubscription;
  readonly key: FileWatchKey;
  cursor: number;
  queue: FileWatchEvent[];
  resyncRequired: boolean;
  removeAbortListener?: () => void;
}

const DEFAULT_MAX_SUBSCRIPTIONS = 1024;
const DEFAULT_MAX_QUEUE_EVENTS = 256;
const DEFAULT_MAX_BATCH_EVENTS = 64;
const DEFAULT_MAX_RESOURCE_LENGTH = 4096;
const EVENT_KINDS: readonly FileWatchEventKind[] = ["created", "changed", "deleted", "renamed", "unavailable"];
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * Server-owned watch fanout. The registry is deliberately independent of a
 * host watcher (Node fs.watch, FSEvents, inotify, or a remote adapter). The
 * host supplies canonical, project-scoped facts through publish(); clients
 * only see bounded, ordered facts keyed by server/project/resource/client.
 */
export class FileWatchRegistry {
  private readonly serverId: string;
  private readonly maxSubscriptions: number;
  private readonly maxQueueEvents: number;
  private readonly maxBatchEvents: number;
  private readonly maxResourceLength: number;
  private readonly subscriptions = new Map<string, SubscriptionState>();
  private readonly subscriptionsByKey = new Map<string, string>();
  private readonly eventHistory: FileWatchEvent[] = [];
  private readonly recentFingerprints = new Set<string>();
  private readonly recentFingerprintOrder: string[] = [];
  private sequenceValue = 0;
  private subscriptionSequence = 0;

  constructor(options: FileWatchRegistryOptions) {
    this.serverId = validIdentity(options.serverId, "serverId");
    this.maxSubscriptions = positive(options.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS, "maxSubscriptions");
    this.maxQueueEvents = positive(options.maxQueueEvents ?? DEFAULT_MAX_QUEUE_EVENTS, "maxQueueEvents");
    this.maxBatchEvents = positive(options.maxBatchEvents ?? DEFAULT_MAX_BATCH_EVENTS, "maxBatchEvents");
    this.maxResourceLength = positive(options.maxResourceLength ?? DEFAULT_MAX_RESOURCE_LENGTH, "maxResourceLength");
    if (this.maxBatchEvents > this.maxQueueEvents) throw new RangeError("maxBatchEvents cannot exceed maxQueueEvents");
  }

  get sequence(): number { return this.sequenceValue; }
  get size(): number { return this.subscriptions.size; }

  subscribe(options: FileWatchSubscriptionOptions): FileWatchSubscription {
    const clientId = validIdentity(options.clientId, "clientId");
    const projectId = validIdentity(options.projectId, "projectId");
    const resource = validResource(options.resource, this.maxResourceLength);
    const afterSequence = options.afterSequence ?? this.sequenceValue;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || afterSequence > this.sequenceValue) throw new RangeError("afterSequence is invalid");
    throwIfAborted(options.signal);

    const key = subscriptionKey(this.serverId, projectId, resource, clientId);
    const existingId = this.subscriptionsByKey.get(key);
    if (existingId !== undefined) {
      const existing = this.subscriptions.get(existingId);
      if (existing !== undefined) return existing.subscription;
      this.subscriptionsByKey.delete(key);
    }
    if (this.subscriptions.size >= this.maxSubscriptions) throw new Error("file watch subscription limit reached");

    if (this.subscriptionSequence >= Number.MAX_SAFE_INTEGER) throw new Error("file watch subscription sequence exhausted");
    const subscriptionId = `watch-${(++this.subscriptionSequence).toString(36)}`;
    const subscription: FileWatchSubscription = Object.freeze({
      subscriptionId,
      key: Object.freeze({ serverId: this.serverId, projectId, resource }),
      clientId,
    });
    const replay = this.replay(afterSequence, subscription.key);
    const state: SubscriptionState = {
      subscription,
      key: subscription.key,
      cursor: afterSequence,
      queue: replay.events,
      resyncRequired: replay.resyncRequired,
    };
    if (options.signal !== undefined) {
      const onAbort = (): void => { this.unsubscribe(subscriptionId); };
      options.signal.addEventListener("abort", onAbort, { once: true });
      state.removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
    }
    this.subscriptions.set(subscriptionId, state);
    this.subscriptionsByKey.set(key, subscriptionId);
    return subscription;
  }

  unsubscribe(subscriptionId: string): boolean {
    const state = this.subscriptions.get(subscriptionId);
    if (state === undefined) return false;
    state.removeAbortListener?.();
    this.subscriptions.delete(subscriptionId);
    this.subscriptionsByKey.delete(subscriptionKey(state.key.serverId, state.key.projectId, state.key.resource, state.subscription.clientId));
    return true;
  }

  /** Publish one canonical host change. Duplicate facts are ignored before a
   * sequence is allocated, which keeps all clients on the same cursor. */
  publish(input: FileWatchEventInput): FileWatchPublishResult {
    const projectId = validIdentity(input.projectId, "projectId");
    const resource = validResource(input.resource, this.maxResourceLength);
    if (!EVENT_KINDS.includes(input.kind)) throw new TypeError("file watch event kind is invalid");
    const relatedResource = input.relatedResource === undefined ? undefined : validResource(input.relatedResource, this.maxResourceLength);
    const revision = input.revision;
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) throw new RangeError("file watch revision is invalid");
    const metadata = normalizeMetadata(input.metadata);
    const fingerprint = JSON.stringify([projectId, resource, input.kind, relatedResource ?? null, revision ?? null, metadata ?? null]);
    if (this.recentFingerprints.has(fingerprint)) return { accepted: false, deduplicated: true, subscribers: 0 };
    this.rememberFingerprint(fingerprint);
    if (this.sequenceValue >= Number.MAX_SAFE_INTEGER) throw new Error("file watch sequence exhausted");
    this.sequenceValue += 1;
    const event: FileWatchEvent = Object.freeze({
      serverId: this.serverId,
      projectId,
      resource,
      sequence: this.sequenceValue,
      kind: input.kind,
      ...(relatedResource === undefined ? {} : { relatedResource }),
      ...(revision === undefined ? {} : { revision }),
      ...(metadata === undefined ? {} : { metadata }),
    });
    this.eventHistory.push(event);
    while (this.eventHistory.length > this.maxQueueEvents * 2) this.eventHistory.shift();
    let subscribers = 0;
    for (const state of this.subscriptions.values()) {
      if (state.key.projectId !== projectId || !resourceMatches(state.key.resource, resource)) continue;
      subscribers += 1;
      this.enqueue(state, event);
    }
    return { accepted: true, deduplicated: false, sequence: event.sequence, subscribers };
  }

  async read(subscriptionId: string, options: { readonly limit?: number; readonly signal?: AbortSignal } = {}): Promise<FileWatchBatch> {
    throwIfAborted(options.signal);
    const state = this.requireSubscription(subscriptionId);
    const limit = options.limit ?? this.maxBatchEvents;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > this.maxBatchEvents) throw new RangeError("watch batch limit is invalid");
    const events = state.queue.splice(0, limit);
    if (events.length > 0) state.cursor = events[events.length - 1]?.sequence ?? state.cursor;
    const resyncRequired = state.resyncRequired;
    if (resyncRequired && events.some((event) => event.kind === "resync")) state.resyncRequired = false;
    throwIfAborted(options.signal);
    return Object.freeze({ subscriptionId, cursor: state.cursor, events: Object.freeze(events), resyncRequired });
  }

  pending(subscriptionId: string): number { return this.requireSubscription(subscriptionId).queue.length; }

  close(): void {
    for (const subscriptionId of [...this.subscriptions.keys()]) this.unsubscribe(subscriptionId);
    this.eventHistory.length = 0;
    this.recentFingerprints.clear();
    this.recentFingerprintOrder.length = 0;
  }

  private enqueue(state: SubscriptionState, event: FileWatchEvent): void {
    if (state.resyncRequired) return;
    if (state.queue.length >= this.maxQueueEvents) {
      state.queue = [resyncEvent(this.serverId, state.key, event.sequence)];
      state.resyncRequired = true;
      return;
    }
    state.queue.push(event);
  }

  private replay(afterSequence: number, key: FileWatchKey): { readonly events: FileWatchEvent[]; readonly resyncRequired: boolean } {
    if (afterSequence === this.sequenceValue || this.eventHistory.length === 0) return { events: [], resyncRequired: false };
    const oldest = this.eventHistory[0]?.sequence ?? this.sequenceValue;
    if (afterSequence < oldest - 1) return { events: [resyncEvent(this.serverId, key, this.sequenceValue)], resyncRequired: true };
    const events = this.eventHistory.filter((event) => event.sequence > afterSequence && event.projectId === key.projectId && resourceMatches(key.resource, event.resource));
    if (events.length > this.maxQueueEvents) return { events: [resyncEvent(this.serverId, key, this.sequenceValue)], resyncRequired: true };
    return { events: [...events], resyncRequired: false };
  }

  private requireSubscription(subscriptionId: string): SubscriptionState {
    const state = this.subscriptions.get(subscriptionId);
    if (state === undefined) throw new Error("file watch subscription is unknown");
    return state;
  }

  private rememberFingerprint(fingerprint: string): void {
    this.recentFingerprints.add(fingerprint);
    this.recentFingerprintOrder.push(fingerprint);
    const limit = Math.max(this.maxQueueEvents * 2, 32);
    while (this.recentFingerprintOrder.length > limit) {
      const oldest = this.recentFingerprintOrder.shift();
      if (oldest !== undefined) this.recentFingerprints.delete(oldest);
    }
  }
}

function subscriptionKey(serverId: string, projectId: string, resource: string, clientId: string): string {
  return `${serverId}\u0000${projectId}\u0000${resource}\u0000${clientId}`;
}

function resyncEvent(serverId: string, key: FileWatchKey, sequence: number): FileWatchEvent {
  return Object.freeze({ serverId, projectId: key.projectId, resource: key.resource, sequence, kind: "resync" });
}

function resourceMatches(subscriptionResource: string, changedResource: string): boolean {
  return subscriptionResource.length === 0 || subscriptionResource === changedResource || changedResource.startsWith(`${subscriptionResource}/`);
}

function validIdentity(value: string, name: string): string {
  if (typeof value !== "string" || !IDENTITY_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function validResource(value: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength || value.includes("\0") || value.startsWith("/") || value.includes("\\")) throw new TypeError("watch resource must be project-relative");
  if (value === "" || value === ".") return "";
  const parts = value.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) throw new TypeError("watch resource is not canonical");
  return value;
}

function normalizeMetadata(metadata: FileMetadata | undefined): FileMetadata | undefined {
  if (metadata === undefined) return undefined;
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) throw new RangeError("watch metadata size is invalid");
  if (metadata.mtimeMs !== undefined && (!Number.isFinite(metadata.mtimeMs) || metadata.mtimeMs < 0)) throw new RangeError("watch metadata mtime is invalid");
  if (metadata.mode !== undefined && (!Number.isSafeInteger(metadata.mode) || metadata.mode < 0)) throw new RangeError("watch metadata mode is invalid");
  if (metadata.identity !== undefined && (typeof metadata.identity !== "string" || metadata.identity.length > 256 || metadata.identity.includes("\0"))) throw new TypeError("watch metadata identity is invalid");
  return Object.freeze({ size: metadata.size, ...(metadata.mtimeMs === undefined ? {} : { mtimeMs: metadata.mtimeMs }), ...(metadata.mode === undefined ? {} : { mode: metadata.mode }), ...(metadata.identity === undefined ? {} : { identity: metadata.identity }) });
}

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}
