import { isNamespacedId } from "@terminay/extension-api";
import type { ExtensionAgentBroker, ExtensionAgentTerminalContext } from "../extensions/types.js";
import type { ActivitySessionIdentity } from "./service.js";
import { AgentStatusService, type ExtensionLifecycleIngestResult } from "./agentService.js";

export interface ExtensionAgentBrokerOptions {
  /** Environment routing belongs to the composition layer. The lifecycle
   * adapter remains deliberately independent of Electron and SSH details. */
  readonly observe?: ExtensionAgentBroker["observe"];
  readonly maximumQueuedPublications?: number;
  readonly acknowledgementDeadlineMs?: number;
  readonly onTerminalCancelled?: (contextId: string, providerId: string) => void;
}

/**
 * Adapts the private extension-host bridge to the generic AgentStatusService.
 * It performs no provider-specific interpretation: public DTO validation,
 * binding and canonical sequence allocation stay inside the service.
 */
export function createExtensionAgentBroker(
  service: AgentStatusService,
  options: ExtensionAgentBrokerOptions = {},
): ExtensionAgentBroker {
  const publications = new Map<string, Map<string, ExtensionLifecycleIngestResult>>();
  const tails = new Map<string, Promise<void>>();
  const queued = new Map<string, number>();
  const inFlight = new Map<string, Promise<ExtensionLifecycleIngestResult>>();
  const retiredContexts = new Set<string>();
  const maximumQueued = options.maximumQueuedPublications ?? 64;
  const acknowledgementDeadlineMs = options.acknowledgementDeadlineMs ?? 5_000;
  return {
    observe: options.observe ?? (async () => { throw new Error("agent observation routing is unavailable"); }),
    async publish(request, signal) {
      if (!isNamespacedId(request.providerId, request.extensionId)) {
        return Object.freeze({ acceptedEventCount: 0, rejectedEventCount: request.events.length, failure: "extension agent provider is outside its namespace" });
      }
      const identity = identityFor(request.terminal);
      const prior = publications.get(request.terminal.contextId)?.get(request.publicationId);
      if (prior !== undefined) return prior;
      const contextId = request.terminal.contextId;
      const publicationKey = `${contextId}\0${request.publicationId}`;
      const duplicate = inFlight.get(publicationKey);
      if (duplicate !== undefined) return duplicate;
      const count = queued.get(contextId) ?? 0;
      if (count >= maximumQueued) return Object.freeze({ acceptedEventCount: 0, rejectedEventCount: request.events.length, failure: "extension lifecycle publication queue is full" });
      const execution = (async (): Promise<ExtensionLifecycleIngestResult> => {
        queued.set(contextId, count + 1);
        const priorTail = tails.get(contextId) ?? Promise.resolve();
        let release!: () => void;
        const ownTail = new Promise<void>((resolve) => { release = resolve; });
        tails.set(contextId, priorTail.then(() => ownTail));
        let result: ExtensionLifecycleIngestResult;
        try {
          await waitForTurn(priorTail, signal, acknowledgementDeadlineMs);
          if (signal.aborted) throw new Error("extension lifecycle publication cancelled");
          result = await withDeadline(service.ingestExtensionLifecycle(identity, request.providerId, request.mappingVersion, request.binding, request.events), signal, acknowledgementDeadlineMs);
        } catch (error) {
          result = Object.freeze({ acceptedEventCount: 0, rejectedEventCount: request.events.length, failure: error instanceof Error ? error.message : "extension lifecycle publication failed" });
        } finally {
          release();
          const remaining = (queued.get(contextId) ?? 1) - 1;
          if (remaining <= 0) { queued.delete(contextId); if (tails.get(contextId) !== undefined) tails.delete(contextId); }
          else queued.set(contextId, remaining);
        }
        const byContext = publications.get(request.terminal.contextId) ?? new Map<string, ExtensionLifecycleIngestResult>();
        publications.set(request.terminal.contextId, byContext);
        if (byContext.size >= 128) byContext.delete(byContext.keys().next().value!);
        byContext.set(request.publicationId, result);
        return result;
      })();
      inFlight.set(publicationKey, execution);
      try { return await execution; } finally { if (inFlight.get(publicationKey) === execution) inFlight.delete(publicationKey); }
    },
    terminalCancelled(request) {
      if (retiredContexts.has(request.terminal.contextId)) return;
      if (retiredContexts.size >= 4_096) retiredContexts.delete(retiredContexts.values().next().value!);
      retiredContexts.add(request.terminal.contextId);
      publications.delete(request.terminal.contextId);
      queued.delete(request.terminal.contextId);
      tails.delete(request.terminal.contextId);
      for (const key of inFlight.keys()) if (key.startsWith(`${request.terminal.contextId}\0`)) inFlight.delete(key);
      const identity = identityFor(request.terminal);
      try { service.releaseExtensionProvider(identity, request.providerId); } catch { /* terminal teardown is idempotent */ }
      options.onTerminalCancelled?.(request.terminal.contextId, request.providerId);
    },
  };
}

async function waitForTurn(prior: Promise<void>, signal: AbortSignal, deadlineMs: number): Promise<void> {
  await withDeadline(prior, signal, deadlineMs);
}

async function withDeadline<T>(promise: Promise<T>, signal: AbortSignal, deadlineMs: number): Promise<T> {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 300_000) throw new RangeError("extension lifecycle acknowledgement deadline is invalid");
  if (signal.aborted) throw new Error("extension lifecycle publication cancelled");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const bounded = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("extension lifecycle acknowledgement timed out")), deadlineMs);
    abort = () => reject(new Error("extension lifecycle publication cancelled"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, bounded]); }
  finally { if (timer !== undefined) clearTimeout(timer); if (abort !== undefined) signal.removeEventListener("abort", abort); }
}

function identityFor(context: ExtensionAgentTerminalContext): ActivitySessionIdentity {
  return Object.freeze({
    serverId: context.serverId,
    projectId: context.projectId,
    sessionId: context.terminalSessionId,
  });
}
