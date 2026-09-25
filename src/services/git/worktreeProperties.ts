import type { JsonValue } from '@terminay/protocol';
import type {
	WorktreeCheckState,
	WorktreeProperties,
	WorktreePullRequestState,
	WorktreeSignInPrompt,
} from '../../types/terminay';

const PULL_REQUEST_STATES: readonly string[] = [
	'open',
	'draft',
	'merged',
	'closed',
];
const CHECK_STATES: readonly string[] = [
	'passed',
	'failed',
	'pending',
	'skipped',
];

/**
 * Read extension-published worktree properties. The server validated them
 * already; anything unexpected is dropped rather than failing the Git panel.
 */
export function parseWorktreeProperties(
	value: JsonValue | undefined,
): WorktreeProperties | undefined {
	const source = record(value);
	if (source === undefined) return undefined;
	const result: WorktreeProperties = {};
	const pullRequest = record(source.pullRequest);
	if (
		pullRequest !== undefined &&
		typeof pullRequest.number === 'number' &&
		typeof pullRequest.title === 'string' &&
		safeHttpsUrl(pullRequest.url) &&
		PULL_REQUEST_STATES.includes(pullRequest.state as string)
	)
		result.pullRequest = {
			number: pullRequest.number,
			title: pullRequest.title,
			url: pullRequest.url as string,
			state: pullRequest.state as WorktreePullRequestState,
			...(typeof pullRequest.mergeable === 'boolean'
				? { mergeable: pullRequest.mergeable }
				: {}),
		};
	const checks = record(source.checks);
	const counts = ['passed', 'failed', 'pending', 'skipped', 'total'] as const;
	if (
		checks !== undefined &&
		counts.every(
			(key) => typeof checks[key] === 'number' && (checks[key] as number) >= 0,
		)
	)
		result.checks = {
			passed: checks.passed as number,
			failed: checks.failed as number,
			pending: checks.pending as number,
			skipped: checks.skipped as number,
			total: checks.total as number,
			...(safeHttpsUrl(checks.url) ? { url: checks.url as string } : {}),
			items: (Array.isArray(checks.items) ? checks.items : []).flatMap(
				(entry) => {
					const item = record(entry);
					if (
						item === undefined ||
						typeof item.name !== 'string' ||
						!CHECK_STATES.includes(item.state as string)
					)
						return [];
					return [
						{
							name: item.name,
							state: item.state as WorktreeCheckState,
							...(safeHttpsUrl(item.url) ? { url: item.url as string } : {}),
						},
					];
				},
			),
		};
	return result.pullRequest === undefined && result.checks === undefined
		? undefined
		: result;
}

export function parseWorktreeSignInPrompt(
	value: JsonValue | undefined,
): WorktreeSignInPrompt | undefined {
	const source = record(value);
	if (
		source === undefined ||
		typeof source.extensionId !== 'string' ||
		typeof source.provider !== 'string' ||
		!safeHttpsUrl(source.origin)
	)
		return undefined;
	return {
		extensionId: source.extensionId,
		origin: source.origin as string,
		provider: source.provider,
		...(safeHttpsUrl(source.tokenPageUrl)
			? { tokenPageUrl: source.tokenPageUrl as string }
			: {}),
	};
}

export function safeHttpsUrl(value: unknown): boolean {
	if (typeof value !== 'string' || value.length > 2_048) return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' && url.username === '' && url.password === ''
		);
	} catch {
		return false;
	}
}

function record(
	value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value
		: undefined;
}
