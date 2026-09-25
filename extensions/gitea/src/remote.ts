import type { RepositoryRemote } from '@terminay/extension-api';

/** Where a remote's repository lives on its forge. */
export interface ForgeRepository {
	/** `https://host`, with an explicit port only when an HTTPS remote named one. */
	origin: string;
	owner: string;
	repo: string;
}

const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const SEGMENT = /^[A-Za-z0-9._-]{1,255}$/;

/**
 * Parse a Git remote URL into the forge's HTTPS origin and `owner/repo`.
 * Accepts `https://host[:port]/owner/repo(.git)`,
 * `ssh://[user@]host[:port]/owner/repo(.git)`, and scp-style
 * `[user@]host:owner/repo(.git)`. An SSH port is a Git transport detail, not
 * the web port, so it is dropped.
 */
export function parseRemoteUrl(value: string): ForgeRepository | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 2_048) return undefined;
	if (/^https?:\/\//i.test(trimmed) || /^ssh:\/\//i.test(trimmed)) {
		let url: URL;
		try {
			url = new URL(trimmed);
		} catch {
			return undefined;
		}
		const isSsh = url.protocol === 'ssh:';
		const port = !isSsh && url.port !== '' ? `:${url.port}` : '';
		return repository(url.hostname, port, url.pathname);
	}
	const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(trimmed);
	if (scp === null) return undefined;
	return repository(scp[1] as string, '', scp[2] as string);
}

function repository(
	host: string,
	port: string,
	path: string,
): ForgeRepository | undefined {
	if (!HOST.test(host)) return undefined;
	const segments = path
		.replace(/^\/+/, '')
		.replace(/\/+$/, '')
		.replace(/\.git$/i, '')
		.split('/');
	if (segments.length !== 2) return undefined;
	const [owner, repo] = segments as [string, string];
	if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return undefined;
	return { origin: `https://${host.toLowerCase()}${port}`, owner, repo };
}

/** The `origin` remote, else the first remote. */
export function pickRemote(
	remotes: readonly RepositoryRemote[],
): RepositoryRemote | undefined {
	return remotes.find((remote) => remote.name === 'origin') ?? remotes[0];
}
