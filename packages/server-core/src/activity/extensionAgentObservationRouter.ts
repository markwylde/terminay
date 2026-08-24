import type { JsonValue } from "@terminay/extension-api";
import { THIS_SERVER_ENVIRONMENT_ID } from "../workspace.js";
import type { ExtensionAgentObservationOperation, ExtensionAgentTerminalContext } from "../extensions/types.js";
import type { ThisServerAgentObservationAdapter } from "../extensions/localAgentObservation.js";
import type { ProjectEnvironmentBinding, ProjectEnvironmentRouter } from "../projectEnvironment/router.js";
import type { ProjectEnvironmentCapability } from "../projectEnvironment/types.js";

export interface ExtensionAgentObservationRouterOptions {
  readonly router: ProjectEnvironmentRouter;
  readonly local: Pick<ThisServerAgentObservationAdapter, "observe">;
  readonly bindingFor: (context: ExtensionAgentTerminalContext) => ProjectEnvironmentBinding | undefined;
}

/** Routes observation through the immutable environment binding captured when
 * the terminal was admitted. Remote failures are explicit and can never fall
 * through to local Node process or filesystem APIs. */
export function createExtensionAgentObservationRouter(options: ExtensionAgentObservationRouterOptions) {
  return async (request: Readonly<{
    terminal: ExtensionAgentTerminalContext;
    operation: ExtensionAgentObservationOperation;
    payload: JsonValue;
  }>, signal: AbortSignal): Promise<JsonValue> => {
    const binding = options.bindingFor(request.terminal);
    if (binding === undefined || binding.serverId !== request.terminal.serverId || binding.projectId !== request.terminal.projectId
      || binding.projectEnvironmentId !== request.terminal.projectEnvironmentId) throw new Error("agent observation environment binding is unavailable");
    if (binding.projectEnvironmentId === THIS_SERVER_ENVIRONMENT_ID) return options.local.observe(request.terminal, request.operation, request.payload, signal);
    const capability = observationCapability(request.operation);
    return options.router.invokeBound<JsonValue>(binding, capability, `agent-observation.${request.operation}`, Object.freeze({
      terminal: Object.freeze({
        serverId: request.terminal.serverId,
        projectId: request.terminal.projectId,
        projectEnvironmentId: request.terminal.projectEnvironmentId,
        terminalSessionId: request.terminal.terminalSessionId,
        terminalIncarnationId: request.terminal.terminalIncarnationId,
      }),
      payload: request.payload,
    }), { signal });
  };
}

function observationCapability(operation: ExtensionAgentObservationOperation): ProjectEnvironmentCapability {
  if (operation.startsWith("process.") || operation === "terminal.tty") return "process-observation";
  if (operation === "filesystem.follow" || operation === "filesystem.unfollow" || operation === "filesystem.read") return "agent-journal";
  return "filesystem-observation";
}
