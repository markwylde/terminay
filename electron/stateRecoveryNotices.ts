import { rmSync } from 'node:fs';
import {
	loadRebuildableStateSync,
	queueStateRecoveryNotices,
	type StateRecoveryNotice,
	type StateStoreName,
	takeStateRecoveryNotices,
	writeFileDurablySync,
} from '../packages/server-core/src/durableFile.ts';

/** Where notices wait across the relaunch a startup recovery performs. */
export const CARRIED_NOTICES_FILE = 'state-recovery-notices.v1.json';

const NOTICE_KINDS = new Set(['restored', 'started-fresh', 'secret-reset']);

/**
 * Before a recovery relaunch: keep what this run recovered, so the run that
 * opens the workspace still tells the user (ADR-0088). Anything carried in
 * earlier and not yet shown travels too.
 */
export function carryStateRecoveryNotices(file: string): void {
	const notices = takeStateRecoveryNotices();
	if (notices.length === 0) return;
	writeFileDurablySync(file, JSON.stringify({ version: 1, notices }), { mode: 0o600 });
}

/** At startup: queue notices carried over a relaunch, then drop the file. */
export function restoreCarriedStateRecoveryNotices(file: string): void {
	const carried = loadRebuildableStateSync(file, 'state-recovery-notices', {
		validate: (value) => {
			const notices = (value as { notices?: unknown } | null)?.notices;
			return Array.isArray(notices) ? notices : undefined;
		},
	});
	if (carried !== undefined)
		queueStateRecoveryNotices(
			carried.filter(
				(notice): notice is StateRecoveryNotice =>
					typeof notice === 'object' &&
					notice !== null &&
					NOTICE_KINDS.has((notice as { kind?: unknown }).kind as string) &&
					typeof (notice as { store?: unknown }).store === 'string',
			),
		);
	rmSync(file, { force: true });
}

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
