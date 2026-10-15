import { join } from 'node:path';
import { GITHUB_DOT_COM, ghHostOf } from './remote.js';

/**
 * Where `gh` keeps `hosts.yml`: `$GH_CONFIG_DIR`, else
 * `$XDG_CONFIG_HOME/gh`, else `%AppData%\GitHub CLI` on Windows and
 * `~/.config/gh` everywhere else, macOS included.
 */
export function ghHostsPath(options: {
	env: NodeJS.ProcessEnv;
	platform: NodeJS.Platform;
	home: string;
}): string {
	const { env } = options;
	if (env.GH_CONFIG_DIR !== undefined && env.GH_CONFIG_DIR.length > 0)
		return join(env.GH_CONFIG_DIR, 'hosts.yml');
	if (env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME.length > 0)
		return join(env.XDG_CONFIG_HOME, 'gh', 'hosts.yml');
	if (
		options.platform === 'win32' &&
		env.AppData !== undefined &&
		env.AppData.length > 0
	)
		return join(env.AppData, 'GitHub CLI', 'hosts.yml');
	return join(options.home, '.config', 'gh', 'hosts.yml');
}

/** A host `gh` is logged in to, with its token when the file holds it. */
export interface GhHost {
	token?: string;
}

/**
 * Read `hosts.yml`: a top-level mapping of host to nested mappings. The
 * active login's token is the host's `oauth_token`, else
 * `users.<user>.oauth_token`. A host with neither keeps its token in the
 * system keychain. This is a targeted subset of YAML (nested block
 * mappings of scalars), which is all `gh` writes there.
 */
export function parseGhHosts(text: string): Map<string, GhHost> {
	const values = new Map<string, string>();
	const hosts = new Set<string>();
	const stack: Array<{ indent: number; key: string }> = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/\s+$/, '');
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
		const pair = /^(\s*)("[^"]*"|'[^']*'|[^\s:#][^:#]*?):(?:\s+(.*))?$/.exec(
			line,
		);
		if (pair === null) continue;
		const indent = (pair[1] as string).length;
		const key = unquote(pair[2] as string);
		while (
			stack.length > 0 &&
			(stack.at(-1) as { indent: number }).indent >= indent
		)
			stack.pop();
		const path = [...stack.map((entry) => entry.key), key];
		if (path.length === 1) hosts.add(key);
		const value = pair[3];
		if (value === undefined || value.length === 0) stack.push({ indent, key });
		else values.set(path.join('\u0000'), scalar(value));
	}
	const result = new Map<string, GhHost>();
	for (const host of hosts) {
		const get = (...path: string[]) =>
			values.get([host, ...path].join('\u0000'));
		const user = get('user');
		const token =
			get('oauth_token') ??
			(user === undefined ? undefined : get('users', user, 'oauth_token'));
		result.set(
			host.toLowerCase(),
			token === undefined || token.length === 0 ? {} : { token },
		);
	}
	return result;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const quote = trimmed[0];
		if ((quote === '"' || quote === "'") && trimmed.endsWith(quote))
			return trimmed.slice(1, -1);
	}
	return trimmed;
}

function scalar(value: string): string {
	const trimmed = value.trim();
	const quoted = /^(?:"([^"]*)"|'([^']*)')(?:\s+#.*)?$/.exec(trimmed);
	if (quoted !== null) return quoted[1] ?? (quoted[2] as string);
	const comment = trimmed.indexOf(' #');
	return comment === -1 ? trimmed : trimmed.slice(0, comment).trim();
}

/**
 * The token `gh` itself would use from the environment: `GH_TOKEN`, then
 * `GITHUB_TOKEN` for github.com; the `_ENTERPRISE_` pair for other hosts.
 */
export function environmentToken(
	origin: string,
	env: NodeJS.ProcessEnv,
): string | undefined {
	const names =
		origin === GITHUB_DOT_COM
			? ['GH_TOKEN', 'GITHUB_TOKEN']
			: ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];
	for (const name of names) {
		const value = env[name]?.trim();
		if (value !== undefined && value.length > 0) return value;
	}
	return undefined;
}

/** Runs `gh auth token --hostname <host>`; resolves its token or undefined. */
export type GhTokenCommand = (host: string) => Promise<string | undefined>;

export interface CliTokenStore {
	/** The first credential for `origin` that has not been rejected. */
	token(origin: string): Promise<string | undefined>;
	/** The origin refused the token last returned for it; stop offering it. */
	reject(origin: string): void;
	dispose(): void;
}

type Source = 'env' | 'file' | 'gh';

/**
 * Credentials `gh` already has, held in memory. `hosts.yml` is read once and
 * again only when it changes on disk. `gh auth token` runs only for a host the
 * file lists without a token (the token is in the keychain), at most once
 * until that token is rejected or the file changes, and never from a refresh
 * that already holds a token (ADR-0063).
 */
export function createCliTokenStore(options: {
	env: NodeJS.ProcessEnv;
	path: string;
	readFile: (path: string) => Promise<string>;
	watch?: (path: string, onChange: () => void) => { close(): void } | undefined;
	ghToken: GhTokenCommand;
}): CliTokenStore {
	let hosts: Promise<Map<string, GhHost>> | undefined;
	let watcher: { close(): void } | undefined;
	let disposed = false;
	/** Sources an origin rejected; env rejections last for the process. */
	const rejected = new Map<string, Set<'env' | 'file'>>();
	/** The `gh auth token` result per host: a token, or a remembered failure. */
	const fromGh = new Map<string, Promise<string | undefined>>();
	/** Tokens from `gh` that their host rejected. */
	const rejectedGh = new Map<string, Set<string>>();
	const lastSource = new Map<string, Source>();

	const load = (): Promise<Map<string, GhHost>> => {
		hosts ??= options
			.readFile(options.path)
			.then((text) => {
				if (watcher === undefined && !disposed && options.watch !== undefined)
					try {
						watcher = options.watch(options.path, () => {
							hosts = undefined;
							fromGh.clear();
							rejectedGh.clear();
							for (const sources of rejected.values()) sources.delete('file');
						});
					} catch {
						/* without a watch the hosts read at start stay in use */
					}
				return parseGhHosts(text);
			})
			.catch(() => new Map());
		return hosts;
	};

	const isRejected = (origin: string, source: 'env' | 'file') =>
		rejected.get(origin)?.has(source) === true;

	return {
		async token(origin) {
			const env = environmentToken(origin, options.env);
			if (env !== undefined && !isRejected(origin, 'env')) {
				lastSource.set(origin, 'env');
				return env;
			}
			const host = ghHostOf(origin);
			const entry = (await load()).get(host.toLowerCase());
			if (entry === undefined) return undefined;
			if (entry.token !== undefined) {
				if (isRejected(origin, 'file')) return undefined;
				lastSource.set(origin, 'file');
				return entry.token;
			}
			if (disposed) return undefined;
			let pending = fromGh.get(host);
			if (pending === undefined) {
				pending = options.ghToken(host).catch(() => undefined);
				fromGh.set(host, pending);
			}
			const token = await pending;
			if (token === undefined || rejectedGh.get(host)?.has(token) === true)
				return undefined;
			lastSource.set(origin, 'gh');
			return token;
		},
		reject(origin) {
			const source = lastSource.get(origin);
			if (source === undefined) return;
			lastSource.delete(origin);
			if (source === 'gh') {
				// Ask `gh` once more, in case its keychain token was renewed.
				// The answer is cached, so a token it still holds that was
				// rejected costs one spawn, not one per refresh.
				const host = ghHostOf(origin);
				void fromGh.get(host)?.then((token) => {
					if (token === undefined) return;
					let tokens = rejectedGh.get(host);
					if (tokens === undefined) {
						tokens = new Set();
						rejectedGh.set(host, tokens);
					}
					tokens.add(token);
				});
				fromGh.delete(host);
				return;
			}
			let sources = rejected.get(origin);
			if (sources === undefined) {
				sources = new Set();
				rejected.set(origin, sources);
			}
			sources.add(source);
		},
		dispose() {
			disposed = true;
			watcher?.close();
			watcher = undefined;
		},
	};
}
