import type { Writable } from 'node:stream';
import { botEnvironmentId } from '@terminay/protocol';
import type { EngineDriver } from './engine.js';
import { ownedResource } from './engine.js';
import { botFolderArchive } from './fileArchive.js';
import { type BotDeadlineClock, BotHelperIdleDeadline } from './idle.js';
import { BOT_IMAGE } from './image.js';
import { EngineCommandError } from './process.js';

export const BOT_FILE_CHUNK_BYTES = 1024 * 1024;
export const BOT_FILE_UPLOAD_BYTES = 1024 ** 3;

import type { BotFileEntry, BotFileListing } from '@terminay/protocol';

export type { BotFileEntry, BotFileListing } from '@terminay/protocol';
export interface BotFilesView {
	archive(path: string, signal?: AbortSignal): AsyncIterable<Uint8Array>;
	list(path: string, signal?: AbortSignal): Promise<BotFileListing>;
	stat(path: string, signal?: AbortSignal): Promise<BotFileEntry>;
	read(path: string, signal?: AbortSignal): AsyncIterable<Uint8Array>;
	write(
		path: string,
		size: number,
		chunks: AsyncIterable<Uint8Array>,
		signal?: AbortSignal,
	): Promise<void>;
	mkdir(path: string, signal?: AbortSignal): Promise<void>;
	rename(from: string, to: string, signal?: AbortSignal): Promise<void>;
	delete(path: string, signal?: AbortSignal): Promise<void>;
	watch(
		paths: readonly string[],
		changed: () => void,
		signal?: AbortSignal,
	): Promise<() => void>;
	close(): void;
}
export interface BotFilesHooks {
	readonly engine: () => Promise<EngineDriver>;
	/** Server-validated manifests supply paths. Clients cannot change protection. */
	readonly protectedPaths: (id: string) => readonly string[];
	readonly timers?: BotDeadlineClock;
}
export class BotFilesImageRequired extends Error {
	readonly code = 'bot-image-required';
	constructor() {
		super('bot image must be built before opening Files');
	}
}
type Message = Record<string, unknown>;
interface Mailbox {
	push(message: Message): void;
	fail(error: Error): void;
	next(deadline?: boolean): Promise<Message>;
	close(): void;
}
function mailbox(): Mailbox {
	const queue: Message[] = [];
	let failure: Error | undefined;
	let waiter:
		| { resolve: (m: Message) => void; reject: (e: Error) => void }
		| undefined;
	return {
		push(message) {
			if (failure) return;
			if (waiter) {
				const pending = waiter;
				waiter = undefined;
				pending.resolve(message);
			} else if (queue.length >= 5)
				this.fail(new Error('helper exceeded flow credit'));
			else queue.push(message);
		},
		fail(error) {
			failure = error;
			queue.length = 0;
			waiter?.reject(error);
			waiter = undefined;
		},
		next(deadline = true) {
			if (failure) return Promise.reject(failure);
			if (queue.length) return Promise.resolve(queue.shift()!);
			return new Promise<Message>((resolve, reject) => {
				const timer = deadline
					? setTimeout(() => {
							this.fail(new Error('helper request deadline exceeded'));
						}, 30_000)
					: undefined;
				waiter = {
					resolve: (m) => {
						clearTimeout(timer);
						resolve(m);
					},
					reject: (e) => {
						clearTimeout(timer);
						reject(e);
					},
				};
			});
		},
		close() {
			this.fail(new Error('helper request closed'));
		},
	};
}
/** One JSON-lines connection. Downloads receive four initial credits, then one
 * credit only after the consumer advances. Uploads await a credit per chunk. */
export class BotFilesConnection {
	private readonly pending = new Map<number, Mailbox>();
	private nextId = 0;
	private buffer = '';
	private closed = false;
	private readonly ready = mailbox();
	private readonly child: ReturnType<EngineDriver['stream']>;
	private readonly decoder = new TextDecoder();
	constructor(driver: EngineDriver, args: readonly string[]) {
		this.child = driver.stream(args);
		this.child.stderr.on('data', () => undefined);
		this.child.stdin.on('error', () => this.fail());
		this.child.stdout.on('data', (chunk) => {
			if (this.closed) return;
			this.buffer +=
				typeof chunk === 'string'
					? chunk
					: this.decoder.decode(chunk, { stream: true });
			if (this.buffer.length > 8 * 1024 * 1024) {
				this.fail();
				return;
			}
			let end = this.buffer.indexOf('\n');
			while (end >= 0) {
				const line = this.buffer.slice(0, end);
				this.buffer = this.buffer.slice(end + 1);
				try {
					const message = JSON.parse(line) as Message;
					if (!message || typeof message !== 'object' || Array.isArray(message))
						throw new Error('invalid helper response');
					if (message.ready === true) this.ready.push(message);
					else if (Number.isSafeInteger(message.id))
						this.pending.get(message.id as number)?.push(message);
					else throw new Error('unbound helper response');
				} catch {
					this.fail();
					return;
				}
				end = this.buffer.indexOf('\n');
			}
		});
		this.child.once('error', () => this.fail());
		this.child.once('close', () => this.fail());
	}
	get available(): boolean {
		return !this.closed;
	}
	async waitReady(): Promise<void> {
		await this.ready.next();
	}
	private fail(): void {
		if (this.closed) return;
		this.closed = true;
		const error = new Error('bot files helper unavailable');
		this.ready.fail(error);
		for (const box of this.pending.values()) box.fail(error);
		this.child.kill('SIGKILL');
		this.buffer = '';
	}
	close(): void {
		this.fail();
	}
	private async send(message: Message): Promise<void> {
		if (this.closed) throw new Error('bot files helper closed');
		// Requests are bounded and each upload waits for the helper's credit.
		await new Promise<void>((resolve, reject) => {
			(this.child.stdin as unknown as Writable).write(
				`${JSON.stringify(message)}\n`,
				(error?: Error | null) =>
					error ? reject(new Error('helper write failed')) : resolve(),
			);
		});
	}
	private open(signal?: AbortSignal) {
		signal?.throwIfAborted();
		if (this.pending.size >= 64) throw new Error('too many helper requests');
		const id = ++this.nextId;
		const box = mailbox();
		this.pending.set(id, box);
		const cancel = () => {
			box.fail(new Error('bot files request cancelled'));
			if (!this.closed)
				void this.send({ id: ++this.nextId, op: 'cancel', target: id }).catch(
					() => undefined,
				);
		};
		signal?.addEventListener('abort', cancel, { once: true });
		return {
			id,
			next: async (deadline = true) => {
				const message = await box.next(deadline);
				if (message.error)
					throw new Error(
						`bot files ${message.error === 'not-found' ? 'not found' : 'request refused'}`,
					);
				return message;
			},
			close: () => {
				signal?.removeEventListener('abort', cancel);
				this.pending.delete(id);
				box.close();
			},
			cancel,
		};
	}
	async request(
		op: string,
		fields: Message,
		signal?: AbortSignal,
	): Promise<Message> {
		const r = this.open(signal);
		try {
			await this.send({ id: r.id, op, ...fields });
			return await r.next();
		} finally {
			r.close();
		}
	}
	async *read(path: string, signal?: AbortSignal): AsyncIterable<Uint8Array> {
		const r = this.open(signal);
		try {
			await this.send({ id: r.id, op: 'read', path });
			while (true) {
				const m = await r.next();
				if (m.done === true) return;
				if (
					typeof m.chunk !== 'string' ||
					m.chunk.length > Math.ceil(BOT_FILE_CHUNK_BYTES / 3) * 4 ||
					!/^[A-Za-z0-9+/]*={0,2}$/.test(m.chunk)
				)
					throw new Error('invalid helper chunk');
				const chunk = Buffer.from(m.chunk, 'base64');
				if (chunk.length > BOT_FILE_CHUNK_BYTES)
					throw new Error('helper chunk too large');
				yield chunk;
				await this.send({ id: r.id, op: 'credit', n: 1 });
			}
		} finally {
			r.cancel();
			r.close();
		}
	}
	async write(
		path: string,
		size: number,
		chunks: AsyncIterable<Uint8Array>,
		signal?: AbortSignal,
	): Promise<void> {
		if (!Number.isSafeInteger(size) || size < 0 || size > BOT_FILE_UPLOAD_BYTES)
			throw new RangeError('invalid upload size');
		const r = this.open(signal);
		let written = 0;
		try {
			await this.send({ id: r.id, op: 'write-begin', path, size });
			if ((await r.next()).ok !== true)
				throw new Error('helper refused upload');
			for await (const chunk of chunks) {
				signal?.throwIfAborted();
				if (
					!(chunk instanceof Uint8Array) ||
					chunk.length > BOT_FILE_CHUNK_BYTES ||
					written + chunk.length > size
				)
					throw new RangeError('invalid upload chunk');
				written += chunk.length;
				await this.send({
					id: r.id,
					op: 'write-chunk',
					data: Buffer.from(chunk).toString('base64'),
				});
				if ((await r.next()).credit !== 1)
					throw new Error('invalid helper upload credit');
			}
			if (written !== size) throw new RangeError('incomplete upload');
			await this.send({ id: r.id, op: 'write-commit' });
			if ((await r.next()).ok !== true)
				throw new Error('helper refused commit');
		} catch (error) {
			r.cancel();
			throw error;
		} finally {
			r.close();
		}
	}
	async watch(
		paths: readonly string[],
		changed: () => void,
		signal?: AbortSignal,
	): Promise<() => void> {
		const r = this.open(signal);
		await this.send({ id: r.id, op: 'watch', paths });
		try {
			if ((await r.next()).ok !== true) throw new Error('helper watch refused');
		} catch (e) {
			r.cancel();
			r.close();
			throw e;
		}
		let stopped = false;
		const stop = () => {
			if (stopped) return;
			stopped = true;
			r.cancel();
			r.close();
		};
		void (async () => {
			try {
				while (!stopped) {
					const m = await r.next(false);
					if (m.event) changed();
				}
			} catch {
				stop();
			}
		})();
		return stop;
	}
}

interface Helper {
	connection: BotFilesConnection;
	idle: BotHelperIdleDeadline;
	driver: EngineDriver;
	name: string;
}
export class BotFilesService {
	private readonly helpers = new Map<string, Promise<Helper>>();
	private generation = 0;
	constructor(
		readonly serverId: string,
		private readonly hooks: BotFilesHooks,
	) {}
	private async create(id: string): Promise<Helper> {
		const driver = await this.hooks.engine();
		if (!(await driver.inspect('image', BOT_IMAGE)))
			throw new BotFilesImageRequired();
		const volume = `terminay-bot-${id}-home`;
		const existing = await driver.inspect('volume', volume);
		if (existing && !ownedResource(existing, this.serverId, id))
			throw new Error('bot volume belongs to another owner');
		const labels = [
			'--label',
			'terminay.managed=1',
			'--label',
			`terminay.server=${this.serverId}`,
			'--label',
			`terminay.bot=${id}`,
		];
		if (!existing) await driver.run(['volume', 'create', ...labels, volume]);
		const name = `terminay-files-${id}-${++this.generation}`;
		const protections = this.hooks
			.protectedPaths(id)
			.map((p) => filePath(p, [], false));
		const args = [
			'run',
			'--rm',
			'-i',
			'--pull',
			'never',
			'--name',
			name,
			'--network',
			'none',
			'--read-only',
			'--cap-drop',
			'ALL',
			'--cpus',
			'0.5',
			'--memory',
			'268435456',
			'--pids-limit',
			'64',
			'--user',
			String(driver.details.botUid),
			...labels,
			'--label',
			`terminay.helper=${id}`,
			'--entrypoint',
			'terminay-files',
			'--mount',
			`type=volume,source=${volume},target=/home/bot`,
		];
		if (driver.details.pin.kind === 'podman' && driver.details.rootless)
			args.push(
				'--userns',
				`keep-id:uid=${driver.details.botUid},gid=${driver.details.botGid}`,
			);
		args.push(BOT_IMAGE, ...protections.flatMap((p) => ['--protect', p]));
		const connection = new BotFilesConnection(driver, args);
		try {
			await connection.waitReady();
		} catch (error) {
			connection.close();
			await driver.run(['container', 'rm', '-f', name]).catch(() => undefined);
			throw error;
		}
		return {
			connection,
			driver,
			name,
			idle: new BotHelperIdleDeadline(() => {
				void this.closeBot(id).catch(() => undefined);
			}, this.hooks.timers),
		};
	}
	async acquire(id: string): Promise<BotFilesView> {
		botEnvironmentId(id);
		let pending = this.helpers.get(id);
		if (!pending) {
			pending = this.create(id);
			this.helpers.set(id, pending);
			void pending.catch(() => {
				if (this.helpers.get(id) === pending) this.helpers.delete(id);
			});
		}
		const helper = await pending;
		if (!helper.connection.available) {
			await this.closeBot(id);
			return this.acquire(id);
		}
		const release = helper.idle.acquire();
		const paths = this.hooks.protectedPaths(id);
		let closed = false;
		const controller = new AbortController();
		const stops = new Set<() => void>();
		const path = (p: string) => {
			if (closed) throw new Error('Files view closed');
			return filePath(p, paths);
		};
		const bound = (signal?: AbortSignal) =>
			signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
		const request = (op: string, fields: Message, signal?: AbortSignal) =>
			helper.connection.request(op, fields, bound(signal));
		const view: BotFilesView = {
			archive: (p, signal) => botFolderArchive(view, path(p), bound(signal)),
			list: async (p, signal) => {
				const value = await request('list', { path: path(p) }, signal);
				if (
					!Array.isArray(value.entries) ||
					value.entries.length > 10000 ||
					typeof value.truncated !== 'boolean'
				)
					throw new Error('invalid helper listing');
				return {
					entries: value.entries.map(fileEntry),
					truncated: value.truncated,
				};
			},
			stat: async (p, signal) =>
				fileEntry((await request('stat', { path: path(p) }, signal)).stat),
			read: (p, signal) => helper.connection.read(path(p), bound(signal)),
			write: (p, size, chunks, signal) =>
				helper.connection.write(path(p), size, chunks, bound(signal)),
			mkdir: async (p, signal) => {
				await request('mkdir', { path: path(p) }, signal);
			},
			rename: async (from, to, signal) => {
				await request('rename', { from: path(from), to: path(to) }, signal);
			},
			delete: async (p, signal) => {
				await request('delete', { path: path(p) }, signal);
			},
			watch: async (ps, changed, signal) => {
				if (!ps.length || ps.length > 16)
					throw new RangeError('invalid watch paths');
				const stop = await helper.connection.watch(
					ps.map(path),
					() => {
						if (!closed) changed();
					},
					bound(signal),
				);
				stops.add(stop);
				return () => {
					stop();
					stops.delete(stop);
				};
			},
			close: () => {
				if (closed) return;
				closed = true;
				controller.abort();
				for (const stop of stops) stop();
				stops.clear();
				release();
			},
		};
		return view;
	}
	async closeBot(id: string): Promise<void> {
		const pending = this.helpers.get(id);
		if (!pending) return;
		this.helpers.delete(id);
		const helper = await pending;
		helper.idle.close();
		helper.connection.close();
		await helper.driver
			.run(['container', 'rm', '-f', helper.name])
			.catch((error: unknown) => {
				if (
					!(error instanceof EngineCommandError) ||
					error.code !== 'not-found'
				)
					throw error;
			});
	}
	/** Startup reconciliation never adopts helpers left by a previous process. */
	async reconcile(): Promise<void> {
		const driver = await this.hooks.engine();
		const ids = await driver.run([
			'container',
			'ls',
			'-aq',
			'--filter',
			`label=terminay.server=${this.serverId}`,
			'--filter',
			'label=terminay.helper',
		]);
		for (const id of ids.trim().split(/\s+/).filter(Boolean)) {
			if (!/^[a-f0-9]{12,64}$/.test(id))
				throw new Error('invalid helper container id');
			const container = await driver.inspect('container', id);
			const labels = container?.Config?.Labels;
			if (
				labels?.['terminay.server'] === this.serverId &&
				labels['terminay.managed'] === '1' &&
				labels['terminay.helper']
			)
				await driver.run(['container', 'rm', '-f', id]);
		}
	}
	async close(): Promise<void> {
		await Promise.all([...this.helpers.keys()].map((id) => this.closeBot(id)));
	}
}
function filePath(
	value: string,
	protectedPaths: readonly string[],
	guard = true,
): string {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 4096 ||
		value.startsWith('/') ||
		value.includes('\0') ||
		value.split('/').includes('..')
	)
		throw new TypeError('invalid bot file path');
	const parts = value.split('/').filter((p) => p && p !== '.');
	const normalized = parts.join('/') || '.';
	if (
		guard &&
		(['.codex', '.claude'].includes(normalized) ||
			protectedPaths.some(
				(p) =>
					p === normalized ||
					p.startsWith(`${normalized}/`) ||
					normalized.startsWith(`${p}/`),
			))
	)
		throw new Error('protected bot auth path');
	return normalized;
}
function fileEntry(value: unknown): BotFileEntry {
	const e = value as BotFileEntry;
	if (
		!e ||
		typeof e.name !== 'string' ||
		e.name.includes('/') ||
		e.name.length > 255 ||
		!['file', 'dir', 'link', 'credential-link', 'other'].includes(e.kind) ||
		!Number.isSafeInteger(e.size) ||
		e.size < 0 ||
		!Number.isFinite(e.mtime)
	)
		throw new Error('invalid helper file entry');
	return { name: e.name, kind: e.kind, size: e.size, mtime: e.mtime };
}
