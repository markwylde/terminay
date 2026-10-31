import type {
	StateFileKind,
	StateStoreName,
} from '../packages/server-core/src/durableFile.ts';

/**
 * One state file Terminay Desktop, or the server embedded in it, reads from
 * its user-data root at startup or on first use (ADR-0088).
 *
 * - `file`: a path relative to the user-data root, with `/` separators. When
 *   `pattern` is set it is a glob instead (`*` matches one path segment), and
 *   it names every file of that kind.
 * - `kind`: how a corrupt file is recovered. Canonical falls back to
 *   `<file>.previous`, or stops startup with `state_unreadable` naming
 *   `store`. Secret starts empty and fails closed with a reset notice.
 *   Rebuildable is set aside and rebuilt silently.
 * - `store`: the canonical store name the recovery document offers to start
 *   fresh. Present exactly when `kind` is canonical.
 * - `label`: the name the loader reports for secret and rebuildable files.
 */
export interface DesktopStateFile {
	readonly file: string;
	readonly pattern?: true;
	readonly kind: StateFileKind;
	readonly store?: StateStoreName;
	readonly label: string;
}

/**
 * Every Desktop state file the corrupted-data-root suite rewrites. A new
 * store is added here when it is added to the code, or the suite fails.
 *
 * Not listed: the holder runtime copy (`holder-runtime/`), which proves
 * itself with a manifest; recordings, which are user documents with their own
 * durable writer; the write-once settings `.pre-migration.json` backup, which
 * nothing reads; the process lock; Chromium's
 * own profile files; and the dead `macros.json`, `remote-host-key.v1.json`
 * and `remote-pairing-pin-verifier`, which are only migrated from or removed.
 */
export const DESKTOP_STATE_FILES: readonly DesktopStateFile[] = Object.freeze([
	// Canonical: a corrupt file restores `.previous` or asks the user.
	{
		file: 'desktop-instance.v1.json',
		kind: 'canonical',
		store: 'desktop-identity',
		label: 'desktop-identity',
	},
	{
		file: 'workspace.v4.json',
		kind: 'canonical',
		store: 'workspace',
		label: 'workspace',
	},
	{
		file: 'server-settings.v1.json',
		kind: 'canonical',
		store: 'server-settings',
		label: 'server-settings',
	},
	{
		file: 'terminal-settings.json',
		kind: 'canonical',
		store: 'device-settings',
		label: 'device-settings',
	},
	{
		file: 'remote-access-settings.json',
		kind: 'canonical',
		store: 'remote-access-settings',
		label: 'remote-access-settings',
	},
	{
		file: 'server-macros.v1.json',
		kind: 'canonical',
		store: 'macros',
		label: 'macros',
	},
	{
		file: 'automations.v1.json',
		kind: 'canonical',
		store: 'automations',
		label: 'automations',
	},
	{
		file: 'automation-runs.v1.json',
		kind: 'canonical',
		store: 'automations',
		label: 'automation-runs',
	},
	{
		file: 'mcp-connected-servers.v1.json',
		kind: 'canonical',
		store: 'connected-servers',
		label: 'connected-servers',
	},
	{
		file: 'connection-profiles.json',
		kind: 'canonical',
		store: 'connection-profiles',
		label: 'connection-profiles',
	},
	{
		file: 'window-composition.v1.json',
		kind: 'canonical',
		store: 'window-layout',
		label: 'window-layout',
	},
	{
		file: 'extensions/registry.v1.json',
		kind: 'canonical',
		store: 'extensions',
		label: 'extensions',
	},

	// Secret, credential and revocation: a corrupt file fails closed.
	{ file: 'vault/safe-storage.v1.json', kind: 'secret', label: 'vault' },
	{
		file: 'extensions/data/*/provider-vault/*.json',
		pattern: true,
		kind: 'secret',
		label: 'provider-vault',
	},
	{
		file: 'remote-device-credentials/remote-device-*.json',
		pattern: true,
		kind: 'secret',
		label: 'remote-device-credential',
	},
	{ file: 'remote-devices.v1.json', kind: 'secret', label: 'remote-devices' },
	{
		file: 'remote-host-key.v2.protected.json',
		kind: 'secret',
		label: 'host-key',
	},
	{ file: 'push-enrolments.v1.json', kind: 'secret', label: 'push-enrolments' },
	{
		file: 'mcp-capabilities.v1.json',
		kind: 'secret',
		label: 'mcp-capabilities',
	},
	{
		file: 'remote-session-origin.v1.json',
		kind: 'secret',
		label: 'remote-session-origin',
	},

	// Rebuildable: a corrupt file is set aside and rebuilt.
	{ file: 'git-trace.key', kind: 'rebuildable', label: 'git-trace-key' },
	{
		file: 'session-holder/*.json',
		pattern: true,
		kind: 'rebuildable',
		label: 'session-holder',
	},
	{
		file: 'session-holder/*.closed',
		pattern: true,
		kind: 'rebuildable',
		label: 'session-holder-close',
	},
	{
		file: 'session-tails/*',
		pattern: true,
		kind: 'rebuildable',
		label: 'session-tail',
	},
	{
		file: 'app-windows/*.json',
		pattern: true,
		kind: 'rebuildable',
		label: 'app-window',
	},
	{
		file: 'worktree-insights.v1.json',
		kind: 'rebuildable',
		label: 'worktree-prompts',
	},
	{
		file: 'window-server.v1.json',
		kind: 'rebuildable',
		label: 'window-server',
	},
	{
		file: 'diagnostics-preferences.v1.json',
		kind: 'rebuildable',
		label: 'diagnostics-preferences',
	},
	{
		file: 'recording-roots.json',
		kind: 'rebuildable',
		label: 'recording-roots',
	},
	{
		file: 'server-recording-roots.v1.json',
		kind: 'rebuildable',
		label: 'recording-roots',
	},
	{
		file: 'state-recovery-notices.v1.json',
		kind: 'rebuildable',
		label: 'state-recovery-notices',
	},
	// Under the app logs path, which E2E places at `<userData>/logs`.
	{
		file: 'logs/terminay-launch-v1.json',
		kind: 'rebuildable',
		label: 'launch-marker',
	},
]);
