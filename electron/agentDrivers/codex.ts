import {
	createNodeAgentDriverFileSystem,
	createJsonHookReconciler,
	readHooksConfig,
} from './managedHooks';
import {
	codexTrustErrorStatus,
	inspectCodexManagedTrust,
	reconcileCodexManagedTrust,
	removeCodexManagedTrust,
} from './codexTrust';
import { enrichCodexNativePayload } from './codexTranscript';
import { normalizePreparedHook, prepareNativeHook } from './normalize';
import type { AgentDriver } from './types';

export const CODEX_MANAGED_EVENTS = [
	{ eventName: 'SessionStart' },
	{ eventName: 'SessionEnd' },
	{ eventName: 'UserPromptSubmit' },
	{ eventName: 'PreToolUse', matcher: '*' },
	{ eventName: 'PermissionRequest', matcher: '*' },
	{ eventName: 'PostToolUse', matcher: '*' },
	{ eventName: 'SubagentStart' },
	{ eventName: 'SubagentStop' },
	{ eventName: 'Stop' },
] as const;
const CODEX_NATIVE_EVENTS: ReadonlySet<string> = new Set(
	CODEX_MANAGED_EVENTS.map(({ eventName }) => eventName),
);

const codexJsonHooks = createJsonHookReconciler(
	'codex',
	['.codex', 'hooks.json'],
	CODEX_MANAGED_EVENTS,
	{ placement: 'append' },
);

export const codexDriver: AgentDriver = {
	provider: 'codex',
	displayName: 'Codex',
	hooks: {
		provider: 'codex',
		paths: codexJsonHooks.paths,
		async status(options = {}) {
			const status = await codexJsonHooks.status(options);
			if (!status.managedHooksPresent || status.state === 'error') {
				return status;
			}
			const paths = codexJsonHooks.paths(options);
			const result = await readHooksConfig(
				paths.configPath,
				options.fileSystem ?? createNodeAgentDriverFileSystem(),
			);
			if ('error' in result) {
				return codexTrustErrorStatus(status, result.error);
			}
			try {
				const trust = await inspectCodexManagedTrust(
					paths,
					result.config,
					options,
				);
				return trust.current
					? status
					: {
							...status,
							state: 'partial',
							error: `Codex hook trust is missing for ${trust.missingKeys.length} managed hook(s).`,
						};
			} catch (error) {
				return codexTrustErrorStatus(status, error);
			}
		},
		async install(options = {}) {
			const status = await codexJsonHooks.install(options);
			if (status.state === 'error') {
				return status;
			}
			const paths = codexJsonHooks.paths(options);
			const fileSystem = options.fileSystem;
			const result = await readHooksConfig(
				paths.configPath,
				fileSystem ?? createNodeAgentDriverFileSystem(),
			);
			if ('error' in result) {
				return codexTrustErrorStatus(status, result.error);
			}
			try {
				await reconcileCodexManagedTrust(paths, result.config, options);
				return this.status(options);
			} catch (error) {
				return codexTrustErrorStatus(status, error);
			}
		},
		async uninstall(options = {}) {
			const paths = codexJsonHooks.paths(options);
			const fileSystem =
				options.fileSystem ?? createNodeAgentDriverFileSystem();
			const result = await readHooksConfig(paths.configPath, fileSystem);
			if (!('error' in result)) {
				try {
					await removeCodexManagedTrust(paths, result.config, options);
				} catch (error) {
					const status = await codexJsonHooks.status(options);
					return codexTrustErrorStatus(status, error);
				}
			}
			return codexJsonHooks.uninstall(options);
		},
	},
	enrichNativePayload: enrichCodexNativePayload,
	normalize(nativePayload, context) {
		const native = prepareNativeHook(nativePayload, context);
		return native && CODEX_NATIVE_EVENTS.has(native.eventName)
			? normalizePreparedHook('codex', native, context)
			: null;
	},
};
