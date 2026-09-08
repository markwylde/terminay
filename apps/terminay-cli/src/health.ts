import { get } from 'node:http';

/**
 * Waiting for the server to say it is ready.
 *
 * The health endpoint is loopback-only by design, so this is an operator-side
 * check running on the same machine, never something a device reaches. An
 * upgrade that cannot get a ready answer within the deadline is the signal to
 * roll back, so the deadline is the whole point of this module.
 */

export const READINESS_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 5_000;

export interface HealthSnapshot {
	readonly status: string;
	readonly ready: boolean;
	readonly phase?: string;
	readonly serverId?: string;
	readonly version?: string;
}

export function probeHealth(
	port: number,
	path: '/readyz' | '/healthz' = '/readyz',
): Promise<HealthSnapshot | undefined> {
	return new Promise((resolve) => {
		const request = get(
			{ host: '127.0.0.1', port, path, timeout: REQUEST_TIMEOUT_MS },
			(response) => {
				let body = '';
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => {
					body += chunk;
					if (body.length > 64 * 1024) response.destroy();
				});
				response.on('end', () => {
					try {
						const parsed = JSON.parse(body) as Record<string, unknown>;
						resolve({
							status: String(parsed.status ?? 'unknown'),
							ready: parsed.ready === true,
							...(typeof parsed.phase === 'string'
								? { phase: parsed.phase }
								: {}),
							...(typeof parsed.serverId === 'string'
								? { serverId: parsed.serverId }
								: {}),
							...(typeof parsed.version === 'string'
								? { version: parsed.version }
								: {}),
						});
					} catch {
						resolve(undefined);
					}
				});
			},
		);
		request.on('timeout', () => request.destroy());
		request.on('error', () => resolve(undefined));
	});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForReady(
	port: number,
	timeoutMs: number = READINESS_TIMEOUT_MS,
	now: () => number = Date.now,
): Promise<HealthSnapshot | undefined> {
	const deadline = now() + timeoutMs;
	for (;;) {
		const snapshot = await probeHealth(port);
		if (snapshot?.ready === true) return snapshot;
		if (now() >= deadline) return undefined;
		await sleep(POLL_INTERVAL_MS);
	}
}
