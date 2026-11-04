/** Bounded server-owned projection of the shared bot image build. */
export type BotBuildState = 'running' | 'completed' | 'failed' | 'interrupted';
export type BotBuildStepState =
	| 'pending'
	| 'running'
	| 'completed'
	| 'cached'
	| 'failed';
export interface BotBuildStep {
	readonly id: string;
	readonly description: string;
	readonly state: BotBuildStepState;
	readonly startedAt: number | null;
	readonly endedAt: number | null;
	readonly log: string;
	readonly truncated: boolean;
}
export interface BotBuildProgress {
	readonly id: string;
	readonly engineIdentity: string;
	readonly fingerprint: string;
	readonly revision: number;
	readonly startedAt: number;
	readonly endedAt: number | null;
	readonly state: BotBuildState;
	readonly previousImageAvailable: boolean;
	readonly steps: readonly BotBuildStep[];
	readonly truncated: boolean;
}
export function parseBotBuildProgress(value: unknown): BotBuildProgress | null {
	if (value === null) return null;
	const record = (v: unknown): Record<string, unknown> => {
		if (!v || typeof v !== 'object' || Array.isArray(v))
			throw new TypeError('invalid build progress');
		return v as Record<string, unknown>;
	};
	const text = (v: unknown, n: number, empty = false) =>
		typeof v === 'string' && (empty || v.length > 0) && v.length <= n;
	const time = (v: unknown) =>
		v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
	const r = record(value);
	if (
		!text(r.id, 128) ||
		!text(r.engineIdentity, 512) ||
		!text(r.fingerprint, 128) ||
		!Number.isSafeInteger(r.revision) ||
		Number(r.revision) < 0 ||
		typeof r.startedAt !== 'number' ||
		!time(r.startedAt) ||
		!time(r.endedAt) ||
		!['running', 'completed', 'failed', 'interrupted'].includes(
			String(r.state),
		) ||
		typeof r.previousImageAvailable !== 'boolean' ||
		typeof r.truncated !== 'boolean' ||
		!Array.isArray(r.steps) ||
		r.steps.length > 128
	)
		throw new TypeError('invalid build progress');
	const ids = new Set();
	for (const raw of r.steps) {
		const s = record(raw);
		if (
			!text(s.id, 256) ||
			ids.has(s.id) ||
			!text(s.description, 1024) ||
			!['pending', 'running', 'completed', 'cached', 'failed'].includes(
				String(s.state),
			) ||
			!time(s.startedAt) ||
			!time(s.endedAt) ||
			!text(s.log, 4096, true) ||
			typeof s.truncated !== 'boolean'
		)
			throw new TypeError('invalid build step');
		ids.add(s.id);
	}
	return structuredClone(r) as unknown as BotBuildProgress;
}
