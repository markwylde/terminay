import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

export interface RepositoryGitConfig {
	readonly remotes: readonly { readonly name: string; readonly url: string }[];
	/** Local branch name → its upstream remote and remote branch. */
	readonly upstreams: ReadonlyMap<
		string,
		{ readonly remote: string; readonly branch: string }
	>;
}

const MAX_CONFIG_BYTES = 256 * 1024;
const EMPTY: RepositoryGitConfig = Object.freeze({
	remotes: Object.freeze([]),
	upstreams: new Map(),
});

/**
 * Read remotes and branch upstreams from a repository's shared config file.
 * It is a file read, not a `git` spawn: this runs on every listing, and
 * ADR-0021 counts background cost in child processes.
 */
export async function readRepositoryGitConfig(
	repositoryRoot: string,
): Promise<RepositoryGitConfig> {
	try {
		const commonDir = await resolveCommonDir(repositoryRoot);
		if (commonDir === undefined) return EMPTY;
		const text = await readFile(join(commonDir, 'config'), 'utf8');
		if (text.length > MAX_CONFIG_BYTES) return EMPTY;
		return parseGitConfig(text);
	} catch {
		return EMPTY;
	}
}

async function resolveCommonDir(
	repositoryRoot: string,
): Promise<string | undefined> {
	const dotGit = join(repositoryRoot, '.git');
	const info = await stat(dotGit).catch(() => undefined);
	if (info === undefined) return undefined;
	if (info.isDirectory()) return dotGit;
	const pointer = /^gitdir:\s*(.+)\s*$/m.exec(await readFile(dotGit, 'utf8'));
	if (pointer === null) return undefined;
	const gitDir = resolve(repositoryRoot, pointer[1] as string);
	const commonDir = await readFile(join(gitDir, 'commondir'), 'utf8').catch(
		() => undefined,
	);
	if (commonDir === undefined) return gitDir;
	const trimmed = commonDir.trim();
	return isAbsolute(trimmed) ? trimmed : resolve(gitDir, trimmed);
}

/** A deliberately small reader for the keys this feature needs. */
export function parseGitConfig(text: string): RepositoryGitConfig {
	const remotes = new Map<string, string>();
	const branches = new Map<string, { remote?: string; merge?: string }>();
	let section: { kind: 'remote' | 'branch'; name: string } | undefined;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith('#') || line.startsWith(';'))
			continue;
		const header =
			/^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]$/.exec(line);
		if (header !== null) {
			const kind = (header[1] as string).toLowerCase();
			section =
				(kind === 'remote' || kind === 'branch') && header[2] !== undefined
					? { kind, name: header[2].replace(/\\(.)/g, '$1') }
					: undefined;
			continue;
		}
		if (section === undefined) continue;
		const entry = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/.exec(line);
		if (entry === null) continue;
		const key = (entry[1] as string).toLowerCase();
		const value = unquote(entry[2] as string);
		if (section.kind === 'remote' && key === 'url') {
			if (!remotes.has(section.name)) remotes.set(section.name, value);
		} else if (section.kind === 'branch') {
			const branch = branches.get(section.name) ?? {};
			if (key === 'remote') branch.remote = value;
			if (key === 'merge') branch.merge = value;
			branches.set(section.name, branch);
		}
	}
	const upstreams = new Map<string, { remote: string; branch: string }>();
	for (const [name, branch] of branches) {
		if (
			branch.remote === undefined ||
			branch.remote === '.' ||
			branch.merge === undefined
		)
			continue;
		const merged = branch.merge.startsWith('refs/heads/')
			? branch.merge.slice('refs/heads/'.length)
			: branch.merge;
		if (merged.length > 0)
			upstreams.set(name, { remote: branch.remote, branch: merged });
	}
	return Object.freeze({
		remotes: Object.freeze(
			[...remotes].map(([name, url]) => Object.freeze({ name, url })),
		),
		upstreams,
	});
}

function unquote(value: string): string {
	const trimmed = value.replace(/\s+[#;].*$/, '').trim();
	return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
		? trimmed.slice(1, -1).replace(/\\(.)/g, '$1')
		: trimmed;
}
