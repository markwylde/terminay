import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
			try {
				const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
				const list =
					typeof parsed === 'object' && parsed !== null
						? (parsed as { suppressedExtensions?: unknown })
								.suppressedExtensions
						: undefined;
				return Array.isArray(list)
					? list.filter(
							(id): id is string => typeof id === 'string' && id.length <= 128,
						)
					: [];
			} catch {
				return [];
			}
		},
		async save(extensionIds: readonly string[]) {
			await mkdir(dirname(path), { recursive: true });
			const temporary = `${path}.${process.pid}.tmp`;
			await writeFile(
				temporary,
				`${JSON.stringify({ version: 1, suppressedExtensions: extensionIds }, null, 2)}\n`,
				{ mode: 0o600 },
			);
			await rename(temporary, path);
		},
	});
}
