import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	type BotDraft,
	type BotEnvironmentSetSettings,
	type BotEnvironmentSettings,
	type BotProfile,
	type BotResourceLimits,
	type BotSignIn,
	type BotTrigger,
	type BotTriggerFiring,
	botEnvironmentId,
	botIdleStopMs,
	botResourceLimits,
	DEFAULT_BOT_IDLE_STOP_MS,
	DEFAULT_BOT_RESOURCE_LIMITS,
	parseBotEnvironmentSetSettings,
} from '@terminay/protocol';
import {
	loadCanonicalStateSync,
	writeFileDurablySync,
} from '../durableFile.js';

import { storedFiring, storedTrigger } from './triggerState.js';

export class BotError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code =
			code === 'busy' ? 'resource' : code === 'timeout' ? 'deadline' : code;
	}
}
export class BotImageBuildError extends BotError {
	constructor() {
		super('unavailable', 'bot image build failed');
	}
}
export function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new BotError('validation', 'expected an object');
	return value as Record<string, unknown>;
}
export function text(
	value: unknown,
	limit: number,
	field: string,
	empty = false,
): string {
	if (
		typeof value !== 'string' ||
		(!empty && !value.trim()) ||
		Buffer.byteLength(value) > limit ||
		value.includes('\0')
	)
		throw new BotError('validation', `invalid ${field}`);
	return value;
}
export function memoryPath(value: unknown): string {
	const path = text(value, 255, 'memory path');
	if (
		!/^[\p{L}\p{N}_-][\p{L}\p{N}_. -]*\.md$/u.test(path) ||
		path.includes('..')
	)
		throw new BotError('validation', 'memory must be a Markdown filename');
	return path;
}
function initialOf(name: string): string {
	const first = [
		...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
			name.trim(),
		),
	][0]?.segment;
	return first ? first.toUpperCase() : '?';
}
export function signIn(value: unknown): BotSignIn {
	const data = object(value);
	if (data.kind === 'none' || data.kind === 'device')
		return { kind: data.kind };
	if (
		data.kind === 'token' &&
		typeof data.environmentVariable === 'string' &&
		/^[A-Z][A-Z0-9_]{0,127}$/.test(data.environmentVariable)
	)
		return { kind: 'token', environmentVariable: data.environmentVariable };
	throw new BotError('validation', 'invalid sign-in setting');
}
function profile(value: unknown): BotProfile {
	const d = object(value);
	const name = text(d.name, 160, 'name').trim();
	if ([...name].length > 40)
		throw new BotError('validation', 'name exceeds 40 characters');
	const description = text(d.description, 800, 'description', true);
	if ([...description].length > 200)
		throw new BotError('validation', 'description exceeds 200 characters');
	// Pre-release builds defaulted every bot to a robot; it shows the initial.
	const avatar = d.avatar === '🤖' ? initialOf(name) : text(d.avatar, 64, 'avatar');
	if (
		[
			...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
				avatar,
			),
		].length !== 1
	)
		throw new BotError('validation', 'avatar must be one character or emoji');
	if (d.approvalMode !== 'autonomous' && d.approvalMode !== 'ask')
		throw new BotError('validation', 'invalid approval mode');
	if (
		!Number.isSafeInteger(d.maxTurnMs) ||
		(d.maxTurnMs as number) < 1 ||
		(d.maxTurnMs as number) > 2_147_483_647
	)
		throw new BotError('validation', 'invalid turn duration');
	if (!Array.isArray(d.pinnedMemories) || d.pinnedMemories.length > 10000)
		throw new BotError('validation', 'invalid memory pins');
	const pins = d.pinnedMemories.map(memoryPath);
	if (new Set(pins).size !== pins.length)
		throw new BotError('validation', 'duplicate memory pins');
	for (const key of ['createdAt', 'updatedAt'])
		if (
			typeof d[key] !== 'number' ||
			!Number.isFinite(d[key]) ||
			(d[key] as number) < 0
		)
			throw new BotError('validation', 'invalid timestamp');
	return {
		id: botEnvironmentId(d.id),
		name,
		description,
		avatar,
		colour: text(d.colour, 64, 'colour'),
		instructions: text(d.instructions, 32 * 1024, 'instructions', true),
		agentId: text(d.agentId, 256, 'agent id'),
		modelId: d.modelId === null ? null : text(d.modelId, 256, 'model id'),
		signIn: signIn(d.signIn),
		approvalMode: d.approvalMode,
		maxTurnMs: d.maxTurnMs as number,
		pinnedMemories: pins,
		createdAt: d.createdAt as number,
		updatedAt: d.updatedAt as number,
	};
}
type StoredEnvironmentSettings = Pick<
	BotEnvironmentSettings,
	'shareEngineSocket' | 'idleStopMs' | 'limits' | 'revision'
>;
function environmentSettings(value: unknown): StoredEnvironmentSettings {
	const d = object(value);
	if (
		typeof d.shareEngineSocket !== 'boolean' ||
		!Number.isSafeInteger(d.revision) ||
		(d.revision as number) < 0
	)
		throw new TypeError('invalid stored bot environment settings');
	return {
		shareEngineSocket: d.shareEngineSocket,
		idleStopMs: botIdleStopMs(d.idleStopMs),
		limits: botResourceLimits(object(d.limits) as unknown as BotResourceLimits),
		revision: d.revision as number,
	};
}
interface State {
	version: 1;
	revision: number;
	bots: BotProfile[];
	triggers: BotTrigger[];
	firings: BotTriggerFiring[];
	environments: Record<string, StoredEnvironmentSettings>;
}
function state(value: unknown): State {
	const data = object(value);
	if (
		data.version !== 1 ||
		!Number.isSafeInteger(data.revision) ||
		(data.revision as number) < 0 ||
		!Array.isArray(data.bots)
	)
		throw new Error('invalid bot state');
	const bots = data.bots.map(profile);
	const environments = Object.fromEntries(
		Object.entries(
			data.environments === undefined ? {} : object(data.environments),
		).map(([id, settings]) => {
			if (!bots.some((b) => b.id === id))
				throw new Error('invalid environment owner');
			return [id, environmentSettings(settings)];
		}),
	);
	if (
		new Set(bots.map((b) => b.id)).size !== bots.length ||
		new Set(bots.map((b) => b.name)).size !== bots.length
	)
		throw new Error('duplicate bot');
	const triggers =
		data.triggers === undefined
			? []
			: Array.isArray(data.triggers)
				? data.triggers.map(storedTrigger)
				: (() => {
						throw new Error('invalid triggers');
					})();
	const firings =
		data.firings === undefined
			? []
			: Array.isArray(data.firings)
				? data.firings.map(storedFiring)
				: (() => {
						throw new Error('invalid firings');
					})();
	if (
		new Set(triggers.map((t) => t.id)).size !== triggers.length ||
		new Set(firings.map((f) => f.id)).size !== firings.length ||
		triggers.some((t) => !bots.some((b) => b.id === t.botId)) ||
		firings.some(
			(f) => !triggers.some((t) => t.id === f.triggerId && t.botId === f.botId),
		) ||
		bots.some(
			(b) =>
				triggers.filter((t) => t.botId === b.id).length > 50 ||
				firings.filter((f) => f.botId === b.id).length > 200,
		)
	)
		throw new Error('invalid bot trigger ownership or limits');
	return {
		version: 1,
		revision: data.revision as number,
		bots,
		triggers,
		firings,
		environments,
	};
}
/** Canonical profiles. Saving never touches a container engine. */
export class BotStore extends EventEmitter {
	private current: State;
	constructor(
		private readonly path: string,
		private readonly now = Date.now,
	) {
		super();
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		this.current = loadCanonicalStateSync(path, 'bots', {
			validate: state,
		}) ?? {
			version: 1,
			revision: 0,
			bots: [],
			triggers: [],
			firings: [],
			environments: {},
		};
	}
	get revision(): number {
		return this.current.revision;
	}
	list(): BotProfile[] {
		return structuredClone(this.current.bots);
	}
	get(id: string): BotProfile {
		const found = this.current.bots.find((b) => b.id === botEnvironmentId(id));
		if (!found) throw new BotError('not_found', 'bot not found');
		return structuredClone(found);
	}
	environmentSettings(id: string): StoredEnvironmentSettings {
		this.get(id);
		return structuredClone(
			this.current.environments[id] ?? {
				shareEngineSocket: false,
				idleStopMs: DEFAULT_BOT_IDLE_STOP_MS,
				limits: DEFAULT_BOT_RESOURCE_LIMITS,
				revision: 0,
			},
		);
	}
	setEnvironmentSettings(
		input: BotEnvironmentSetSettings,
	): StoredEnvironmentSettings {
		const patch = parseBotEnvironmentSetSettings(input);
		const previous = this.environmentSettings(patch.botId);
		if (
			patch.expectedRevision !== undefined &&
			patch.expectedRevision !== previous.revision
		)
			throw new BotError('conflict', 'bot environment revision changed');
		const next = {
			shareEngineSocket: patch.shareEngineSocket ?? previous.shareEngineSocket,
			idleStopMs:
				patch.idleStopMs === undefined ? previous.idleStopMs : patch.idleStopMs,
			limits: patch.limits ?? previous.limits,
			revision: previous.revision + 1,
		};
		this.commit(this.current.bots, patch.botId, {
			environments: { ...this.current.environments, [patch.botId]: next },
		});
		return structuredClone(next);
	}
	save(draft: BotDraft, expectedRevision?: number): BotProfile {
		this.checkRevision(expectedRevision);
		const previous = draft.id ? this.get(draft.id) : undefined;
		const bot = profile({
			id: randomBytes(6).toString('hex'),
			// A new bot shows its name's initial until a picture is chosen.
			avatar: initialOf(String(draft.name ?? '')),
			colour: 'blue',
			description: '',
			instructions: '',
			modelId: null,
			signIn: { kind: 'none' },
			approvalMode: 'autonomous',
			maxTurnMs: 30 * 60_000,
			pinnedMemories: [],
			...previous,
			...draft,
			createdAt: previous?.createdAt ?? this.now(),
			updatedAt: this.now(),
			...(previous && previous.agentId !== draft.agentId
				? { modelId: null }
				: {}),
		});
		if (this.current.bots.some((b) => b.id !== bot.id && b.name === bot.name))
			throw new BotError('conflict', 'a bot with that name already exists');
		this.commit(
			[...this.current.bots.filter((b) => b.id !== bot.id), bot],
			bot.id,
		);
		return structuredClone(bot);
	}
	remove(id: string, expectedRevision?: number): void {
		this.checkRevision(expectedRevision);
		this.get(id);
		this.commit(
			this.current.bots.filter((b) => b.id !== id),
			id,
		);
	}
	triggers(botId?: string): BotTrigger[] {
		return structuredClone(
			this.current.triggers.filter(
				(t) => botId === undefined || t.botId === botId,
			),
		);
	}
	trigger(botId: string, id: string): BotTrigger {
		this.get(botId);
		const found = this.current.triggers.find(
			(t) => t.botId === botId && t.id === id,
		);
		if (!found) throw new BotError('not_found', 'trigger not found');
		return structuredClone(found);
	}
	putTrigger(trigger: BotTrigger, expectedRevision?: number): void {
		this.checkRevision(expectedRevision);
		this.get(trigger.botId);
		const safe = storedTrigger(trigger);
		if (
			!this.current.triggers.some((t) => t.id === safe.id) &&
			this.triggers(safe.botId).length >= 50
		)
			throw new BotError('resource', 'at most 50 triggers per bot');
		this.commit(this.current.bots, safe.botId, {
			triggers: [
				...this.current.triggers.filter((t) => t.id !== safe.id),
				safe,
			],
		});
	}
	removeTrigger(botId: string, id: string, expectedRevision?: number): void {
		this.checkRevision(expectedRevision);
		this.trigger(botId, id);
		this.commit(this.current.bots, botId, {
			triggers: this.current.triggers.filter((t) => t.id !== id),
			firings: this.current.firings.filter((f) => f.triggerId !== id),
		});
	}
	firings(botId: string): BotTriggerFiring[] {
		return structuredClone(
			this.current.firings.filter((f) => f.botId === botId),
		);
	}
	putFiring(firing: BotTriggerFiring): void {
		this.trigger(firing.botId, firing.triggerId);
		const safe = storedFiring(firing);
		const own = [
			...this.current.firings.filter(
				(f) => f.botId === safe.botId && f.id !== safe.id,
			),
			safe,
		]
			.sort(
				(a, b) =>
					Number(['pending', 'running'].includes(b.outcome)) -
						Number(['pending', 'running'].includes(a.outcome)) ||
					b.firedAt - a.firedAt,
			)
			.slice(0, 200);
		this.commit(this.current.bots, safe.botId, {
			firings: [
				...this.current.firings.filter((f) => f.botId !== safe.botId),
				...own,
			],
		});
	}
	private checkRevision(expected?: number): void {
		if (expected !== undefined && expected !== this.revision)
			throw new BotError('conflict', 'bot revision changed');
	}
	private commit(
		bots: BotProfile[],
		botId: string,
		patch: Partial<Pick<State, 'triggers' | 'firings' | 'environments'>> = {},
	): void {
		const next: State = {
			...this.current,
			...patch,
			version: 1,
			revision: this.revision + 1,
			bots,
		};
		next.environments = Object.fromEntries(
			Object.entries(next.environments).filter(([id]) =>
				bots.some((b) => b.id === id),
			),
		);
		next.triggers = next.triggers.filter((t) =>
			bots.some((b) => b.id === t.botId),
		);
		next.firings = next.firings.filter((f) =>
			next.triggers.some((t) => t.id === f.triggerId),
		);
		writeFileDurablySync(this.path, JSON.stringify(next), {
			keepPrevious: true,
		});
		this.current = next;
		this.emit('changed', { botId, revision: next.revision });
	}
}
