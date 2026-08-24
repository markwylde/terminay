import { isNamespacedId } from "@terminay/extension-api";
import type { ExtensionAgentBroker, ExtensionAgentTerminalContext } from "../extensions/types.js";
import type { ActivitySessionIdentity } from "./service.js";
import { AgentStatusService, type ExtensionLifecycleIngestResult } from "./agentService.js";

export interface ExtensionAgentBrokerOptions {
  /** Environment routing belongs to the composition layer. The lifecycle
   * adapter remains deliberately independent of Electron and SSH details. */
  readonly observe?: ExtensionAgentBroker["observe"];
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
  return {
    observe: options.observe ?? (async () => { throw new Error("agent observation routing is unavailable"); }),
    async publish(request, _signal) {
      if (!isNamespacedId(request.providerId, request.extensionId)) {
        return Object.freeze({ acceptedEventCount: 0, rejectedEventCount: request.events.length, failure: "extension agent provider is outside its namespace" });
      }
      const identity = identityFor(request.terminal);
      const prior = publications.get(request.terminal.contextId)?.get(request.publicationId);
      if (prior !== undefined) return prior;
      const result = await service.ingestExtensionLifecycle(
        identity,
        request.providerId,
        request.mappingVersion,
        request.binding,
        request.events,
      );
      const byContext = publications.get(request.terminal.contextId) ?? new Map<string, ExtensionLifecycleIngestResult>();
      publications.set(request.terminal.contextId, byContext);
      // A bounded acknowledgement cache makes child retries idempotent without
      // becoming an unbounded extension-controlled memory allocation.
      if (byContext.size >= 128) byContext.delete(byContext.keys().next().value!);
      byContext.set(request.publicationId, result);
      return result;
    },
    terminalCancelled(request) {
      publications.delete(request.terminal.contextId);
      const identity = identityFor(request.terminal);
      try { service.releaseExtensionProvider(identity, request.providerId); } catch { /* terminal teardown is idempotent */ }
    },
  };
}

function identityFor(context: ExtensionAgentTerminalContext): ActivitySessionIdentity {
  return Object.freeze({
    serverId: context.serverId,
    projectId: context.projectId,
    sessionId: context.terminalSessionId,
  });
}
