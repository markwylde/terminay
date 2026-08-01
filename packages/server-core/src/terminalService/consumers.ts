import { TerminalService, type TerminalSubscription } from "./service.js";
import type { TerminalIdentity, TerminalSubscriptionOptions } from "./types.js";

const CONSUMER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

interface ConsumerSubscription {
  readonly consumerId: string;
  readonly identity: TerminalIdentity;
  readonly subscription: TerminalSubscription;
}

/**
 * Keeps terminal subscriptions separate from PTY/session ownership.
 *
 * A consumer token identifies one client-side subscription only. Detaching it
 * closes the stream and never calls TerminalService.kill, so a renderer reload,
 * native-window close, or transport replacement cannot terminate the server
 * session. Hosts may keep a compatibility alias for an old renderer id while
 * new callers use an opaque client token directly.
 */
export class DetachableTerminalConsumerRegistry {
  private readonly subscriptions = new Map<string, ConsumerSubscription>();

  constructor(private readonly service: TerminalService) {
    if (!(service instanceof TerminalService)) throw new TypeError("terminal service is required");
  }

  attach(identity: TerminalIdentity, consumerId: string, options: TerminalSubscriptionOptions = {}): TerminalSubscription {
    assertConsumerId(consumerId);
    this.detach(identity, consumerId);
    const subscription = this.service.subscribe(identity, options);
    this.subscriptions.set(key(identity, consumerId), { consumerId, identity, subscription });
    return subscription;
  }

  detach(identity: TerminalIdentity, consumerId: string, expectedSubscription?: TerminalSubscription): boolean {
    assertConsumerId(consumerId);
    const subscription = this.subscriptions.get(key(identity, consumerId));
    if (subscription === undefined) return false;
    if (expectedSubscription !== undefined && subscription.subscription !== expectedSubscription) return false;
    subscription.subscription.close("client");
    this.subscriptions.delete(key(identity, consumerId));
    return true;
  }

  detachConsumer(consumerId: string): number {
    assertConsumerId(consumerId);
    let detached = 0;
    for (const subscription of [...this.subscriptions.values()]) {
      if (subscription.consumerId !== consumerId) continue;
      subscription.subscription.close("client");
      this.subscriptions.delete(key(subscription.identity, consumerId));
      detached += 1;
    }
    return detached;
  }

  isAttached(identity: TerminalIdentity, consumerId: string): boolean {
    assertConsumerId(consumerId);
    const subscription = this.subscriptions.get(key(identity, consumerId));
    if (subscription === undefined) return false;
    if (subscription.subscription.closed) {
      this.subscriptions.delete(key(identity, consumerId));
      return false;
    }
    return true;
  }

  clear(): void {
    for (const subscription of this.subscriptions.values()) subscription.subscription.close("client");
    this.subscriptions.clear();
  }
}

function key(identity: TerminalIdentity, consumerId: string): string {
  return `${identity.serverId}\u0000${identity.projectId}\u0000${identity.sessionId}\u0000${consumerId}`;
}

function assertConsumerId(value: string): asserts value is string {
  if (typeof value !== "string" || !CONSUMER_ID_PATTERN.test(value)) throw new TypeError("terminal consumer id is invalid");
}
