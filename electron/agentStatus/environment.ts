export const TERMINAY_SESSION_ID_ENV = 'TERMINAY_SESSION_ID';
export const TERMINAY_AGENT_HOOK_ENDPOINT_ENV = 'TERMINAY_AGENT_HOOK_ENDPOINT';
export const TERMINAY_AGENT_HOOK_TOKEN_ENV = 'TERMINAY_AGENT_HOOK_TOKEN';

export interface AgentHookEnvironment {
	[TERMINAY_AGENT_HOOK_ENDPOINT_ENV]: string;
	[TERMINAY_AGENT_HOOK_TOKEN_ENV]: string;
	[TERMINAY_SESSION_ID_ENV]: string;
}

export function createAgentHookEnvironment(
	sessionId: string,
	endpoint: string,
	token: string,
): AgentHookEnvironment {
	if (!sessionId || !endpoint || !token) {
		throw new Error(
			'Agent hook environment requires a session id, endpoint, and token.',
		);
	}

	return {
		[TERMINAY_SESSION_ID_ENV]: sessionId,
		[TERMINAY_AGENT_HOOK_ENDPOINT_ENV]: endpoint,
		[TERMINAY_AGENT_HOOK_TOKEN_ENV]: token,
	};
}
