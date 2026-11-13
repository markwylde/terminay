import { join } from 'node:path';
import { originOf } from './https.js';

export interface TeaLogin {
	url: string;
	token: string;
	/** The login's user name, when tea recorded it. */
	user?: string;
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
			logins.push({
				url: current.url,
				token: current.token,
				...(typeof current.user === 'string' && current.user.length > 0
					? { user: current.user }
					: {}),
			});
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
	/** Every origin with a tea login, once each. */
	origins(): Promise<string[]>;
	/** The user name of the tea login used for `origin`, if recorded. */
	user(origin: string): Promise<string | undefined>;
	dispose(): void;
}

/**
 * Tea logins held in memory. They are kept only while a watch on the file is
 * live, and the watch is set up before the file is read, so no change is
 * missed. A failed read is never kept: a file that is missing now, such as
 * before `tea login` has run, is read again on the next lookup. Nothing here
 * runs `tea`.
 */
export function createTeaTokenStore(options: {
	path: string;
	readFile: (path: string) => Promise<string>;
	/** Watch the file; call `onChange` on any change or watcher error. */
	watch?: (path: string, onChange: () => void) => { close(): void } | undefined;
}): TeaTokenStore {
	let logins: Promise<TeaLogin[]> | undefined;
	const rejected = new Set<string>();
	let watcher: { close(): void } | undefined;
	let disposed = false;
	const dropWatch = () => {
		const current = watcher;
		watcher = undefined;
		try {
			current?.close();
		} catch {
			/* already closed */
		}
	};
	// The file changed, was replaced, or can no longer be watched: forget what
	// was read, and the watch that guarded it, and give rejected origins a
	// chance with whatever the file now holds.
	const invalidate = () => {
		logins = undefined;
		rejected.clear();
		dropWatch();
	};
	const ensureWatch = () => {
		if (watcher !== undefined || disposed || options.watch === undefined) return;
		try {
			watcher = options.watch(options.path, invalidate);
		} catch {
			// Typically the file does not exist yet.
			watcher = undefined;
		}
	};
	const load = (): Promise<TeaLogin[]> => {
		if (logins !== undefined) return logins;
		ensureWatch();
		const read = options.readFile(options.path).then(parseTeaLogins);
		const result = read.catch((): TeaLogin[] => []);
		if (watcher !== undefined) {
			logins = result;
			// A failed read is not kept; an event during the read has already
			// cleared `logins`, so a stale result is not kept either.
			read.catch(() => {
				if (logins === result) logins = undefined;
			});
		}
		return result;
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
		async origins() {
			const origins = new Set<string>();
			for (const login of await load()) {
				const origin = originOf(login.url);
				if (origin !== undefined && origin.startsWith('https:')) origins.add(origin);
			}
			return [...origins];
		},
		async user(origin) {
			return (await load()).find((login) => originOf(login.url) === origin)?.user;
		},
		dispose() {
			disposed = true;
			logins = undefined;
			dropWatch();
		},
	};
}
