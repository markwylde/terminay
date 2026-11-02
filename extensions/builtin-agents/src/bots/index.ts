import type { BotAgentRuntime } from '@terminay/extension-api';

export const BOT_AGENT_IDS = {
	claude: 'com.terminay.builtin-agents/claude-code',
	codex: 'com.terminay.builtin-agents/codex',
} as const;

// Model ids observed in the pinned adapters at gate 0.6. The host adds Default
// and selects through the ACP model config option, never through CLI flags.
const models = {
	claude: ['default', 'opus', 'fable', 'sonnet', 'haiku'],
	codex: [
		'gpt-6.1-sol',
		'gpt-6-astra',
		'gpt-6-sol',
		'gpt-6-luna',
		'gpt-5.6-sol',
		'gpt-6.1-terra',
		'gpt-5.6-terra',
		'gpt-5.6-luna',
		'gpt-5.5',
	],
} as const;

/** Describes an adapter only. Credentials injected into a bot belong to the
 * server; availability here never inspects the server account’s credentials. */
export function createBotAgent(
	agent: keyof typeof BOT_AGENT_IDS,
): BotAgentRuntime {
	return {
		async models(signal) {
			signal.throwIfAborted();
			return models[agent].map((id) => ({ id, displayName: id }));
		},
		async status(signal) {
			signal.throwIfAborted();
			return { state: 'ready' };
		},
		async launch(_request, signal) {
			signal.throwIfAborted();
			return { args: [], env: {} };
		},
	};
}
