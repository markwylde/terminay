import { randomInt } from "node:crypto";
import { connectSsh } from "./transport.js";
import { normalizeError, SshProviderError } from "./errors.js";
import type { ProfileStore } from "./store.js";
import type { AuthenticationBroker, HostTrustVerifier, SshClient } from "./transport.js";

type SshProfile = ReturnType<ProfileStore["get"]>;
type PoolStatus = {
  status: string;
  attempt: number;
  channels: number;
};
type PublishedStatus = PoolStatus & { profileId: string; revision: number };
type TrackedTerminal = { interruptOnce?: () => void };
type ConnectFunction = (
  profile: SshProfile,
  trust: HostTrustVerifier,
  broker: AuthenticationBroker,
  signal?: AbortSignal,
) => Promise<SshClient>;
type PoolEntry = {
  id: string;
  profile: SshProfile;
  status: string;
  attempt: number;
  channels: number;
  terminals: Set<TrackedTerminal>;
  client?: SshClient;
  connecting?: Promise<void>;
  closed: boolean;
};
type PoolOptions = {
  store: Pick<ProfileStore, "get" | "setStatus">;
  trust: HostTrustVerifier;
  broker?: AuthenticationBroker;
  maxChannels?: number;
  connect?: ConnectFunction;
};
type AcquireOptions = { signal?: AbortSignal; wait?: boolean; broker?: AuthenticationBroker };
export type ConnectionLease = {
  client: SshClient;
  profile: SshProfile;
  trackTerminal(terminal: TrackedTerminal): Set<TrackedTerminal>;
  release(): void;
};

export class ConnectionPool {
  #store: Pick<ProfileStore, "get" | "setStatus">;
  #trust: HostTrustVerifier;
  #broker?: AuthenticationBroker;
  #entries = new Map<string, PoolEntry>();
  #listeners = new Set<(status: PublishedStatus) => void>();
  #maxChannels: number;
  #connect: ConnectFunction;

  constructor({ store, trust, broker, maxChannels = 32, connect = connectSsh as ConnectFunction }: PoolOptions) {
    this.#store = store;
    this.#trust = trust;
    this.#broker = broker;
    this.#maxChannels = maxChannels;
    this.#connect = connect;
  }

  subscribe(listener: (status: PublishedStatus) => void): () => boolean {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  status(profileId: string, revision: number): PoolStatus {
    const entry = this.#entries.get(key(profileId, revision));
    return entry ? { status: entry.status, attempt: entry.attempt, channels: entry.channels } : { status: "disconnected", attempt: 0, channels: 0 };
  }

  async acquire(profileId: string, revision: number, { signal, wait = true, broker }: AcquireOptions = {}): Promise<ConnectionLease> {
    const profile = this.#store.get(profileId, revision);
    const id = key(profileId, revision);
    let entry = this.#entries.get(id);
    if (!entry) {
      entry = { id, profile, status: "disconnected", attempt: 0, channels: 0, terminals: new Set<TrackedTerminal>(), client: undefined, connecting: undefined, closed: false };
      this.#entries.set(id, entry);
    }
    if (!entry.client && wait) await this.#connectEntry(entry, signal, broker ?? this.#broker);
    if (!entry.client) throw new SshProviderError("unreachable", "SSH transport is not ready");
    if (entry.channels >= this.#maxChannels) throw new SshProviderError("conflict", "SSH profile channel limit reached");
    entry.channels++;
    let released = false;
    return {
      client: entry.client,
      profile: structuredClone(entry.profile),
      trackTerminal: (terminal: TrackedTerminal) => entry.terminals.add(terminal),
      release: () => {
        if (released) return;
        released = true;
        entry.channels = Math.max(0, entry.channels - 1);
      },
    };
  }

  async retry(profileId: string, revision: number, signal?: AbortSignal): Promise<PoolStatus> {
    const entry = this.#entries.get(key(profileId, revision));
    if (entry?.client) return this.status(profileId, revision);
    if (entry) entry.attempt = 0;
    await this.acquire(profileId, revision, { signal }).then((lease) => lease.release());
    return this.status(profileId, revision);
  }

  /**
   * Discard an idle transport before retrying a session channel. Some managed
   * SSH endpoints reject a second session on an otherwise authenticated
   * connection after a transient SFTP channel. This never disrupts a live
   * terminal: callers must only use it before a terminal is registered.
   */
  async refresh(profileId: string, revision: number, signal?: AbortSignal): Promise<void> {
    const entry = this.#entries.get(key(profileId, revision));
    if (!entry?.client) return;
    if (entry.terminals.size > 0) throw new SshProviderError("conflict", "SSH transport has active terminals");
    const stale = entry.client;
    entry.client = undefined;
    entry.status = "disconnected";
    entry.attempt = 0;
    this.#emit(entry);
    // Do not wait for this old socket to close: a server that has exhausted
    // its per-connection session allowance may never accept another channel
    // until its transport is retired. The close listener is identity-guarded.
    stale.end();
    const lease = await this.acquire(profileId, revision, { signal });
    lease.release();
  }

  async close(): Promise<void> {
    for (const entry of this.#entries.values()) {
      entry.closed = true;
      entry.client?.end();
      interrupt(entry);
    }
    this.#entries.clear();
  }

  async #connectEntry(entry: PoolEntry, signal?: AbortSignal, broker?: AuthenticationBroker): Promise<void> {
    if (entry.connecting) return entry.connecting;
    entry.connecting = (async () => {
      entry.status = entry.attempt ? "reconnecting" : "connecting";
      this.#emit(entry);
      try {
        if (entry.attempt) await cancellableDelay(this.reconnectDelay(entry.attempt), signal);
        if (!broker) throw new SshProviderError("authentication-failed", "SSH authentication broker is unavailable");
        const client = await this.#connect(entry.profile, this.#trust, broker, signal);
        entry.client = client;
        entry.status = "ready";
        entry.attempt = 0;
        client.once("close", () => {
          if (entry.client !== client) return;
          entry.client = undefined;
          if (!entry.closed) {
            entry.status = "reconnecting";
            entry.attempt++;
            interrupt(entry);
            this.#emit(entry);
          }
        });
        client.once("error", () => {});
        await this.#store.setStatus(entry.profile.id, "ready", true);
        this.#emit(entry);
      } catch (error: unknown) {
        const normalized = normalizeError(error);
        entry.status = normalized.code;
        entry.attempt++;
        await this.#store.setStatus(entry.profile.id, normalized.code);
        this.#emit(entry);
        throw normalized;
      } finally {
        entry.connecting = undefined;
      }
    })();
    return entry.connecting;
  }

  reconnectDelay(attempt: number): number {
    return Math.min(30_000, 250 * (2 ** Math.min(attempt, 7))) + randomInt(0, 250);
  }

  #emit(entry: PoolEntry): void {
    const publicStatus: PublishedStatus = { profileId: entry.profile.id, revision: entry.profile.revision, status: entry.status, attempt: entry.attempt, channels: entry.channels };
    for (const listener of this.#listeners) listener(publicStatus);
  }
}

function key(id: string, revision: number): string { return `${id}@${revision}`; }

function interrupt(entry: PoolEntry): void {
  for (const terminal of entry.terminals) terminal.interruptOnce?.();
  entry.terminals.clear();
}

function cancellableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new SshProviderError("cancelled", "SSH reconnection was cancelled"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new SshProviderError("cancelled", "SSH reconnection was cancelled"));
    };
    function done(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
