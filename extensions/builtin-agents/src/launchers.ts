import type { TerminalLauncherRuntime } from '@terminay/extension-api';
import { defineTerminalLauncher } from '@terminay/extension-api';
import type { AgentExecutable, AgentLocator } from './chat/locate.js';

/**
 * The terminal launchers for Claude Code and Codex (ADR-0073). Each only says
 * where its CLI is installed, found the same way its chat provider finds it;
 * the host types that path into a new terminal's shell with no arguments.
 */
export const LAUNCHER_LOCAL_IDS = Object.freeze({
	claude: 'launch-claude-code',
	codex: 'launch-codex',
} as const satisfies Record<AgentExecutable, string>);

export function createAgentLauncher(
	locator: AgentLocator,
	agent: AgentExecutable,
): TerminalLauncherRuntime {
	return defineTerminalLauncher({
		async resolve() {
			const executable = await locator.locate(agent);
			return executable === undefined
				? {
						available: false,
						reason: 'not_installed',
						detail: `No ${agent} executable was found on this server account.`,
					}
				: { available: true, executable };
		},
	});
}
