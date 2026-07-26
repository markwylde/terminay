import { createJsonHookReconciler } from './managedHooks';
import { normalizePreparedHook, prepareNativeHook } from './normalize';
import type { AgentDriver } from './types';

export const CLAUDE_CODE_MANAGED_EVENTS = [
	{ eventName: 'SessionStart' },
	{ eventName: 'UserPromptSubmit' },
	{ eventName: 'PreToolUse', matcher: '*' },
	{ eventName: 'PermissionRequest', matcher: '*' },
	{ eventName: 'PostToolUse', matcher: '*' },
	{ eventName: 'PostToolUseFailure', matcher: '*' },
	{ eventName: 'SubagentStart' },
	{ eventName: 'SubagentStop' },
	{ eventName: 'Stop' },
	{ eventName: 'StopFailure' },
] as const;
const CLAUDE_CODE_NATIVE_EVENTS: ReadonlySet<string> = new Set(
	CLAUDE_CODE_MANAGED_EVENTS.map(({ eventName }) => eventName),
);

export const claudeCodeDriver: AgentDriver = {
	provider: 'claude-code',
	displayName: 'Claude Code',
	hooks: createJsonHookReconciler(
		'claude-code',
		['.claude', 'settings.json'],
		CLAUDE_CODE_MANAGED_EVENTS,
	),
	normalize(nativePayload, context) {
		const native = prepareNativeHook(nativePayload, context);
		return native && CLAUDE_CODE_NATIVE_EVENTS.has(native.eventName)
			? normalizePreparedHook('claude-code', native, context)
			: null;
	},
};
