/** Environment inherited by provider hooks launched for one exact terminal. */
export const TERMINAY_SESSION_ID_ENV = "TERMINAY_SESSION_ID";
export const TERMINAY_AGENT_HOOK_ENDPOINT_ENV = "TERMINAY_AGENT_HOOK_ENDPOINT";
export const TERMINAY_AGENT_HOOK_TOKEN_ENV = "TERMINAY_AGENT_HOOK_TOKEN";

export interface AgentHookEnvironment {
  readonly [TERMINAY_SESSION_ID_ENV]: string;
  readonly [TERMINAY_AGENT_HOOK_ENDPOINT_ENV]: string;
  readonly [TERMINAY_AGENT_HOOK_TOKEN_ENV]: string;
}

/** Build a bounded, exact-scope environment without retaining provider data. */
export function createAgentHookEnvironment(sessionId: string, endpoint: string, token: string): AgentHookEnvironment {
  for (const [name, value] of [[TERMINAY_SESSION_ID_ENV, sessionId], [TERMINAY_AGENT_HOOK_ENDPOINT_ENV, endpoint], [TERMINAY_AGENT_HOOK_TOKEN_ENV, token]] as const) {
    if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0") || value.includes("\r") || value.includes("\n")) {
      throw new TypeError(`agent hook environment requires a valid ${name}`);
    }
  }
  return Object.freeze({
    [TERMINAY_SESSION_ID_ENV]: sessionId,
    [TERMINAY_AGENT_HOOK_ENDPOINT_ENV]: endpoint,
    [TERMINAY_AGENT_HOOK_TOKEN_ENV]: token,
  });
}
