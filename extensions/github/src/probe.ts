import { GITHUB_DOT_COM } from './remote.js';

export type FetchLike = (
	input: string,
	init?: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
		signal?: AbortSignal;
	},
) => Promise<{
	readonly status: number;
	readonly ok: boolean;
	readonly headers: { get(name: string): string | null };
	json(): Promise<unknown>;
}>;

const PROBE_TIMEOUT_MS = 10_000;
/** A probe that could not reach the server is retried after this long. */
const FAILURE_RETRY_MS = 10 * 60_000;

export interface GitHubProbe {
	/**
	 * Whether `origin` is GitHub: `true` or `false` once known, `undefined`
	 * when the server could not be reached.
	 */
	isGitHub(origin: string, signal: AbortSignal): Promise<boolean | undefined>;
}

/**
 * `https://github.com` is GitHub without asking. Any other origin is GitHub
 * Enterprise Server when `/api/v3/meta`, asked without credentials, carries
 * the `x-github-enterprise-version` header (sent even on a private-mode 401)
 * or an `installed_version`. An answer holds for the process lifetime; an
 * unreachable server is asked again after ten minutes.
 */
export function createGitHubProbe(options: {
	fetch: FetchLike;
	now?: () => number;
}): GitHubProbe {
	const now = options.now ?? Date.now;
	const verdicts = new Map<string, boolean>([[GITHUB_DOT_COM, true]]);
	const failures = new Map<string, number>();
	const inflight = new Map<string, Promise<boolean | undefined>>();
	return {
		async isGitHub(origin, signal) {
			const verdict = verdicts.get(origin);
			if (verdict !== undefined) return verdict;
			const failedAt = failures.get(origin);
			if (failedAt !== undefined && now() - failedAt < FAILURE_RETRY_MS)
				return undefined;
			const pending = inflight.get(origin);
			if (pending !== undefined) return pending;
			const probe = (async (): Promise<boolean | undefined> => {
				try {
					const response = await options.fetch(`${origin}/api/v3/meta`, {
						headers: { accept: 'application/json' },
						signal: AbortSignal.any([
							signal,
							AbortSignal.timeout(PROBE_TIMEOUT_MS),
						]),
					});
					if (response.headers.get('x-github-enterprise-version') !== null) {
						verdicts.set(origin, true);
						return true;
					}
					if (response.status >= 500) {
						failures.set(origin, now());
						return undefined;
					}
					const body = response.ok
						? await response.json().catch(() => undefined)
						: undefined;
					const isGitHub =
						typeof body === 'object' &&
						body !== null &&
						typeof (body as { installed_version?: unknown })
							.installed_version === 'string';
					verdicts.set(origin, isGitHub);
					return isGitHub;
				} catch {
					if (!signal.aborted) failures.set(origin, now());
					return undefined;
				} finally {
					inflight.delete(origin);
				}
			})();
			inflight.set(origin, probe);
			return probe;
		},
	};
}
