import type { ClientEvent } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";
import { ActivitySnapshotStore, type ActivityApplyResult, type ActivityEvent, type ActivityReplay, type ActivitySnapshot } from "./activity.js";

export const ACTIVITY_OPERATIONS = Object.freeze({
  snapshot: "activity.snapshot",
  delta: "activity.delta",
  acknowledge: "activity.acknowledge",
  event: "activity",
} as const);

export interface ActivityClientTransport extends QueryCommandTransport {
  /**
   * Activity is a live server-owned projection. A query/command-only bridge
   * cannot keep it current, so it is not a valid ActivityClient transport.
   */
  subscribe: (event: string, listener: (event: ClientEvent<ActivityEvent>) => void) => (() => void) | Promise<(() => void)>;
}

/** A thin client boundary around the canonical server activity projection. */
export class ActivityClient {
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly transport: ActivityClientTransport,
    readonly store = new ActivitySnapshotStore(),
  ) {
    // TypeScript consumers get the required transport contract above. Keep
    // the same boundary for JavaScript and compatibility callers so a stale
    // activity snapshot cannot look authoritative after migration.
    if (typeof transport.subscribe !== "function") {
      throw new Error("activity subscriptions are required on this transport");
    }
  }

  async refresh(): Promise<ActivityApplyResult> {
    const snapshot = await this.transport.query(ACTIVITY_OPERATIONS.snapshot) as unknown as ActivitySnapshot;
    return this.store.applySnapshot(snapshot);
  }

  /**
   * Replace the local projection from an authoritative reconnect snapshot.
   * Unlike refresh(), this accepts a lower revision after the server itself
   * restarted. No client-side activity or provider transition is inferred.
   */
  async reload(): Promise<ActivityApplyResult> {
    const snapshot = await this.transport.query(ACTIVITY_OPERATIONS.snapshot) as unknown as ActivitySnapshot;
    return this.store.reset(snapshot);
  }

  /**
   * Consume the server's bounded activity journal. A resync response is an
   * authoritative replacement, not a normal monotonic refresh: the server
   * may have restarted and legitimately reset its revision/cursor.
   */
  async replay(): Promise<ActivityApplyResult> {
    const replay = await this.transport.query(ACTIVITY_OPERATIONS.delta, {
      revision: this.store.revision,
      cursor: this.store.cursor,
    }) as unknown as ActivityReplay;
    if (replay?.kind === "resync") {
      if (replay.snapshot === undefined) throw new TypeError("activity resync is missing a snapshot");
      return this.store.reset(replay.snapshot);
    }
    return this.store.applyReplay(replay);
  }

  async acknowledge(identity: { readonly projectId: string; readonly sessionId: string }): Promise<void> {
    const snapshot = this.store.snapshot.sessions[identity.sessionId];
    await this.transport.command(ACTIVITY_OPERATIONS.acknowledge, {
      ...identity,
      ...(snapshot === undefined ? {} : { expectedUpdatedAt: snapshot.updatedAt }),
    });
  }

  async subscribe(): Promise<() => void> {
    if (this.unsubscribe !== undefined) return this.unsubscribe;
    const unsubscribe = await this.transport.subscribe(ACTIVITY_OPERATIONS.event, (event) => {
      const result = this.store.applyEvent(event.payload);
      // A stream gap is a reconnect boundary. Replace from the canonical
      // server snapshot so a restarted server's lower revision is retained;
      // do not infer an activity transition from the gap locally.
      if (result.kind === "resync_required") void this.reload().catch(() => undefined);
    });
    this.unsubscribe = () => {
      try { unsubscribe(); } catch { /* expected disconnect cleanup is local */ }
      this.unsubscribe = undefined;
    };
    // Subscribe before the authoritative snapshot so a journal replay gap
    // cannot lose a transition between a pre-subscription refresh and the
    // live listener becoming active.
    try {
      await this.refresh();
    } catch (error) {
      this.unsubscribe?.();
      throw error;
    }
    return this.unsubscribe;
  }

  close(): void { this.unsubscribe?.(); }
}
