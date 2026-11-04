import { type BotBuildProgress, parseBotBuildProgress } from './botBuild.js';
export const BOT_ENGINE_OPERATIONS = Object.freeze({
	status: 'bots.engine.status',
	check: 'bots.engine.check',
	use: 'bots.engine.use',
	build: 'bots.image.build',
	log: 'bots.image.log',
	progress: 'bots.image.progress',
});
export const BOT_ENGINE_CHANGED = 'bots.engine.changed';
export type BotEngineKind = 'docker' | 'podman';
export type BotEngineReason =
	| 'not-installed'
	| 'not-running'
	| 'permission-denied'
	| 'remote-engine'
	| 'unsupported-engine-mode'
	| 'unsupported-platform'
	| 'engine-changed';
export interface BotEngineStatus {
	readonly build?: BotBuildProgress | null;
	readonly engine: BotEngineKind | null;
	readonly available: boolean;
	readonly reason: BotEngineReason | null;
	readonly detail: string;
	readonly pinned: {
		readonly kind: BotEngineKind;
		readonly address: string;
	} | null;
	readonly candidates: readonly {
		readonly kind: BotEngineKind;
		readonly address: string | null;
		readonly available: boolean;
		readonly reason: BotEngineReason | null;
	}[];
	readonly runningContainers: number;
	readonly botContainers: number;
	readonly image: {
		readonly state: 'missing' | 'building' | 'current' | 'outdated' | 'failed';
		readonly fingerprint: string | null;
		readonly builtAt: number | null;
		readonly error: string | null;
	};
}
export function parseBotEngineStatus(value: unknown): BotEngineStatus {
	const object = (v: unknown): Record<string, unknown> => {
		if (!v || typeof v !== 'object' || Array.isArray(v))
			throw new TypeError('invalid bot engine status');
		return v as Record<string, unknown>;
	};
	const kind = (v: unknown) => v === 'docker' || v === 'podman';
	const reason = (v: unknown) =>
		v === null ||
		[
			'not-installed',
			'not-running',
			'permission-denied',
			'remote-engine',
			'unsupported-engine-mode',
			'unsupported-platform',
			'engine-changed',
		].includes(String(v));
	const r = object(value),
		image = object(r.image);
	if (
		!(r.engine === null || kind(r.engine)) ||
		typeof r.available !== 'boolean' ||
		!reason(r.reason) ||
		typeof r.detail !== 'string' ||
		r.detail.length > 4096 ||
		!Array.isArray(r.candidates) ||
		r.candidates.length > 256 ||
		r.candidates.some((c) => {
			const v = object(c);
			return (
				!kind(v.kind) ||
				!(v.address === null || typeof v.address === 'string') ||
				typeof v.available !== 'boolean' ||
				!reason(v.reason)
			);
		}) ||
		(r.pinned !== null &&
			(!kind(object(r.pinned).kind) ||
				typeof object(r.pinned).address !== 'string')) ||
		![r.runningContainers, r.botContainers].every(
			(v) => Number.isSafeInteger(v) && (v as number) >= 0,
		) ||
		!['missing', 'building', 'current', 'outdated', 'failed'].includes(
			String(image.state),
		) ||
		!(image.fingerprint === null || typeof image.fingerprint === 'string') ||
		!(
			image.builtAt === null ||
			(typeof image.builtAt === 'number' && Number.isFinite(image.builtAt))
		) ||
		!(image.error === null || typeof image.error === 'string')
	)
		throw new TypeError('invalid bot engine status');
	if (r.build !== undefined) parseBotBuildProgress(r.build);
	return structuredClone(r) as unknown as BotEngineStatus;
}
