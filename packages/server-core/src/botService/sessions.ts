import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
	assertJsonValue,
	type BotSession,
	type BotSessionOrigin,
	type BotSessionRecord,
	type BotSessionSnapshot,
	botEnvironmentId,
	type JsonValue,
} from '@terminay/protocol';
import {
	loadCanonicalStateSync,
	preserveCorruptFile,
	readStateFileSync,
	writeFileDurablySync,
} from '../durableFile.js';
import type { BotDeadlineClock } from './idle.js';
import { BotError, object, signIn, text } from './store.js';

export const BOT_TRANSCRIPT_LIMIT = 8 * 1024 * 1024;
export const BOT_RUNNER_LIMIT = 256 * 1024;
export const sessionId = (id: unknown): string => {
	if (typeof id !== 'string' || !/^[a-z0-9]{24}$/.test(id))
		throw new BotError('validation', 'invalid session id');
	return id;
};
const timers: BotDeadlineClock = {
	setTimeout(fn, ms) {
		const t = setTimeout(fn, ms);
		t.unref();
		return t;
	},
	clearTimeout(t) {
		clearTimeout(t as ReturnType<typeof setTimeout>);
	},
};
interface Entry {
	record: BotSessionRecord;
	updates: JsonValue[];
	pending: JsonValue[];
	timer?: unknown;
	dirty: boolean;
}
const states = [
	'queued',
	'running',
	'suspended',
	'needs-you',
	'completed',
	'stopped',
	'timed-out',
	'failed',
	'interrupted',
];
function parseRecord(value: unknown): BotSessionRecord {
	const d = object(value);
	sessionId(d.id);
	botEnvironmentId(d.botId);
	if (
		!states.includes(String(d.state)) ||
		!Number.isSafeInteger(d.segments) ||
		(d.segments as number) < 0 ||
		!Number.isSafeInteger(d.transcriptBytes) ||
		(d.transcriptBytes as number) < 0 ||
		(d.transcriptBytes as number) > BOT_TRANSCRIPT_LIMIT ||
		typeof d.runnerOutput !== 'string' ||
		Buffer.byteLength(d.runnerOutput) > BOT_RUNNER_LIMIT
	)
		throw new Error('invalid session metadata');
	if (
		d.runtimeDriver !== undefined &&
		!['codex-cli', 'claude-code-cli'].includes(String(d.runtimeDriver))
	)
		throw new Error('invalid runtime driver');
	if (d.runtimeVersion !== undefined)
		text(d.runtimeVersion, 128, 'runtime version');
	const snapshot = object(d.snapshot);
	text(snapshot.agentId, 256, 'agent id');
	text(snapshot.instructions, 32 * 1024, 'instructions', true);
	if (snapshot.modelId !== null) text(snapshot.modelId, 256, 'model id');
	signIn(snapshot.signIn);
	if (!['autonomous', 'ask'].includes(String(snapshot.approvalMode)))
		throw new Error('invalid session approval mode');
	if (d.reason !== null) text(d.reason, 8192, 'session reason', true);
	if (![null, 'pending', 'sent', 'skipped'].includes(d.firing as string | null))
		throw new Error('invalid firing state');
	if (d.queuedMessage !== null) {
		const queued = object(d.queuedMessage);
		if (typeof queued.id !== 'string' || !/^[a-z0-9]{24}$/.test(queued.id))
			throw new Error('invalid queued message id');
		text(queued.text, 64 * 1024, 'queued message');
		if (!['queued', 'not-sent'].includes(String(queued.status)))
			throw new Error('invalid queued message');
	}
	if (!Array.isArray(d.permissions) || d.permissions.length > 64)
		throw new Error('invalid permissions');
	for (const permission of [
		...d.permissions,
		...(d.permission ? [d.permission] : []),
	]) {
		const p = object(permission);
		text(p.id, 64, 'permission id');
		if (!Array.isArray(p.options) || p.options.length > 32)
			throw new Error('invalid permission options');
		for (const option of p.options) {
			const o = object(option);
			text(o.optionId, 256, 'permission option');
			text(o.name, 1024, 'permission name');
			text(o.kind, 64, 'permission kind');
		}
	}
	const origin = object(d.origin);
	if (origin.kind !== 'chat') {
		text(origin.triggerId, 256, 'trigger id');
		text(origin.triggerName, 1024, 'trigger name');
		if (
			typeof origin.fireTime !== 'number' ||
			!Number.isFinite(origin.fireTime)
		)
			throw new Error('invalid fire time');
	}
	if (
		!['chat', 'trigger', 'run-now'].includes(String(origin.kind)) ||
		typeof snapshot.agentId !== 'string' ||
		typeof snapshot.context !== 'string' ||
		Buffer.byteLength(snapshot.context) > 256 * 1024 ||
		!Number.isSafeInteger(snapshot.maxTurnMs) ||
		(snapshot.maxTurnMs as number) < 1
	)
		throw new Error('invalid session snapshot');
	for (const k of [
		'open',
		'canLoad',
		'truncated',
		'recoveryMayHaveLostUpdates',
	])
		if (typeof d[k] !== 'boolean') throw new Error('invalid session flag');
	for (const k of ['startedAt', 'durationMs'])
		if (
			typeof d[k] !== 'number' ||
			!Number.isFinite(d[k]) ||
			(d[k] as number) < 0
		)
			throw new Error('invalid session time');
	if (
		d.endedAt !== null &&
		(typeof d.endedAt !== 'number' || !Number.isFinite(d.endedAt))
	)
		throw new Error('invalid session end');
	if (
		d.acpSessionId !== null &&
		(typeof d.acpSessionId !== 'string' || d.acpSessionId.length > 256)
	)
		throw new Error('invalid ACP session');
	if (d.runtime !== undefined) {
		const r = object(d.runtime);
		if (
			!Number.isSafeInteger(r.revision) ||
			Number(r.revision) < 1 ||
			!Number.isSafeInteger(r.order) ||
			Number(r.order) < 0 ||
			typeof r.epoch !== 'string' ||
			!/^([a-f0-9]{32})$/.test(r.epoch) ||
			typeof r.revoked !== 'boolean' ||
			!Array.isArray(r.inbox) ||
			r.inbox.length > 100
		)
			throw new Error('invalid execution runtime');
		if (r.triggerMessageId !== null) sessionId(r.triggerMessageId);
		if (r.supersededBy !== null) sessionId(r.supersededBy);
		const keys = object(r.keys);
		if (Object.keys(keys).length > 256)
			throw new Error('invalid execution retry state');
		for (const raw of r.inbox) {
			const message = object(raw);
			sessionId(message.id);
			sessionId(message.from);
			text(message.text, 2048, 'inbox text');
			if (
				!['accepted', 'consumed'].includes(String(message.status)) ||
				!Number.isFinite(message.createdAt)
			)
				throw new Error('invalid execution inbox');
		}
	}
	assertJsonValue(d);
	return structuredClone(d) as unknown as BotSessionRecord;
}
/** Segments are committed before metadata counts them; no append-in-place writes. */
export class BotSessionStore extends EventEmitter {
	private readonly entries = new Map<string, Entry>();
	constructor(
		readonly root: string,
		private readonly clock = timers,
		private readonly now = Date.now,
	) {
		super();
		mkdirSync(root, { recursive: true, mode: 0o700 });
		for (const dir of readdirSync(root, { withFileTypes: true })) {
			if (!dir.isDirectory() || !/^[a-z0-9]{24}$/.test(dir.name)) continue;
			const path = join(root, dir.name);
			const record = loadCanonicalStateSync(
				join(path, 'session.json'),
				'bot-sessions',
				{ validate: parseRecord },
			);
			if (!record) continue;
			if (record.id !== dir.name)
				throw new BotError(
					'state_unreadable',
					'session directory does not match metadata',
				);
			const updates: JsonValue[] = [];
			for (const name of readdirSync(path)) {
				const match = /^segment-(\d+)\.json$/.exec(name);
				if (match && Number(match[1]) >= record.segments)
					preserveCorruptFile(join(path, name));
			}
			for (let n = 0; n < record.segments; n++) {
				const result = readStateFileSync<JsonValue[]>(
					join(path, `segment-${n}.json`),
					{
						kind: 'canonical',
						validate(value) {
							if (!Array.isArray(value) || value.length > 256)
								throw new Error('invalid segment');
							assertJsonValue(value);
							return value;
						},
					},
				);
				if (result.status !== 'ok' && result.status !== 'restored')
					throw new BotError(
						'state_unreadable',
						'session transcript cannot be read',
					);
				updates.push(...result.value);
			}
			const entry: Entry = {
				record: { ...record, recoveryMayHaveLostUpdates: true },
				updates,
				pending: [],
				dirty: false,
			};
			this.entries.set(record.id, entry);
		}
	}
	create(
		botId: string,
		origin: BotSessionOrigin,
		snapshot: BotSessionSnapshot,
	): BotSessionRecord {
		botEnvironmentId(botId);
		const record: BotSessionRecord = {
			id: randomBytes(12).toString('hex'),
			botId,
			origin: structuredClone(origin),
			snapshot: structuredClone(snapshot),
			state: 'queued',
			startedAt: this.now(),
			endedAt: null,
			durationMs: 0,
			open: true,
			acpSessionId: null,
			canLoad: false,
			segments: 0,
			transcriptBytes: 0,
			truncated: false,
			runnerOutput: '',
			permission: null,
			permissions: [],
			queuedMessage: null,
			firing: origin.kind === 'chat' ? null : 'pending',
			reason: null,
			recoveryMayHaveLostUpdates: false,
		};
		const entry: Entry = { record, updates: [], pending: [], dirty: true };
		this.entries.set(record.id, entry);
		try {
			this.commit(record.id);
		} catch (error) {
			this.entries.delete(record.id);
			throw error;
		}
		return structuredClone(record);
	}
	get(id: string): BotSession {
		const e = this.entry(id);
		return structuredClone({
			...e.record,
			updates: [...e.updates, ...e.pending],
		});
	}
	list(
		botId: string,
		filter: { origin?: string; state?: string; search?: string } = {},
	): BotSessionRecord[] {
		botEnvironmentId(botId);
		return [...this.entries.values()]
			.filter(
				(e) =>
					e.record.botId === botId &&
					(!filter.origin || e.record.origin.kind === filter.origin) &&
					(!filter.state || e.record.state === filter.state) &&
					(!filter.search ||
						JSON.stringify([...e.updates, ...e.pending])
							.toLocaleLowerCase()
							.includes(filter.search.toLocaleLowerCase())),
			)
			.sort((a, b) => b.record.startedAt - a.record.startedAt)
			.map((e) => structuredClone(e.record));
	}
	append(id: string, update: JsonValue): void {
		assertJsonValue(update);
		const e = this.entry(id);
		if (e.record.truncated) return;
		const bytes = Buffer.byteLength(JSON.stringify(update)) + 2;
		if (e.record.transcriptBytes + bytes > BOT_TRANSCRIPT_LIMIT - 128) {
			e.record = { ...e.record, truncated: true };
			this.push(
				e,
				{ kind: 'truncated' },
				Buffer.byteLength(JSON.stringify({ kind: 'truncated' })) + 2,
			);
		} else this.push(e, structuredClone(update), bytes);
		this.emit('changed', { botId: e.record.botId });
		if (e.pending.length >= 256) this.commit(id);
		else this.damp(id, e);
	}
	runner(id: string, chunk: string): void {
		const e = this.entry(id);
		const tail = Buffer.from(e.record.runnerOutput + chunk)
			.subarray(-BOT_RUNNER_LIMIT)
			.toString('utf8')
			.replace(/^\uFFFD+/, '');
		e.record = { ...e.record, runnerOutput: tail };
		e.dirty = true;
		this.damp(id, e);
	}
	patch(
		id: string,
		changes: Partial<
			Omit<
				BotSessionRecord,
				| 'id'
				| 'botId'
				| 'origin'
				| 'snapshot'
				| 'segments'
				| 'transcriptBytes'
				| 'runnerOutput'
			>
		>,
	): void {
		const e = this.entry(id);
		e.record = { ...e.record, ...structuredClone(changes) };
		e.dirty = true;
		this.commit(id);
	}
	commit(id: string): void {
		const e = this.entry(id);
		if (e.timer !== undefined) this.clock.clearTimeout(e.timer);
		e.timer = undefined;
		if (!e.dirty) return;
		const directory = join(this.root, id);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const next = {
			...e.record,
			segments: e.record.segments + (e.pending.length ? 1 : 0),
		};
		// Keep the buffer intact on failure. A retry writes the same segment number.
		if (e.pending.length)
			writeFileDurablySync(
				join(directory, `segment-${e.record.segments}.json`),
				JSON.stringify(e.pending),
			);
		writeFileDurablySync(
			join(directory, 'session.json'),
			JSON.stringify(next),
			{ keepPrevious: true },
		);
		e.record = next;
		e.updates.push(...e.pending);
		e.pending = [];
		e.dirty = false;
		this.emit('changed', { botId: e.record.botId });
	}
	retain(botId: string): void {
		const records = this.list(botId);
		const cutoff = this.now() - 30 * 24 * 60 * 60_000;
		for (const record of records.slice(200))
			if (
				record.startedAt < cutoff &&
				!['running', 'needs-you', 'suspended', 'queued'].includes(record.state)
			)
				this.remove(record.id);
	}
	removeBot(botId: string): void {
		for (const r of this.list(botId)) this.remove(r.id);
	}
	close(): void {
		for (const id of this.entries.keys()) this.commit(id);
	}
	remove(id: string): void {
		const e = this.entry(id);
		if (e.timer !== undefined) this.clock.clearTimeout(e.timer);
		rmSync(join(this.root, id), { recursive: true, force: true });
		this.entries.delete(id);
	}
	private entry(id: string): Entry {
		const e = this.entries.get(sessionId(id));
		if (!e) throw new BotError('not_found', 'session not found');
		return e;
	}
	private push(e: Entry, update: JsonValue, bytes: number): void {
		e.pending.push(update);
		e.record = {
			...e.record,
			transcriptBytes: e.record.transcriptBytes + bytes,
		};
		e.dirty = true;
	}
	private damp(id: string, e: Entry): void {
		if (e.timer === undefined)
			e.timer = this.clock.setTimeout(() => {
				e.timer = undefined;
				try {
					this.commit(id);
				} catch {
					this.emit('storage-error', { botId: e.record.botId });
				}
			}, 2000);
	}
}
