import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
	BotObservationSource,
	BotSourceHealth,
	BotTrigger,
} from '@terminay/protocol';
import { botEnvironmentId } from '@terminay/protocol';
import {
	loadCanonicalStateSync,
	writeFileDurablySync,
} from '../durableFile.js';
import { pointer } from './sourceValidation.js';
import { BotError, object } from './store.js';
export interface Observation {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	body?: string;
	matched?: boolean;
	notModified?: boolean;
	data?: unknown;
	eventId?: string;
	filtered?: boolean;
	snapshot?: Record<string, string>;
	changes?: string[];
	omitted?: number;
	status?: 'waiting' | 'watching' | 'connected';
}
export interface PendingSourceEvent {
	id: string;
	sessionId: string;
	triggerId: string;
	generation: string;
	triggerName: string;
	prompt: string;
	payload: unknown;
	observedAt: number;
	dueAt: number;
	origin: 'trigger' | 'run-now';
	recovery?: { after: number; through: number };
}
export interface SourceCheckpoint {
	generation: string;
	initialized: boolean;
	baseline?: string;
	matching?: boolean;
	ids: string[];
	cursor?: string;
	snapshot?: Record<string, string>;
	sequence: number;
	health: BotSourceHealth;
	resumeBaseline?: boolean;
	recovery?: { after: number; through: number };
	/** A condition-check failure episode is open until a check succeeds. */
	failureEpisode?: boolean;
}
interface State {
	version: 1;
	checkpoints: Record<string, SourceCheckpoint>;
	pending: PendingSourceEvent[];
}
export function initialCheckpoint(generation: string): SourceCheckpoint {
	return {
		generation,
		initialized: false,
		ids: [],
		sequence: 0,
		health: {
			state: 'waiting',
			lastAttempt: null,
			lastSuccess: null,
			lastFired: null,
			nextRetry: null,
			error: null,
			gap: null,
			remembered: 0,
		},
	};
}
export function selectPointer(value: unknown, path: string): unknown {
	pointer(path);
	let result = value;
	if (!path) return result;
	for (const key of path
		.slice(1)
		.split('/')
		.map((v) => v.replace(/~1/g, '/').replace(/~0/g, '~'))) {
		if (
			result === null ||
			typeof result !== 'object' ||
			!Object.hasOwn(result, key)
		)
			throw new BotError('validation', `Missing JSON Pointer ${path}`);
		result = (result as Record<string, unknown>)[key];
	}
	return result;
}
function canonical(v: unknown): string {
	if (v === null || typeof v !== 'object') return JSON.stringify(v);
	if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
	return `{${Object.keys(v)
		.sort()
		.map(
			(k) =>
				`${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`,
		)
		.join(',')}}`;
}
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export function parseObservation(value: unknown): Observation {
	const d = object(value);
	const allowed = [
		'stdout',
		'stderr',
		'exitCode',
		'body',
		'matched',
		'notModified',
		'data',
		'eventId',
		'filtered',
		'snapshot',
		'changes',
		'omitted',
		'status',
	];
	if (Object.keys(d).some((k) => !allowed.includes(k)))
		throw new BotError('validation', 'Unknown source result field');
	for (const k of ['stdout', 'stderr', 'body', 'eventId'])
		if (
			d[k] !== undefined &&
			(typeof d[k] !== 'string' ||
				Buffer.byteLength(d[k] as string) >
					(k === 'eventId' ? 4096 : 1024 * 1024))
		)
			throw new BotError('resource', 'Invalid or oversized source result');
	for (const k of ['matched', 'notModified', 'filtered'])
		if (d[k] !== undefined && typeof d[k] !== 'boolean')
			throw new BotError('validation', 'Invalid source result flag');
	if (
		d.exitCode !== undefined &&
		(!Number.isSafeInteger(d.exitCode) ||
			(d.exitCode as number) < -255 ||
			(d.exitCode as number) > 255)
	)
		throw new BotError('validation', 'Invalid exit code');
	if (
		d.status !== undefined &&
		!['waiting', 'watching', 'connected'].includes(String(d.status))
	)
		throw new BotError('validation', 'Invalid source status');
	if (d.snapshot !== undefined) {
		const snapshot = object(d.snapshot);
		if (
			Object.keys(snapshot).length > 100000 ||
			Buffer.byteLength(JSON.stringify(snapshot)) > 16 * 1024 * 1024 ||
			Object.entries(snapshot).some(
				([k, v]) => k.length > 4096 || typeof v !== 'string' || v.length > 512,
			)
		)
			throw new BotError('resource', 'Invalid file snapshot');
	}
	if (
		d.changes !== undefined &&
		(!Array.isArray(d.changes) ||
			d.changes.length > 1000 ||
			d.changes.some((v) => typeof v !== 'string' || v.length > 4096))
	)
		throw new BotError('resource', 'Invalid file changes');
	return d as Observation;
}
/** Pure all-or-nothing matching. Never executes a pattern on the server thread. */
export function evaluateObservation(
	source: BotObservationSource,
	previous: SourceCheckpoint,
	observation: Observation,
): { checkpoint: SourceCheckpoint; events: unknown[] } {
	observation = parseObservation(observation);
	const next = structuredClone(previous);
	const events: unknown[] = [];
	if (observation.notModified) return { checkpoint: next, events };
	if (source.kind === 'sse') {
		if (observation.eventId !== undefined) next.cursor = observation.eventId;
		if (!observation.filtered) {
			const id = observation.eventId;
			if (!id || !next.ids.includes(id)) {
				events.push(observation.data ?? '');
				if (id) next.ids.push(id);
			}
		}
	} else if (source.kind === 'files') {
		const snapshot = observation.snapshot ?? next.snapshot ?? {};
		const changes = observation.changes ?? [];
		if (next.initialized) {
			if (changes.length)
				events.push({ changes, omitted: observation.omitted ?? 0 });
			else if (observation.snapshot && next.snapshot) {
				const different = [
					...new Set([...Object.keys(next.snapshot), ...Object.keys(snapshot)]),
				].filter((p) => snapshot[p] !== next.snapshot![p]);
				if (different.length)
					events.push({
						changes: different.slice(0, 1000),
						omitted: Math.max(0, different.length - 1000),
						recovery: 'net changes only',
					});
			}
		}
		next.snapshot = snapshot;
	} else {
		const match = source.match ?? { kind: 'changed' };
		if (
			source.kind === 'command' &&
			observation.exitCode !== 0 &&
			match.kind !== 'exit'
		)
			throw new BotError(
				'unavailable',
				`Command exited ${observation.exitCode}: ${(observation.stderr ?? '').slice(0, 512)}`,
			);
		const raw =
			source.kind === 'command'
				? (observation.stdout ?? '')
				: (observation.body ?? '');
		if (Buffer.byteLength(raw) > 1024 * 1024)
			throw new BotError('resource', 'Source output exceeds 1 MiB');
		let value: unknown = raw;
		if (source.kind === 'http' && source.select)
			value = selectPointer(JSON.parse(raw), source.select);
		if (match.kind === 'items') {
			const parsed = typeof value === 'string' ? JSON.parse(value) : value;
			const items = selectPointer(parsed, match.items);
			if (!Array.isArray(items))
				throw new BotError('validation', 'Items pointer must select an array');
			const ids = new Set<string>();
			for (const item of items) {
				const v = selectPointer(item, match.identity);
				if (
					!(
						(typeof v === 'string' && v.length > 0) ||
						(typeof v === 'number' && Number.isFinite(v))
					)
				)
					throw new BotError(
						'validation',
						'Item identity must be a nonempty string or finite number',
					);
				const id = canonical(v);
				if (Buffer.byteLength(id) > 4096 || ids.has(id))
					throw new BotError(
						'validation',
						'Duplicate or oversized item identity',
					);
				ids.add(id);
				if (!next.ids.includes(id)) {
					next.ids.push(id);
					if (next.initialized || match.initial !== 'baseline')
						events.push(item);
				}
			}
		} else if (match.kind === 'changed') {
			const current = hash(
				source.kind === 'http' && source.select ? canonical(value) : raw,
			);
			if (next.initialized && next.baseline !== current) events.push(value);
			next.baseline = current;
		} else {
			const textValue = typeof value === 'string' ? value : canonical(value);
			const matching =
				match.kind === 'exit'
					? observation.exitCode === match.code
					: match.kind === 'contains'
						? textValue.includes(match.text)
						: observation.matched === true;
			if (matching && (match.repeat || !next.matching))
				events.push({ stdout: raw, exitCode: observation.exitCode ?? 0 });
			next.matching = matching;
		}
	}
	next.initialized = true;
	if (next.resumeBaseline) {
		events.length = 0;
		delete next.resumeBaseline;
	}
	if (next.ids.length > 100000)
		throw new BotError(
			'resource',
			'Remembered identity limit reached; reset memory explicitly',
		);
	for (const event of events)
		if (Buffer.byteLength(JSON.stringify(event)) > 32768)
			throw new BotError('resource', 'Selected event exceeds 32 KiB');
	return { checkpoint: next, events };
}
/** Checkpoint and accepted batch share one canonical durable replacement. */
export class BotSourceStore {
	private states = new Map<string, State>();
	constructor(private root: string) {
		mkdirSync(root, { recursive: true, mode: 0o700 });
	}
	private get(botId: string): State {
		botEnvironmentId(botId);
		let s = this.states.get(botId);
		if (s) return s;
		let version: unknown;
		try {
			version = JSON.parse(
				readFileSync(join(this.root, `${botId}.json`), 'utf8'),
			).version;
		} catch {
			/* Canonical recovery handles corrupt data. */
		}
		if (typeof version === 'number' && version !== 1)
			throw new BotError('unavailable', 'Unsupported source state version');
		s = loadCanonicalStateSync(join(this.root, `${botId}.json`), 'bots', {
			validate: (value) => {
				const d = object(value);
				if (
					d.version !== 1 ||
					!Array.isArray(d.pending) ||
					d.pending.length > 1000
				)
					throw new Error('Invalid source state');
				const c = object(d.checkpoints);
				if (Object.keys(c).length > 50)
					throw new Error('Too many source checkpoints');
				for (const [id, v] of Object.entries(c)) {
					if (!/^[a-z0-9]{24}$/.test(id)) throw new Error('Invalid source ID');
					const cp = object(v);
					if (
						typeof cp.generation !== 'string' ||
						!/^[a-z0-9]{24}$/.test(String(cp.generation)) ||
						typeof cp.initialized !== 'boolean' ||
						!Array.isArray(cp.ids) ||
						cp.ids.length > 100000 ||
						cp.ids.some((x) => typeof x !== 'string') ||
						!Number.isSafeInteger(cp.sequence)
					)
						throw new Error('Invalid source checkpoint');
					object(cp.health);
					if (
						cp.failureEpisode !== undefined &&
						typeof cp.failureEpisode !== 'boolean'
					)
						throw new Error('Invalid failure episode');
					if (
						cp.cursor !== undefined &&
						(typeof cp.cursor !== 'string' ||
							Buffer.byteLength(cp.cursor) > 4096)
					)
						throw new Error('Invalid source cursor');
					if (cp.snapshot !== undefined) {
						const snapshot = object(cp.snapshot);
						if (
							Object.keys(snapshot).length > 100000 ||
							Buffer.byteLength(JSON.stringify(snapshot)) > 16 * 1024 * 1024 ||
							Object.values(snapshot).some((v) => typeof v !== 'string')
						)
							throw new Error('Invalid file snapshot');
					}
				}
				for (const event of d.pending) {
					const e = object(event);
					for (const k of ['id', 'sessionId', 'triggerId', 'generation'])
						if (
							typeof e[k] !== 'string' ||
							!/^[a-z0-9]{24}$/.test(e[k] as string)
						)
							throw new Error('Invalid pending event');
					if (
						typeof e.prompt !== 'string' ||
						!Number.isSafeInteger(e.dueAt) ||
						!Number.isSafeInteger(e.observedAt)
					)
						throw new Error('Invalid pending context');
				}
				return d as unknown as State;
			},
		}) ?? { version: 1, checkpoints: {}, pending: [] };
		this.states.set(botId, s);
		return s;
	}
	private save(botId: string, next: State): void {
		if (
			next.pending.length > 1000 ||
			Buffer.byteLength(JSON.stringify(next.pending)) > 16 * 1024 * 1024
		)
			throw new BotError('resource', 'Pending source event limit reached');
		if (
			Buffer.byteLength(
				JSON.stringify(Object.values(next.checkpoints).map((c) => c.ids)),
			) >
			16 * 1024 * 1024
		)
			throw new BotError('resource', 'Remembered identity limit reached');
		writeFileDurablySync(
			join(this.root, `${botId}.json`),
			JSON.stringify(next),
			{ keepPrevious: true },
		);
		this.states.set(botId, next);
	}
	checkpoint(t: BotTrigger): SourceCheckpoint {
		const cp = this.get(t.botId).checkpoints[t.id];
		return cp && cp.generation === (t.generation ?? t.id)
			? structuredClone(cp)
			: initialCheckpoint(t.generation ?? t.id);
	}
	commit(
		t: BotTrigger,
		cp: SourceCheckpoint,
		events: unknown[],
		at: number,
		due: number,
		origin: 'trigger' | 'run-now' = 'trigger',
		recovery?: { after: number; through: number },
	): PendingSourceEvent[] {
		const s = structuredClone(this.get(t.botId));
		const pending = events.map((payload) => {
			const id = randomBytes(12).toString('hex');
			cp.sequence++;
			return {
				id,
				sessionId: hash(`${t.id}:${cp.generation}:${cp.sequence}`).slice(0, 24),
				triggerId: t.id,
				generation: cp.generation,
				triggerName: t.name,
				prompt: t.prompt,
				payload,
				observedAt: at,
				dueAt: due,
				origin,
				...(recovery ? { recovery } : {}),
			};
		});
		cp.health = {
			...cp.health,
			lastSuccess: at,
			error: null,
			cause: null,
			remembered: cp.ids.length,
			...(pending.length ? { lastFired: at } : {}),
		};
		cp.failureEpisode = false;
		s.checkpoints[t.id] = structuredClone(cp);
		s.pending.push(...pending);
		this.save(t.botId, s);
		return pending;
	}
	update(t: BotTrigger, fn: (cp: SourceCheckpoint) => void): void {
		const cp = this.checkpoint(t);
		fn(cp);
		const s = structuredClone(this.get(t.botId));
		s.checkpoints[t.id] = cp;
		this.save(t.botId, s);
	}
	pending(botId: string): PendingSourceEvent[] {
		return structuredClone(this.get(botId).pending);
	}
	delivered(botId: string, id: string): void {
		const s = structuredClone(this.get(botId));
		s.pending = s.pending.filter((e) => e.id !== id);
		this.save(botId, s);
	}
	reset(t: BotTrigger, resume = false): void {
		this.update(t, (cp) =>
			Object.assign(cp, initialCheckpoint(t.generation ?? t.id), {
				sequence: cp.sequence,
				resumeBaseline: resume,
			}),
		);
	}
	removeBot(botId: string): void {
		botEnvironmentId(botId);
		this.states.delete(botId);
		for (const suffix of ['.json', '.json.previous'])
			rmSync(join(this.root, `${botId}${suffix}`), { force: true });
	}
	cancel(t: BotTrigger, forget = false): void {
		const s = structuredClone(this.get(t.botId));
		s.pending = s.pending.filter((e) => e.triggerId !== t.id);
		if (forget) delete s.checkpoints[t.id];
		this.save(t.botId, s);
	}
}
