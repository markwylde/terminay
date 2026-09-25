export type FetchLike = (
	input: string,
	init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
	readonly status: number;
	readonly ok: boolean;
	json(): Promise<unknown>;
}>;

const PROBE_TIMEOUT_MS = 10_000;
/** A probe that could not reach the server is retried after this long. */
const FAILURE_RETRY_MS = 10 * 60_000;

export interface GiteaProbe {
	/**
	 * Whether `origin` serves the Gitea API: `true` or `false` once the server
	 * answered, `undefined` when it could not be reached.
	 */
	isGitea(origin: string, signal: AbortSignal): Promise<boolean | undefined>;
}

/**
 * Detects Gitea by asking `/api/v1/version` without credentials. A server
 * that answers with a version is Gitea (or the API-compatible Forgejo), and
 * an answer holds for the process lifetime. An unreachable server is not an
 * answer: it is reported as unknown and asked again after ten minutes.
 */
export function createGiteaProbe(options: {
	fetch: FetchLike;
	now?: () => number;
}): GiteaProbe {
	const now = options.now ?? Date.now;
	const verdicts = new Map<string, boolean>();
	const failures = new Map<string, number>();
	const inflight = new Map<string, Promise<boolean | undefined>>();
	return {
		async isGitea(origin, signal) {
			const verdict = verdicts.get(origin);
			if (verdict !== undefined) return verdict;
			const failedAt = failures.get(origin);
			if (failedAt !== undefined && now() - failedAt < FAILURE_RETRY_MS)
				return undefined;
			const pending = inflight.get(origin);
			if (pending !== undefined) return pending;
			const probe = (async (): Promise<boolean | undefined> => {
				try {
					const response = await options.fetch(`${origin}/api/v1/version`, {
						headers: { accept: 'application/json' },
						signal: AbortSignal.any([
							signal,
							AbortSignal.timeout(PROBE_TIMEOUT_MS),
						]),
					});
					if (response.status >= 500) {
						failures.set(origin, now());
						return undefined;
					}
					const body = response.ok
						? await response.json().catch(() => undefined)
						: undefined;
					const isGitea =
						typeof body === 'object' &&
						body !== null &&
						typeof (body as { version?: unknown }).version === 'string';
					verdicts.set(origin, isGitea);
					return isGitea;
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
