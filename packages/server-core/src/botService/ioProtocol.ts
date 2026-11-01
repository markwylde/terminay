import { randomUUID } from 'node:crypto';
import { type Duplex, PassThrough } from 'node:stream';
import {
	assertJsonValue,
	botEnvironmentId,
	botStreamGeneration,
	type JsonValue,
	BOT_IO_OPERATIONS as op,
} from '@terminay/protocol';
import type {
	CommandRequest,
	OperationRegistries,
	QueryRequest,
	RequestContext,
} from '../types.js';
import type { BotFilesService, BotFilesView } from './files.js';
import type { BotDesktopService } from './rfb.js';
import type { BotShellService, BotShellStream } from './shell.js';
import {
	assertBotStreamAuthority,
	type BotStreamAuthority,
} from './streamAuthority.js';

export interface BotIoProtocolHooks {
	/** Supply connection-lifetime revocation and a live authorization check. */
	readonly authority: (context: RequestContext) => BotStreamAuthority;
	readonly files: BotFilesService;
	readonly shells: BotShellService;
	readonly desktops: BotDesktopService;
}
interface Resource {
	id: string;
	parentId?: string;
	botId: string;
	generation: number;
	authority: BotStreamAuthority;
	files?: BotFilesView;
	shell?: BotShellStream;
	duplex?: Duplex;
	reader?: AsyncIterator<Uint8Array>;
	reading?: boolean;
	writing?: boolean;
	writeAllowed?: boolean;
	upload?: Promise<void>;
	uploadError?: Error;
	close: () => Promise<void>;
}
type Request = QueryRequest | CommandRequest;
/** Demand/credit-driven binary lanes over canonical queries/commands. Each read
 * waits for data and grants one chunk of credit; it never samples on a timer.
 * Bytes never enter the event journal. Watches return invalidations only. */
export class BotIoProtocol {
	private readonly resources = new Map<string, Resource>();
	constructor(private readonly hooks: BotIoProtocolHooks) {}
	private payload(request: Request): Record<string, JsonValue> {
		const a = this.hooks.authority(request.context);
		assertBotStreamAuthority(a);
		request.context.signal.throwIfAborted();
		const p = request.envelope.payload;
		if (!p || typeof p !== 'object' || Array.isArray(p))
			throw new TypeError('invalid bot I/O payload');
		botEnvironmentId(p.botId);
		return p;
	}
	private resource(request: Request): Resource {
		const p = this.payload(request);
		const r =
			typeof p.streamId === 'string'
				? this.resources.get(p.streamId)
				: undefined;
		if (
			!r ||
			r.botId !== p.botId ||
			r.generation !== p.generation ||
			r.authority.connectionId !== request.context.connectionId ||
			r.authority.clientId !== request.context.clientId
		)
			throw new Error('bot stream binding mismatch');
		assertBotStreamAuthority(r.authority);
		return r;
	}
	private add(
		request: Request,
		botId: string,
		generation: number,
		parts: Partial<Resource>,
		cleanup: () => Promise<void>,
	): JsonValue {
		const authority = this.hooks.authority(request.context);
		assertBotStreamAuthority(authority);
		if (
			[...this.resources.values()].filter(
				(r) => r.authority.connectionId === authority.connectionId,
			).length >= 64
		)
			throw new Error('too many bot streams');
		const id = randomUUID();
		let closed = false;
		const abort = () => {
			void r.close().catch(() => undefined);
		};
		const r: Resource = {
			...parts,
			id,
			botId,
			generation,
			authority,
			close: async () => {
				if (closed) return;
				closed = true;
				this.resources.delete(id);
				authority.signal.removeEventListener('abort', abort);
				r.duplex?.off('close', abort);
				r.duplex?.destroy();
				await cleanup();
				await Promise.all(
					[...this.resources.values()]
						.filter((child) => child.parentId === id)
						.map((child) => child.close()),
				);
				await r.reader?.return?.();
			},
		};
		this.resources.set(id, r);
		if (r.reader) r.duplex?.once('close', abort);
		authority.signal.addEventListener('abort', abort, { once: true });
		if (authority.signal.aborted) abort();
		return { streamId: id, botId, generation };
	}
	private files(request: Request): {
		r: Resource;
		view: BotFilesView;
		p: Record<string, JsonValue>;
	} {
		const p = this.payload(request),
			r = this.resource(request);
		if (!r.files) throw new Error('not a Files view');
		return { r, view: r.files, p };
	}
	operations(): OperationRegistries {
		return {
			policies: Object.fromEntries(
				Object.values(op).map((name) => [name, { scope: 'write' as const }]),
			),
			queries: {
				[op.filesList]: async (request) => {
					const { view, p } = this.files(request);
					return json(await view.list(text(p.path), request.context.signal));
				},
				[op.filesStat]: async (request) => {
					const { view, p } = this.files(request);
					return json(await view.stat(text(p.path), request.context.signal));
				},
				[op.read]: async (request) => {
					const r = this.resource(request);
					if (!r.reader || r.reading)
						throw new Error('bot stream read already pending or unavailable');
					r.reading = true;
					const abort = () => {
						void r.close().catch(() => undefined);
					};
					request.context.signal.addEventListener('abort', abort, {
						once: true,
					});
					try {
						const next = await r.reader.next();
						assertBotStreamAuthority(r.authority);
						request.context.signal.throwIfAborted();
						if (!this.resources.has(r.id)) throw new Error('bot stream closed');
						if (next.done) {
							await r.close();
							return { result: { done: true }, body: new Uint8Array() };
						}
						if (
							!(next.value instanceof Uint8Array) ||
							next.value.length > 1024 * 1024
						) {
							await r.close();
							throw new Error('bot stream chunk exceeded bound');
						}
						return { result: { done: false }, body: next.value };
					} catch (error) {
						await r.close();
						throw error;
					} finally {
						r.reading = false;
						request.context.signal.removeEventListener('abort', abort);
					}
				},
			},
			commands: {
				[op.filesOpen]: async (request) => {
					const p = this.payload(request),
						botId = botEnvironmentId(p.botId),
						generation = botStreamGeneration(p.generation);
					const view = await this.hooks.files.acquire(botId);
					try {
						return {
							result: this.add(
								request,
								botId,
								generation,
								{ files: view },
								async () => view.close(),
							),
						};
					} catch (e) {
						view.close();
						throw e;
					}
				},
				[op.filesMkdir]: async (request) => {
					const { view, p } = this.files(request);
					await view.mkdir(text(p.path), request.context.signal);
					return { result: null };
				},
				[op.filesRename]: async (request) => {
					const { view, p } = this.files(request);
					await view.rename(text(p.from), text(p.to), request.context.signal);
					return { result: null };
				},
				[op.filesDelete]: async (request) => {
					const { view, p } = this.files(request);
					await view.delete(text(p.path), request.context.signal);
					return { result: null };
				},
				[op.filesRead]: async (request) => {
					const { view, p, r } = this.files(request);
					const controller = new AbortController();
					const reader = (
						p.archive === true ? view.archive.bind(view) : view.read.bind(view)
					)(
						text(p.path),
						AbortSignal.any([controller.signal, r.authority.signal]),
					)[Symbol.asyncIterator]();
					return {
						result: this.add(
							request,
							r.botId,
							r.generation,
							{ reader, parentId: r.id },
							async () => controller.abort(),
						),
					};
				},
				[op.filesWrite]: async (request) => {
					const { view, p, r } = this.files(request);
					if (
						!Number.isSafeInteger(p.size) ||
						(p.size as number) < 0 ||
						(p.size as number) > 1024 ** 3
					)
						throw new RangeError('invalid upload size');
					const source = new PassThrough({ highWaterMark: 1024 * 1024 });
					source.on('error', () => undefined);
					const controller = new AbortController();
					const handle = this.add(
						request,
						r.botId,
						r.generation,
						{ duplex: source, writeAllowed: true, parentId: r.id },
						async () => controller.abort(),
					) as { streamId: string };
					const upload = this.resources.get(handle.streamId)!;
					upload.upload = view.write(
						text(p.path),
						p.size as number,
						source,
						AbortSignal.any([controller.signal, r.authority.signal]),
					);
					void upload.upload.catch(() => {
						upload.uploadError = new Error('bot upload failed');
						source.destroy(upload.uploadError);
					});
					return { result: handle };
				},
				[op.filesWatch]: async (request) => {
					const { view, p, r } = this.files(request);
					if (
						!Array.isArray(p.paths) ||
						!p.paths.every((s) => typeof s === 'string')
					)
						throw new TypeError('invalid watch paths');
					const source = new PassThrough({ highWaterMark: 1 });
					source.on('error', () => undefined);
					let queued = false;
					const stop = await view.watch(
						p.paths as string[],
						() => {
							if (!source.destroyed && !queued) {
								queued = !source.write(Buffer.from([1]));
							}
						},
						r.authority.signal,
					);
					source.on('drain', () => {
						queued = false;
					});
					const reader = source[Symbol.asyncIterator]();
					return {
						result: this.add(
							request,
							r.botId,
							r.generation,
							{ reader, duplex: source, parentId: r.id },
							async () => stop(),
						),
					};
				},
				[op.desktopOpen]: async (request) => {
					const p = this.payload(request),
						botId = botEnvironmentId(p.botId),
						generation = botStreamGeneration(p.generation),
						a = this.hooks.authority(request.context);
					if (
						p.mode !== undefined &&
						p.mode !== 'view-only' &&
						p.mode !== 'control'
					)
						throw new TypeError('invalid desktop mode');
					const relay = await this.hooks.desktops.open(
						a,
						botId,
						generation,
						p.mode ?? 'view-only',
						p.thumbnail === true,
					);
					try {
						return {
							result: this.add(
								request,
								botId,
								generation,
								{
									duplex: relay,
									writeAllowed: true,
									reader: relay[Symbol.asyncIterator](),
								},
								async () => {
									relay.destroy();
								},
							),
						};
					} catch (e) {
						relay.destroy();
						throw e;
					}
				},
				[op.shellOpen]: async (request) => {
					const p = this.payload(request),
						botId = botEnvironmentId(p.botId),
						generation = botStreamGeneration(p.generation),
						a = this.hooks.authority(request.context);
					if (
						p.purpose !== undefined &&
						p.purpose !== 'shell' &&
						p.purpose !== 'sign-in'
					)
						throw new TypeError('invalid bot terminal purpose');
					// Keep EOF readable until the client receives done; an automatic close
					// would otherwise tear down a successful sign-in's final read.
					const source = new PassThrough({
						highWaterMark: 256 * 1024,
						autoDestroy: false,
					});
					source.on('error', () => undefined);
					let shell: BotShellStream | undefined;
					shell = await this.hooks.shells.open(
						a,
						botId,
						generation,
						{ cols: number(p.cols), rows: number(p.rows) },
						(bytes) => {
							if (!source.write(bytes)) shell?.pause();
						},
						() => source.end(),
						p.purpose === 'sign-in' ? 'sign-in' : 'shell',
					);
					source.on('drain', () => {
						try {
							shell?.resume();
						} catch {
							source.destroy();
						}
					});
					try {
						return {
							result: this.add(
								request,
								botId,
								generation,
								{
									shell,
									duplex: source,
									writeAllowed: true,
									reader: source[Symbol.asyncIterator](),
								},
								async () => {
									await shell?.close();
								},
							),
						};
					} catch (e) {
						source.destroy();
						await shell.close();
						throw e;
					}
				},
				[op.shellResize]: async (request) => {
					const p = this.payload(request),
						r = this.resource(request);
					if (!r.shell) throw new Error('not a shell');
					await r.shell.resize({ cols: number(p.cols), rows: number(p.rows) });
					return { result: null };
				},
				[op.write]: async (request) => {
					const r = this.resource(request);
					if (request.body.length > 1024 * 1024)
						throw new RangeError('bot input chunk too large');
					if (!r.writeAllowed) throw new Error('bot stream is read-only');
					if (r.writing) throw new Error('bot write already pending');
					r.writing = true;
					try {
						if (r.shell) await r.shell.write(request.body);
						else if (r.duplex) {
							if (r.uploadError) throw r.uploadError;
							await new Promise<void>((resolve, reject) =>
								r.duplex!.write(request.body, (e?: Error | null) =>
									e ? reject(new Error('bot stream write failed')) : resolve(),
								),
							);
						} else throw new Error('bot stream is not writable');
						assertBotStreamAuthority(r.authority);
						return { result: null };
					} finally {
						r.writing = false;
					}
				},
				[op.finish]: async (request) => {
					const r = this.resource(request);
					if (!r.upload) throw new Error('not an upload');
					try {
						r.duplex?.end();
						await r.upload;
						return { result: null };
					} finally {
						await r.close();
					}
				},
				[op.close]: async (request) => {
					await this.resource(request).close();
					return { result: null };
				},
			},
		};
	}
	async closeConnection(id: string): Promise<void> {
		await Promise.all(
			[...this.resources.values()]
				.filter((r) => r.authority.connectionId === id)
				.map((r) => r.close()),
		);
		this.hooks.desktops.closeConnection(id);
		await this.hooks.shells.closeConnection(id);
	}
	async closeBot(id: string): Promise<void> {
		await Promise.all(
			[...this.resources.values()]
				.filter((r) => r.botId === id)
				.map((r) => r.close()),
		);
	}
	async close(): Promise<void> {
		await Promise.all([...this.resources.values()].map((r) => r.close()));
	}
}
function text(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('expected bot file path');
	return value;
}
function number(value: unknown): number {
	if (typeof value !== 'number') throw new TypeError('expected bot dimension');
	return value;
}
function json(value: unknown): JsonValue {
	assertJsonValue(value);
	return value;
}
