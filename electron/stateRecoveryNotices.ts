import type {
	StateRecoveryNotice,
	StateStoreName,
} from '../packages/server-core/src/durableFile.ts';

/** The store names a notice uses, in the user's words. */
const STORE_WORDS: Record<StateStoreName, string> = {
	workspace: 'workspace',
	'desktop-identity': 'device identity',
	'server-settings': 'settings',
	'device-settings': 'terminal settings',
	'remote-access-settings': 'remote access settings',
	macros: 'macros',
	automations: 'automations',
	'connected-servers': 'connected MCP servers',
	'connection-profiles': 'saved connections',
	'window-layout': 'window layout',
	extensions: 'extension choices',
};

function list(items: readonly string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * The one notice Desktop shows after a startup that recovered corrupt state
 * (ADR-0088), or undefined when nothing was recovered. It names stores, never
 * files, and says what the user has to do again.
 */
export function stateRecoveryNoticeText(
	notices: readonly StateRecoveryNotice[],
): { readonly message: string; readonly detail: string } | undefined {
	const restored = [
		...new Set(
			notices
				.filter((notice) => notice.kind === 'restored')
				.map((notice) => STORE_WORDS[notice.store as StateStoreName] ?? 'state'),
		),
	];
	const fresh = [
		...new Set(
			notices
				.filter((notice) => notice.kind === 'started-fresh')
				.map((notice) => STORE_WORDS[notice.store as StateStoreName] ?? 'state'),
		),
	];
	const reset = [
		...new Set(
			notices.filter((notice) => notice.kind === 'secret-reset').map((notice) => notice.store),
		),
	];
	if (restored.length + fresh.length + reset.length === 0) return undefined;
	const lines: string[] = [];
	if (restored.length > 0)
		lines.push(
			`An earlier save was restored for your ${list(restored)}. The most recent changes may be missing.`,
		);
	if (fresh.length > 0) lines.push(`Your ${list(fresh)} started fresh.`);
	if (reset.length > 0)
		lines.push(
			`Your ${list(reset)} could not be read and were cleared. Set them up again; nothing older was restored.`,
		);
	lines.push('The damaged files were kept beside the originals.');
	return {
		message:
			restored.length > 0 && fresh.length + reset.length === 0
				? 'Terminay restored an earlier save'
				: 'Terminay recovered from damaged saved data',
		detail: lines.join('\n\n'),
	};
}
