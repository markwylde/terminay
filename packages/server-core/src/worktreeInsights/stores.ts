import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadRebuildableState, writeFileDurably } from '../durableFile.js';
import type { ServerVaultService } from '../settings/vault.js';
import type {
	WorktreeCredentialVault,
	WorktreePromptPreferences,
} from './service.js';

/** Sign-in tokens stored in the encrypted server vault. */
export function serverVaultWorktreeCredentials(
	vault: Pick<
		ServerVaultService,
		'status' | 'put' | 'replace' | 'remove' | 'withSecret'
	>,
): WorktreeCredentialVault {
	const has = (id: string) =>
		vault.status().entries.some((entry) => entry.id === id);
	return Object.freeze({
		has,
		async put(id: string, label: string, value: Uint8Array) {
			try {
				await (has(id)
					? vault.replace({ id, label, value })
					: vault.put({ id, label, value }));
			} finally {
				value.fill(0);
			}
		},
		read(id: string) {
			return vault.withSecret(id, (secret) => new TextDecoder().decode(secret));
		},
		async remove(id: string) {
			await vault.remove(id);
		},
	});
}

/** The "Don't ask me again" choices, one small JSON file on the server. */
export function fileWorktreePromptPreferences(
	path: string,
): WorktreePromptPreferences {
	return Object.freeze({
		async load() {
			// Rebuildable (ADR-0088): a corrupt file is set aside and the prompts
			// show again.
			try {
				const list = await loadRebuildableState(path, 'worktree-prompts', {
					validate: (parsed) => {
						const value =
							typeof parsed === 'object' && parsed !== null
								? (parsed as { suppressedExtensions?: unknown })
										.suppressedExtensions
								: undefined;
						return Array.isArray(value) ? value : undefined;
					},
				});
				return (list ?? []).filter(
					(id): id is string => typeof id === 'string' && id.length <= 128,
				);
			} catch {
				return [];
			}
		},
		async save(extensionIds: readonly string[]) {
			await mkdir(dirname(path), { recursive: true });
			await writeFileDurably(
				path,
				`${JSON.stringify({ version: 1, suppressedExtensions: extensionIds }, null, 2)}\n`,
				{ mode: 0o600 },
			);
		},
	});
}
