import type { TerminayExtension } from '@terminay/extension-api';
import { defineExtension } from '@terminay/extension-api';
import type { ClaudeCodeChatOptions } from './chat/claudeCode.js';
import { createClaudeCodeChatProvider } from './chat/claudeCode.js';
import type { CodexChatOptions } from './chat/codex.js';
import { createCodexChatProvider } from './chat/codex.js';
import type { LocatorOptions } from './chat/locate.js';
import { createAgentLocator } from './chat/locate.js';
import type { CodexCommandDefaultOptions } from './commandDefaults.js';
import {
	COMMAND_DEFAULT_LOCAL_IDS,
	createCodexCommandDefault,
} from './commandDefaults.js';
import { createAgentLauncher, LAUNCHER_LOCAL_IDS } from './launchers.js';
import type { McpInstallTargetOptions } from './mcp/targets.js';
import { createMcpInstallTargets } from './mcp/targets.js';
import type { SessionSourceOptions } from './source.js';
import { createSessionSource } from './source.js';

export const EXTENSION_ID = 'com.terminay.builtin-agents';
export const SESSION_SOURCE_ID = `${EXTENSION_ID}/agents`;
export const CLAUDE_CODE_CHAT_PROVIDER_ID = `${EXTENSION_ID}/claude-code`;
export const CODEX_CHAT_PROVIDER_ID = `${EXTENSION_ID}/codex`;
export const CLAUDE_CODE_LAUNCHER_ID = `${EXTENSION_ID}/${LAUNCHER_LOCAL_IDS.claude}`;
export const CODEX_LAUNCHER_ID = `${EXTENSION_ID}/${LAUNCHER_LOCAL_IDS.codex}`;
export const CODEX_COMMAND_DEFAULT_ID = `${EXTENSION_ID}/${COMMAND_DEFAULT_LOCAL_IDS.codex}`;

export type { ClaudeCodeChatOptions } from './chat/claudeCode.js';
export {
	claudeCodeArguments,
	createClaudeCodeChatProvider,
} from './chat/claudeCode.js';
export type { CodexChatOptions } from './chat/codex.js';
export {
	CODEX_ARGUMENTS,
	codexThreadConfig,
	createCodexChatProvider,
} from './chat/codex.js';
export type { AgentLocator, LocatorOptions } from './chat/locate.js';
export type { CodexCommandDefaultOptions, HelpProbe } from './commandDefaults.js';
export {
	CODEX_NO_DAEMON_ARGS,
	COMMAND_DEFAULT_LOCAL_IDS,
	createCodexCommandDefault,
	readHelp,
} from './commandDefaults.js';
export { createAgentLauncher, LAUNCHER_LOCAL_IDS } from './launchers.js';
export { createAgentLocator, OVERRIDE_VARIABLES } from './chat/locate.js';

export type {
	McpInstallTargetDefinition,
	McpInstallTargetOptions,
} from './mcp/targets.js';
export {
	createMcpInstallTargets,
	MCP_TARGET_LOCAL_IDS,
} from './mcp/targets.js';
export type { HarnessDefinition, SessionSourceOptions } from './source.js';
export { createSessionSource, HARNESSES } from './source.js';

export type BuiltInAgentsOptions = {
	source?: SessionSourceOptions;
	mcp?: McpInstallTargetOptions;
	/** How the chat providers and terminal launchers find `claude` and `codex`. */
	locator?: LocatorOptions;
	claudeCode?: Partial<ClaudeCodeChatOptions>;
	codex?: Partial<CodexChatOptions>;
	codexCommandDefault?: CodexCommandDefaultOptions;
};

/** Builds the extension. The default export uses the real library providers and home directory. */
export function createBuiltInAgentsExtension(
	options: BuiltInAgentsOptions = {},
): TerminayExtension {
	return defineExtension({
		activate(context) {
			context.subscriptions.add(
				context.agents.registerSessionSource(
					SESSION_SOURCE_ID,
					createSessionSource(options.source),
				),
			);
			// A fresh locator per activation: CLIs are looked up once, then cached.
			const locator = createAgentLocator(options.locator);
			context.subscriptions.add(
				context.agents.registerChatProvider(
					CLAUDE_CODE_CHAT_PROVIDER_ID,
					createClaudeCodeChatProvider({
						locate: () => locator.locate('claude'),
						...options.claudeCode,
					}),
				),
			);
			context.subscriptions.add(
				context.agents.registerChatProvider(
					CODEX_CHAT_PROVIDER_ID,
					createCodexChatProvider({
						locate: () => locator.locate('codex'),
						...options.codex,
					}),
				),
			);
			// Claude Code is listed before Codex, so it is offered first.
			context.subscriptions.add(
				context.terminals.registerLauncher(
					CLAUDE_CODE_LAUNCHER_ID,
					createAgentLauncher(locator, 'claude'),
				),
			);
			context.subscriptions.add(
				context.terminals.registerLauncher(
					CODEX_LAUNCHER_ID,
					createAgentLauncher(locator, 'codex'),
				),
			);
			// In Terminay terminals Codex runs without its shared background
			// server, so each conversation shows on its own terminal (ADR-0081).
			context.subscriptions.add(
				context.terminals.registerCommandDefault(
					CODEX_COMMAND_DEFAULT_ID,
					createCodexCommandDefault(locator, options.codexCommandDefault),
				),
			);
			for (const target of createMcpInstallTargets(options.mcp)) {
				context.subscriptions.add(
					context.mcp.registerInstallTarget(
						`${EXTENSION_ID}/${target.localId}`,
						target.runtime,
					),
				);
			}
		},
	});
}

export default createBuiltInAgentsExtension();
