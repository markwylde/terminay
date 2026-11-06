import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
	mkdirSync,
	rmSync,
	readFileSync,
	readdirSync,
	statSync,
	existsSync,
} from 'node:fs';
import { join } from 'node:path';
import {
	botEnvironmentId,
	type BotMessage,
	type BotMessageSummary,
	type BotMessagePage,
	type BotMessageDetail,
	type BotRuntimeEvent,
	type BotRuntimeEventPage,
	type BotMessageAttachment,
} from '@terminay/protocol';
import {
	loadCanonicalStateSync,
	writeFileDurablySync,
} from '../durableFile.js';
import { BotError, text, object } from './store.js';
import { botImageMime, BOT_IMAGE_BYTES } from './images.js';

/** How long an uploaded image waits for the post that references it. */
export const BOT_UPLOAD_STAGING_MS = 15 * 60 * 1000;
interface Staged {
	readonly asset: BotMessageAttachment;
	readonly expiresAt: number;
}
const PAGE_BYTES = 8192,
	STATE_BYTES = 16 * 1024 * 1024,
	MAX_EVENTS = 2000;
interface Row extends BotMessage {
	change: number;
	deleted: boolean;
}
interface State {
	version: 1;
	secret: string;
	epoch: string;
	sequence: number;
	rows: Row[];
	events: BotRuntimeEvent[];
	keys: Record<string, { hash: string; id: string }>;
	imported: boolean;
}
interface Cursor {
	botId: string;
	epoch: string;
	kind: string;
	filter: string;
	through: number;
	position: number;
	revision?: number;
	afterId?: string;
}
export interface MessagePageOptions {
	cursor?: string;
	limit?: number;
	search?: string;
}
function utf8(value: string, limit: number): string {
	const bytes = Buffer.from(value);
	let end = Math.max(0, Math.min(bytes.length, Math.floor(limit)));
	while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80)
		end--;
	return bytes.subarray(0, end).toString('utf8');
}
function id(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{24}$/.test(value))
		throw new BotError('validation', 'Invalid message or attachment ID');
	return value;
}
function digest(value: string): string {
	return createHmac('sha256', 'terminay-message-content')
		.update(value)
		.digest('hex');
}
function parse(value: unknown): State {
	const d = object(value);
	if (
		d.version !== 1 ||
		typeof d.secret !== 'string' ||
		!Array.isArray(d.rows) ||
		!Array.isArray(d.events) ||
		typeof d.epoch !== 'string' ||
		!Number.isSafeInteger(d.sequence)
	)
		throw new BotError('state_unreadable', 'Invalid bot communication state');
	for (const raw of d.rows) {
		const r = object(raw);
		id(r.id);
		botEnvironmentId(r.botId);
		text(r.text, 65536, 'stored message', true);
		if (
			!Number.isSafeInteger(r.revision) ||
			!Number.isSafeInteger(r.sequence) ||
			!Number.isSafeInteger(r.change) ||
			!Array.isArray(r.attachments)
		)
			throw new Error('Invalid stored message');
	}
	return d as unknown as State;
}
/** Low-frequency communication state; provider token updates never write here.
 * Atomic snapshots are bounded to 16 MiB, including revision history. */
export class BotMessageStore extends EventEmitter {
	private states = new Map<string, State>();
	/** In memory: a restart drops staging, and load prunes the orphaned blobs. */
	private staging = new Map<string, Map<string, Staged>>();
	constructor(
		private readonly root: string,
		private readonly now = Date.now,
	) {
		super();
		mkdirSync(root, { recursive: true, mode: 0o700 });
	}
	private directory(botId: string): string {
		return join(this.root, botEnvironmentId(botId));
	}
	private state(botId: string): State {
		botEnvironmentId(botId);
		let s = this.states.get(botId);
		if (s) return s;
		const directory = this.directory(botId);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const loaded = loadCanonicalStateSync(
			join(directory, 'messages.json'),
			'bot-messages',
			{ validate: parse },
		);
		s = loaded ?? {
			version: 1,
			secret: randomBytes(32).toString('hex'),
			epoch: randomBytes(16).toString('hex'),
			sequence: 0,
			rows: [],
			events: [],
			keys: {},
			imported: false,
		};
		if (!loaded)
			writeFileDurablySync(
				join(directory, 'messages.json'),
				JSON.stringify(s),
				{ mode: 0o600 },
			);
		this.states.set(botId, s);
		if (loaded) this.pruneAttachments(botId);
		return s;
	}
	private save(botId: string, next: State): void {
		const bytes = JSON.stringify(next);
		if (Buffer.byteLength(bytes) > STATE_BYTES)
			throw new BotError(
				'resource',
				'Bot communication storage is full; clear history before adding more',
			);
		writeFileDurablySync(join(this.directory(botId), 'messages.json'), bytes, {
			keepPrevious: true,
			mode: 0o600,
		});
		this.states.set(botId, next);
		this.emit('changed', botId);
	}
	private change(
		s: State,
		type: string,
		subjectId: string,
		revision: number,
	): number {
		const sequence = ++s.sequence;
		s.events.push({ sequence, type, subjectId, revision, at: this.now() });
		if (s.events.length > MAX_EVENTS)
			s.events.splice(0, s.events.length - MAX_EVENTS);
		return sequence;
	}
	private latest(s: State, through = s.sequence): Row[] {
		const latest = new Map<string, Row>();
		for (const row of s.rows)
			if (row.change <= through) latest.set(row.id, row);
		return [...latest.values()]
			.filter((r) => !r.deleted)
			.sort((a, b) => b.sequence - a.sequence);
	}
	private cursor(s: State, c: Cursor): string {
		const body = Buffer.from(JSON.stringify(c)).toString('base64url');
		return (
			body + '.' + createHmac('sha256', s.secret).update(body).digest('hex')
		);
	}
	private decode(
		botId: string,
		raw: string,
		kind: string,
		filter = '',
	): Cursor {
		const s = this.state(botId);
		if (typeof raw !== 'string' || raw.length > 4096)
			throw new BotError('validation', 'Invalid cursor');
		const [body, mac, ...extra] = raw.split('.');
		const expected = createHmac('sha256', s.secret)
			.update(body ?? '')
			.digest('hex');
		const a = Buffer.from(mac ?? ''),
			b = Buffer.from(expected);
		if (extra.length || a.length !== b.length || !timingSafeEqual(a, b))
			throw new BotError('validation', 'Invalid cursor');
		let c: Cursor;
		try {
			c = JSON.parse(Buffer.from(body!, 'base64url').toString());
		} catch {
			throw new BotError('validation', 'Invalid cursor');
		}
		if (
			c.botId !== botId ||
			c.epoch !== s.epoch ||
			c.kind !== kind ||
			c.filter !== filter ||
			!Number.isSafeInteger(c.through) ||
			!Number.isSafeInteger(c.position) ||
			c.position < 0 ||
			c.through > s.sequence
		)
			throw new BotError(
				'conflict',
				'Cursor expired or belongs to another query; reload history',
			);
		return c;
	}
	sequence(botId: string): number {
		return this.state(botId).sequence;
	}
	epoch(botId: string): string {
		return this.state(botId).epoch;
	}
	eventCursor(botId: string, after = this.state(botId).sequence): string {
		const s = this.state(botId);
		return this.cursor(s, {
			botId,
			epoch: s.epoch,
			kind: 'events',
			filter: '',
			through: s.sequence,
			position: after,
		});
	}
	count(botId: string): number {
		return this.latest(this.state(botId)).length;
	}
	post(
		botId: string,
		author: 'user' | 'bot',
		body: string,
		executionId: string | null,
		key: string,
		attachments: readonly BotMessageAttachment[] = [],
		uploads: readonly string[] = [],
	): BotMessage {
		text(body, 65536, 'message', true);
		if (!body.trim() && !attachments.length && !uploads.length)
			throw new BotError('validation', 'Message cannot be empty');
		text(key, 256, 'idempotency key');
		if (attachments.length + uploads.length > 4)
			throw new BotError('validation', 'At most four attachments per message');
		// Lazy expiry: a post also discards expired staged images.
		if (this.staging.has(botId)) this.pruneAttachments(botId);
		const s = this.state(botId),
			hash = digest(
				JSON.stringify(
					uploads.length
						? { author, body, executionId, uploads }
						: { author, body, executionId, attachments },
				),
			),
			prior = s.keys[key];
		// Replay first: a retried post succeeds even after its uploads were consumed.
		if (prior) {
			if (prior.hash !== hash)
				throw new BotError(
					'conflict',
					'Idempotency key was already used with different content',
				);
			return this.get(botId, prior.id);
		}
		if (uploads.length) attachments = [...attachments, ...this.staged(botId, uploads)];
		if (this.latest(s).length >= 10000 || Object.keys(s.keys).length >= 20000)
			throw new BotError('resource', 'Message history limit reached');
		const next = structuredClone(s),
			messageId = randomBytes(12).toString('hex'),
			change = this.change(next, 'message.posted', messageId, 1);
		const row: Row = {
			id: messageId,
			botId,
			sequence: change,
			revision: 1,
			author,
			executionId,
			createdAt: this.now(),
			updatedAt: this.now(),
			text: body,
			attachments: [...attachments],
			...(author === 'user'
				? { dispatch: { state: 'pending' as const, executionId: null } }
				: {}),
			change,
			deleted: false,
		};
		next.rows.push(row);
		next.keys[key] = { hash, id: messageId };
		this.save(botId, next);
		// Consumed only once persisted: a failed save leaves every token usable.
		for (const token of uploads) this.staging.get(botId)?.delete(token);
		return this.public(row);
	}
	private public(row: Row): BotMessage {
		const { change: _, deleted: __, ...message } = row;
		return structuredClone(message);
	}
	get(botId: string, messageId: string): BotMessage {
		id(messageId);
		const row = this.latest(this.state(botId)).find((r) => r.id === messageId);
		if (!row) throw new BotError('not_found', 'Message not found');
		return this.public(row);
	}
	edit(
		botId: string,
		messageId: string,
		revision: number,
		body: string | null,
	): BotMessage | null {
		const previous = this.get(botId, messageId);
		if (previous.revision !== revision)
			throw new BotError('conflict', 'Message changed; reload before editing');
		if (body !== null) text(body, 65536, 'message');
		const next = structuredClone(this.state(botId));
		const change = this.change(
			next,
			body === null ? 'message.deleted' : 'message.edited',
			messageId,
			revision + 1,
		);
		const row: Row = {
			...previous,
			text: body ?? '',
			attachments: body === null ? [] : previous.attachments,
			revision: revision + 1,
			updatedAt: this.now(),
			change,
			deleted: body === null,
		};
		next.rows.push(row);
		this.save(botId, next);
		if (body === null)
			for (const asset of previous.attachments)
				if (
					!this.latest(next).some((row) =>
						row.attachments.some((a) => a.id === asset.id),
					)
				)
					rmSync(join(this.directory(botId), 'attachments', asset.id), {
						force: true,
					});
		return body === null ? null : this.public(row);
	}
	setDispatch(
		botId: string,
		messageId: string,
		dispatch: NonNullable<BotMessage['dispatch']>,
	): void {
		const message = this.get(botId, messageId);
		const next = structuredClone(this.state(botId));
		const change = this.change(
			next,
			'message.dispatch',
			messageId,
			message.revision,
		);
		next.rows.push({ ...message, dispatch, change, deleted: false });
		this.save(botId, next);
	}
	pending(botId: string): BotMessage[] {
		return this.latest(this.state(botId))
			.filter((r) => r.author === 'user' && r.dispatch?.state === 'pending')
			.map((r) => this.public(r));
	}
	clear(botId: string): void {
		const previous = this.state(botId);
		const next: State = {
			...previous,
			epoch: randomBytes(16).toString('hex'),
			rows: [],
			keys: {},
			events: [],
			imported: true,
		};
		this.change(next, 'messages.cleared', botId, 1);
		this.save(botId, next);
		this.staging.delete(botId);
		rmSync(join(this.directory(botId), 'attachments'), {
			recursive: true,
			force: true,
		});
	}
	removeBot(botId: string): void {
		this.states.delete(botId);
		this.staging.delete(botId);
		rmSync(this.directory(botId), { recursive: true, force: true });
	}
	list(botId: string, options: MessagePageOptions = {}): BotMessagePage {
		const s = this.state(botId),
			filter =
				options.search === undefined
					? ''
					: text(options.search, 256, 'search', true),
			limit = this.limit(options.limit);
		const c = options.cursor
			? this.decode(botId, options.cursor, 'messages', filter)
			: {
					botId,
					epoch: s.epoch,
					kind: 'messages',
					filter,
					through: s.sequence,
					position: Number.MAX_SAFE_INTEGER,
				};
		const rows = this.latest(s, c.through).filter(
			(r) =>
				!filter ||
				r.text.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
		);
		const candidates = rows.filter((r) => r.sequence < c.position);
		const items: BotMessageSummary[] = [];
		let bytes = 0;
		for (const row of candidates) {
			const { text: body, attachments, ...message } = this.public(row);
			const item = {
				...message,
				excerpt: utf8(body, 256),
				textBytes: Buffer.byteLength(body),
				attachmentCount: attachments.length,
			};
			const size = Buffer.byteLength(JSON.stringify(item));
			if (items.length >= limit || bytes + size > PAGE_BYTES - 1536) break;
			items.push(item);
			bytes += size;
		}
		const more = candidates.length > items.length;
		return {
			items,
			nextCursor:
				more && items.length
					? this.cursor(s, { ...c, position: items.at(-1)!.sequence })
					: null,
			eventsCursor: this.eventCursor(botId, c.through),
			total: rows.length,
			truncated: more,
		};
	}
	detail(
		botId: string,
		messageId: string,
		cursor?: string,
		limit = PAGE_BYTES - 2048,
	): BotMessageDetail {
		const message = this.get(botId, messageId);
		const { text: contents, ...metadata } = message;
		return {
			message: metadata,
			...this.sliceText(
				botId,
				'message',
				messageId,
				message.revision,
				contents,
				{ message: metadata },
				cursor,
				limit,
			),
		};
	}
	/** Authenticated, revision-bound text continuation shared by explicit detail tools. */
	sliceText(
		botId: string,
		kind: string,
		filter: string,
		revision: number,
		contents: string,
		metadata: unknown,
		cursor?: string,
		limit = PAGE_BYTES - 2048,
	): { text: string; nextCursor: string | null; truncated: boolean } {
		const s = this.state(botId);
		if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_BYTES - 2048)
			throw new BotError('validation', 'Detail limit must be 1..6144 bytes');
		const c = cursor
			? this.decode(botId, cursor, kind, filter)
			: {
					botId,
					epoch: s.epoch,
					kind,
					filter,
					through: s.sequence,
					position: 0,
					revision,
				};
		if (c.revision !== revision)
			throw new BotError(
				'conflict',
				'Message or trigger changed; reload detail',
			);
		const buffer = Buffer.from(contents);
		let content = utf8(buffer.subarray(c.position).toString('utf8'), limit);
		while (
			Buffer.byteLength(JSON.stringify({ metadata, text: content })) + 1024 >
				PAGE_BYTES &&
			content.length
		)
			content = utf8(content, Math.floor(Buffer.byteLength(content) / 2));
		const offset = c.position + Buffer.byteLength(content);
		if (offset === c.position && offset < buffer.length)
			throw new BotError(
				'validation',
				'Detail limit is too small for the next character',
			);
		return {
			text: content,
			nextCursor:
				offset < buffer.length
					? this.cursor(s, { ...c, position: offset })
					: null,
			truncated: offset < buffer.length,
		};
	}
	events(botId: string, cursor?: string, limit?: number): BotRuntimeEventPage {
		const s = this.state(botId),
			count = this.limit(limit);
		let after = s.sequence;
		if (cursor) {
			try {
				after = this.decode(botId, cursor, 'events').position;
			} catch (error) {
				if (error instanceof BotError && error.code === 'conflict')
					return {
						items: [],
						nextCursor: this.eventCursor(botId),
						hasMore: false,
						gap: true,
					};
				throw error;
			}
		}
		if (after < (s.events[0]?.sequence ?? s.sequence) - 1)
			return {
				items: [],
				nextCursor: this.eventCursor(botId),
				hasMore: false,
				gap: true,
			};
		const rows = s.events.filter((e) => e.sequence > after),
			items = rows.slice(0, count);
		return {
			items: structuredClone(items),
			nextCursor: this.eventCursor(botId, items.at(-1)?.sequence ?? after),
			hasMore: rows.length > items.length,
			gap: false,
		};
	}
	async waitEvents(
		botId: string,
		cursor: string | undefined,
		limit: number | undefined,
		waitMs = 0,
		signal?: AbortSignal,
	): Promise<BotRuntimeEventPage> {
		if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 20000)
			throw new BotError('validation', 'Event wait must be 0..20000 ms');
		signal?.throwIfAborted();
		const immediate = this.events(botId, cursor, limit);
		if (immediate.items.length || immediate.gap || !waitMs) return immediate;
		await new Promise<void>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout>;
			const done = () => {
				clearTimeout(timer);
				this.off('changed', change);
				signal?.removeEventListener('abort', abort);
				resolve();
			};
			const change = (id: string) => {
				if (id === botId) done();
			};
			const abort = () => {
				clearTimeout(timer);
				this.off('changed', change);
				reject(signal?.reason ?? new Error('aborted'));
			};
			this.on('changed', change);
			signal?.addEventListener('abort', abort, { once: true });
			timer = setTimeout(done, waitMs);
			if (signal?.aborted) abort();
			else if (this.events(botId, immediate.nextCursor, limit).items.length)
				done();
		});
		return this.events(botId, immediate.nextCursor, limit);
	}
	emitEvent(
		botId: string,
		type: string,
		subjectId: string,
		revision: number,
	): void {
		const next = structuredClone(this.state(botId));
		this.change(
			next,
			text(type, 64, 'event type'),
			text(subjectId, 64, 'event subject'),
			revision,
		);
		this.save(botId, next);
	}
	private limit(value = 10): number {
		if (!Number.isInteger(value) || value < 1 || value > 25)
			throw new BotError('validation', 'Page limit must be 1..25');
		return value;
	}
	pageRecords<T>(
		botId: string,
		kind: string,
		filter: string,
		records: readonly T[],
		cursor?: string,
		limit?: number,
	): { items: T[]; nextCursor: string | null; truncated: boolean } {
		const s = this.state(botId),
			count = this.limit(limit);
		const c: Cursor = cursor
			? this.decode(botId, cursor, kind, filter)
			: {
					botId,
					epoch: s.epoch,
					kind,
					filter,
					through: s.sequence,
					position: kind === 'executions' ? Number.MAX_SAFE_INTEGER : 0,
				};
		const rows =
			kind === 'executions'
				? records.filter((row) => {
						const { order, id: recordId } = row as {
							order: number;
							id: string;
						};
						return (
							order <= c.through &&
							(order < c.position ||
								(order === c.position &&
									c.afterId !== undefined &&
									recordId < c.afterId))
						);
					})
				: records.slice(c.position);
		const items: T[] = [];
		let bytes = 0;
		for (const item of rows) {
			const size = Buffer.byteLength(JSON.stringify(item));
			if (items.length >= count || bytes + size > PAGE_BYTES - 1536) break;
			items.push(item);
			bytes += size;
		}
		const more = items.length < rows.length;
		const position =
			kind === 'executions'
				? ((items.at(-1) as { order: number } | undefined)?.order ?? 0)
				: c.position + items.length;
		return {
			items,
			nextCursor:
				more && items.length
					? this.cursor(s, {
							...c,
							position,
							...(kind === 'executions'
								? { afterId: (items.at(-1) as { id: string }).id }
								: {}),
						})
					: null,
			truncated: more,
		};
	}
	imported(botId: string): boolean {
		return this.state(botId).imported;
	}
	markImported(botId: string): void {
		const next = structuredClone(this.state(botId));
		next.imported = true;
		this.save(botId, next);
	}
	pruneAttachments(botId: string): void {
		const directory = join(this.directory(botId), 'attachments');
		if (!existsSync(directory)) return;
		const used = new Set([
			...this.latest(this.state(botId))
				.flatMap((r) => r.attachments)
				.map((a) => a.id),
			...[...this.live(botId).values()].map((s) => s.asset.id),
		]);
		for (const file of readdirSync(directory))
			if (/^[a-f0-9]{24}$/.test(file) && !used.has(file))
				rmSync(join(directory, file), { force: true });
	}
	putAttachment(
		botId: string,
		name: string,
		bytes: Uint8Array,
	): BotMessageAttachment {
		text(name, 256, 'attachment name');
		if (bytes.length > BOT_IMAGE_BYTES)
			throw new BotError('validation', 'Attachment exceeds 2 MiB');
		const mime = botImageMime(bytes),
			s = this.state(botId);
		const assets = new Map(
			this.latest(s)
				.flatMap((r) => r.attachments)
				.map((a) => [a.id, a]),
		);
		if (
			[...assets.values()].reduce((n, a) => n + a.size, 0) + bytes.length >
			64 * 1024 * 1024
		)
			throw new BotError('resource', 'Bot attachment storage exceeds 64 MiB');
		const asset = {
			id: digest(Buffer.from(bytes).toString('base64')).slice(0, 24),
			name,
			mime,
			size: bytes.length,
		};
		const directory = join(this.directory(botId), 'attachments');
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const target = join(directory, asset.id);
		if (!existsSync(target)) {
			const total = readdirSync(directory).reduce(
				(n, file) => n + statSync(join(directory, file)).size,
				0,
			);
			if (total + bytes.length > 64 * 1024 * 1024)
				throw new BotError('resource', 'Bot attachment storage exceeds 64 MiB');
			writeFileDurablySync(target, bytes, { mode: 0o600 });
		}
		return asset;
	}
	/** Live staged uploads; expired ones are dropped here, lazily (no timer). */
	private live(botId: string): Map<string, Staged> {
		const staged = this.staging.get(botId) ?? new Map<string, Staged>();
		const now = this.now();
		for (const [token, entry] of staged)
			if (entry.expiresAt <= now) staged.delete(token);
		if (staged.size) this.staging.set(botId, staged);
		else this.staging.delete(botId);
		return staged;
	}
	/** Stage one user image and return the token a post consumes. */
	stage(
		botId: string,
		name: string,
		bytes: Uint8Array,
	): { token: string; attachment: Omit<BotMessageAttachment, 'id'> } {
		this.pruneAttachments(botId);
		if (this.live(botId).size >= 64)
			throw new BotError('resource', 'Too many images are waiting to be sent');
		const blob = this.putAttachment(botId, name, bytes),
			asset = { ...blob, name },
			token = randomBytes(12).toString('hex');
		const staged = this.live(botId);
		staged.set(token, { asset, expiresAt: this.now() + BOT_UPLOAD_STAGING_MS });
		this.staging.set(botId, staged);
		const { id: _, ...attachment } = asset;
		return { token, attachment };
	}
	/** Resolve tokens for a post; any invalid token refuses the whole post. */
	private staged(botId: string, uploads: readonly string[]): BotMessageAttachment[] {
		if (new Set(uploads).size !== uploads.length)
			throw new BotError('validation', 'An image was attached twice');
		const staged = this.live(botId);
		return uploads.map((token) => {
			const entry =
				typeof token === 'string' && /^[a-f0-9]{24}$/.test(token)
					? staged.get(token)
					: undefined;
			if (!entry)
				throw new BotError(
					'validation',
					'An attached image is no longer available; attach it again',
				);
			return { ...entry.asset };
		});
	}
	attachment(
		botId: string,
		attachmentId: string,
	): { mime: string; bytes: Uint8Array } {
		id(attachmentId);
		const asset = this.latest(this.state(botId))
			.flatMap((r) => r.attachments)
			.find((a) => a.id === attachmentId);
		if (!asset) throw new BotError('not_found', 'Attachment not found');
		const file = join(this.directory(botId), 'attachments', attachmentId);
		if (statSync(file).size > BOT_IMAGE_BYTES)
			throw new BotError('validation', 'Attachment exceeds limit');
		const bytes = readFileSync(file);
		if (bytes.length > BOT_IMAGE_BYTES)
			throw new BotError('validation', 'Attachment exceeds limit');
		return { mime: botImageMime(bytes), bytes };
	}
}
