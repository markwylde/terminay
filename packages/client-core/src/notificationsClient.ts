import type { ClientEvent } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";
import {
  NotificationSnapshotStore,
  type NotificationApplyResult,
  type NotificationEvent,
  type NotificationRecord,
  type NotificationReplay,
  type NotificationSnapshot,
} from "./notifications.js";

export const NOTIFICATION_OPERATIONS = Object.freeze({
  snapshot: "notifications.snapshot",
  delta: "notifications.delta",
  dismiss: "notifications.dismiss",
  event: "notifications",
  probe: "notifications.probe",
} as const);

/** The terminal a process has just sent a notification to. */
export interface NotificationProbe {
  readonly projectId: string;
  readonly sessionId: string;
}

export interface NotificationClientTransport extends QueryCommandTransport {
  /** Notifications are a live server-owned projection, as activity is. */
  subscribe: (event: string, listener: (event: ClientEvent<unknown>) => void, onResync?: () => void) => (() => void) | Promise<(() => void)>;
}

/** A thin client boundary around the server's published notifications. */
export class NotificationClient {
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly transport: NotificationClientTransport,
    readonly store = new NotificationSnapshotStore(),
  ) {
    if (typeof transport.subscribe !== "function") {
      throw new Error("notification subscriptions are required on this transport");
    }
  }

  async refresh(): Promise<NotificationApplyResult> {
    const snapshot = await this.transport.query(NOTIFICATION_OPERATIONS.snapshot) as unknown as NotificationSnapshot;
    return this.store.applySnapshot(snapshot);
  }

  /** Replace the projection from an authoritative reconnect snapshot, which
   * may carry a lower revision after the server itself restarted. */
  async reload(): Promise<NotificationApplyResult> {
    const snapshot = await this.transport.query(NOTIFICATION_OPERATIONS.snapshot) as unknown as NotificationSnapshot;
    return this.store.reset(snapshot);
  }

  async replay(): Promise<NotificationApplyResult> {
    const replay = await this.transport.query(NOTIFICATION_OPERATIONS.delta, {
      revision: this.store.revision,
      cursor: this.store.cursor,
    }) as unknown as NotificationReplay;
    return this.store.applyReplay(replay);
  }

  /** Dismiss one notification. Its owner is named exactly; the server refuses
   * an id that belongs to another terminal. */
  async dismiss(notification: Pick<NotificationRecord, "id" | "projectId" | "sessionId">): Promise<void> {
    await this.transport.command(NOTIFICATION_OPERATIONS.dismiss, {
      id: notification.id,
      projectId: notification.projectId,
      sessionId: notification.sessionId,
    });
  }

  /**
   * Hear when a process sends a notification to a terminal. A client whose
   * user is already interacting with that terminal acknowledges it, so the
   * notification is removed before it is ever published.
   */
  async onProbe(listener: (probe: NotificationProbe) => void): Promise<() => void> {
    return this.transport.subscribe(NOTIFICATION_OPERATIONS.probe, (event) => {
      const probe = event.payload as NotificationProbe | undefined;
      if (typeof probe?.projectId === "string" && typeof probe.sessionId === "string") listener(probe);
    });
  }

  async subscribe(): Promise<() => void> {
    if (this.unsubscribe !== undefined) return this.unsubscribe;
    const reload = () => void this.reload().catch(() => undefined);
    const unsubscribe = await this.transport.subscribe(NOTIFICATION_OPERATIONS.event, (event) => {
      // A stream gap is a reconnect boundary: replace from the server's
      // snapshot rather than inferring what was missed.
      if (this.store.applyEvent(event.payload as NotificationEvent).kind === "resync_required") reload();
    }, reload);
    this.unsubscribe = () => {
      try { unsubscribe(); } catch { /* expected disconnect cleanup is local */ }
      this.unsubscribe = undefined;
    };
    // Subscribe before the snapshot so no publication falls between them.
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
