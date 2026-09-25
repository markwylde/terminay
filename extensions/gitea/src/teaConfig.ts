import { join } from 'node:path';
import { originOf } from './https.js';

export interface TeaLogin {
	url: string;
	token: string;
}

/**
 * Where `tea` keeps its logins: `$XDG_CONFIG_HOME/tea/config.yml` when that is
 * set, otherwise the platform's configuration directory.
 */
export function teaConfigPath(options: {
	env: NodeJS.ProcessEnv;
	platform: NodeJS.Platform;
	home: string;
}): string {
	const xdg = options.env.XDG_CONFIG_HOME;
	if (xdg !== undefined && xdg.length > 0)
		return join(xdg, 'tea', 'config.yml');
	if (options.platform === 'darwin')
		return join(
			options.home,
			'Library',
			'Application Support',
			'tea',
			'config.yml',
		);
	return join(options.home, '.config', 'tea', 'config.yml');
}

/**
 * Read the `logins:` list from a tea config file. This is a targeted subset
 * of YAML — a top-level `logins:` sequence of flat mappings — which is all tea
 * writes there. Anything unrecognised is skipped rather than guessed at.
 */
export function parseTeaLogins(text: string): TeaLogin[] {
	const logins: TeaLogin[] = [];
	let inLogins = false;
	let current: Record<string, string> | undefined;
	const flush = () => {
		if (
			current !== undefined &&
			typeof current.url === 'string' &&
			current.url.length > 0 &&
			typeof current.token === 'string' &&
			current.token.length > 0
		)
			logins.push({ url: current.url, token: current.token });
		current = undefined;
	};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/\s+$/, '');
		if (line.trim().length === 0 || line.trim().startsWith('#')) continue;
		if (!/^\s/.test(line) && !line.startsWith('-')) {
			flush();
			inLogins = /^logins:\s*$/.test(line);
			continue;
		}
		if (!inLogins) continue;
		const item = /^\s*-\s*(.*)$/.exec(line);
		let entry: string;
		if (item !== null) {
			flush();
			current = {};
			entry = item[1] as string;
			if (entry.length === 0) continue;
		} else {
			entry = line.trim();
		}
		if (current === undefined) continue;
		const pair = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(entry);
		if (pair === null) continue;
		current[pair[1] as string] = scalar(pair[2] as string);
	}
	flush();
	return logins;
}

function scalar(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const quote = trimmed[0];
		if ((quote === '"' || quote === "'") && trimmed.endsWith(quote))
			return trimmed.slice(1, -1);
	}
	const comment = trimmed.indexOf(' #');
	return comment === -1 ? trimmed : trimmed.slice(0, comment).trim();
}

export interface TeaTokenStore {
	/** The token of a tea login for `origin`, unless it was rejected. */
	token(origin: string): Promise<string | undefined>;
	/** The origin refused this login's token; stop offering it. */
	reject(origin: string): void;
	dispose(): void;
}

/**
 * Tea logins held in memory. The file is read once and re-read only when it
 * changes on disk, so a refresh never touches the file and never runs `tea`.
 */
export function createTeaTokenStore(options: {
	path: string;
	readFile: (path: string) => Promise<string>;
	watch?: (path: string, onChange: () => void) => { close(): void } | undefined;
}): TeaTokenStore {
	let logins: Promise<TeaLogin[]> | undefined;
	const rejected = new Set<string>();
	let watcher: { close(): void } | undefined;
	let disposed = false;
	const load = (): Promise<TeaLogin[]> => {
		logins ??= options
			.readFile(options.path)
			.then((text) => {
				if (watcher === undefined && !disposed && options.watch !== undefined)
					try {
						watcher = options.watch(options.path, () => {
							logins = undefined;
							rejected.clear();
						});
					} catch {
						/* without a watch the logins read at start stay in use */
					}
				return parseTeaLogins(text);
			})
			.catch(() => []);
		return logins;
	};
	return {
		async token(origin) {
			if (rejected.has(origin)) return undefined;
			const match = (await load()).find(
				(login) => originOf(login.url) === origin,
			);
			return match?.token;
		},
		reject(origin) {
			rejected.add(origin);
		},
		dispose() {
			disposed = true;
			watcher?.close();
			watcher = undefined;
		},
	};
}
