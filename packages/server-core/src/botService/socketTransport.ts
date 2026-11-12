import { EventEmitter } from 'node:events';
import { type ClientRequest, type IncomingMessage, request } from 'node:http';
import {
	type Duplex,
	PassThrough,
	type Readable,
	type Writable,
} from 'node:stream';
import { type EngineCallOptions, EngineCommandError } from './process.js';

/** Errors never retain URLs, daemon messages, request bodies or credentials. */
export function socketError(error: unknown): EngineCommandError {
	if (error instanceof EngineCommandError) return error;
	const code = (error as NodeJS.ErrnoException)?.code;
	return new EngineCommandError(
		code === 'EACCES' || code === 'EPERM'
			? 'permission-denied'
			: code === 'ENOENT'
				? 'not-installed'
				: 'not-running',
		'engine socket unavailable',
		typeof code === 'string' ? { errno: code } : {},
	);
}
export function httpError(status: number): EngineCommandError {
	return new EngineCommandError(
		status === 404
			? 'not-found'
			: status === 409
				? 'conflict'
				: status === 401 || status === 403
					? 'permission-denied'
					: 'not-running',
		'engine API request failed',
	);
}
export interface EngineStream extends EventEmitter {
	readonly stdin: Writable;
	readonly stdout: Readable;
	readonly stderr: Readable;
	kill(signal?: string): boolean;
	resize(cols: number, rows: number): Promise<void>;
}

/** A transport-owned stream, rather than an OS child. Consumers still perform
 * container-side supervisor cleanup before releasing session/credential leases. */
export class SocketProcess extends EventEmitter implements EngineStream {
	readonly stdin = new PassThrough({ highWaterMark: 64 * 1024 });
	readonly stdout = new PassThrough({ highWaterMark: 64 * 1024 });
	readonly stderr = new PassThrough({ highWaterMark: 64 * 1024 });
	private closed = false;
	private readonly aborter = new AbortController();
	readonly signal = this.aborter.signal;
	resizeHandler?: (cols: number, rows: number) => Promise<void>;
	constructor() {
		super();
		// Consumers may attach after asynchronous setup. Avoid unhandled stream
		// errors while still emitting the process-level error for their owner.
		for (const stream of [this.stdin, this.stdout, this.stderr])
			stream.on('error', () => {});
	}
	kill(): boolean {
		this.aborter.abort();
		this.finish(null);
		return true;
	}
	async resize(cols: number, rows: number): Promise<void> {
		if (
			![cols, rows].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 4096)
		)
			throw new RangeError('invalid terminal size');
		if (!this.resizeHandler)
			await new Promise<void>((resolve, reject) => {
				const ready = () => {
					clean();
					resolve();
				};
				const closed = () => {
					clean();
					reject(new EngineCommandError('not-running', 'engine stream closed'));
				};
				const clean = () => {
					this.off('ready', ready);
					this.off('close', closed);
				};
				if (this.closed) {
					reject(new EngineCommandError('not-running', 'engine stream closed'));
					return;
				}
				this.once('ready', ready);
				this.once('close', closed);
			});
		await this.resizeHandler?.(cols, rows);
	}
	finish(code: number | null, error?: unknown): void {
		if (this.closed) return;
		this.closed = true;
		if (error) this.aborter.abort();
		this.stdout.end();
		this.stderr.end();
		this.stdin.destroy();
		if (error) this.emit('error', socketError(error));
		this.emit('exit', code, null);
		this.emit('close', code, null);
	}
}

/** Incremental Docker raw-stream decoder. A single daemon frame is bounded;
 * backpressure pauses its source until the corresponding destination drains. */
export async function demultiplex(
	source: Readable,
	stdout: Writable,
	stderr: Writable,
	tty = false,
): Promise<void> {
	let buffered = Buffer.alloc(0);
	const write = async (target: Writable, bytes: Buffer) => {
		if (!target.write(bytes))
			await new Promise<void>((resolve, reject) => {
				const drained = () => {
					clean();
					resolve();
				};
				const failed = () => {
					clean();
					reject(new EngineCommandError('not-running', 'engine stream closed'));
				};
				const clean = () => {
					target.off('drain', drained);
					target.off('error', failed);
					target.off('close', failed);
				};
				target.once('drain', drained);
				target.once('error', failed);
				target.once('close', failed);
			});
	};
	for await (const chunk of source) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		if (tty) {
			await write(stdout, bytes);
			continue;
		}
		buffered = Buffer.concat([buffered, bytes]);
		while (buffered.length >= 8) {
			const size = new DataView(
				buffered.buffer,
				buffered.byteOffset,
				buffered.byteLength,
			).getUint32(4);
			if (
				![0, 1, 2].includes(buffered[0]!) ||
				buffered[1] ||
				buffered[2] ||
				buffered[3] ||
				size > 16 * 1024 * 1024
			)
				throw new EngineCommandError(
					'output-limit',
					'invalid engine stream frame',
				);
			if (buffered.length < size + 8) break;
			await write(
				buffered[0] === 2 ? stderr : stdout,
				buffered.subarray(8, size + 8),
			);
			buffered = buffered.subarray(size + 8);
		}
	}
	if (buffered.length)
		throw new EngineCommandError(
			'not-running',
			'incomplete engine stream frame',
		);
}

export class SocketTransport {
	version = '';
	private readonly controller = new AbortController();
	close(): void {
		this.controller.abort();
	}
	expectedIdentity?: string;
	constructor(readonly socketPath: string) {
		if (!socketPath.startsWith('/') || socketPath.includes('\0'))
			throw new EngineCommandError(
				'remote-engine',
				'local Unix socket required',
			);
	}
	private path(route: string): string {
		return this.version &&
			!route.startsWith('/version') &&
			!route.startsWith('/v4.0.0/libpod')
			? `/v${this.version}${route}`
			: route;
	}
	async negotiate(): Promise<Record<string, unknown>> {
		const info = await this.json<Record<string, unknown>>('GET', '/version');
		const parse = (v: unknown) =>
			/^1\.\d+$/.test(String(v)) ? Number(String(v).split('.')[1]) : NaN;
		const maximum = parse(info.ApiVersion),
			minimum = parse(info.MinAPIVersion ?? '1.24');
		if (!Number.isFinite(maximum) || maximum < 40 || minimum > 51)
			throw new EngineCommandError(
				'unsupported-engine-mode',
				'engine API version unsupported',
			);
		this.version = `1.${Math.min(maximum, 51)}`;
		return info;
	}
	async json<T>(
		method: string,
		route: string,
		body?: unknown,
		options: EngineCallOptions = {},
	): Promise<T> {
		const response = await this.open(method, route, body, options);
		const chunks: Buffer[] = [];
		let total = 0;
		for await (const chunk of response) {
			total += chunk.length;
			if (total > (options.maxBytes ?? 4 * 1024 * 1024)) {
				response.destroy();
				throw new EngineCommandError(
					'output-limit',
					'engine response exceeded limit',
				);
			}
			chunks.push(Buffer.from(chunk));
		}
		const text = Buffer.concat(chunks).toString('utf8');
		if (!text.trim()) return undefined as T;
		try {
			return JSON.parse(text) as T;
		} catch {
			throw new EngineCommandError('not-running', 'invalid engine response');
		}
	}
	async open(
		method: string,
		route: string,
		body?: unknown,
		options: EngineCallOptions = {},
		hijack = false,
		upload?: Readable,
		persistent = false,
	): Promise<IncomingMessage | Duplex> {
		const signal = options.signal
			? AbortSignal.any([options.signal, this.controller.signal])
			: this.controller.signal;
		if (
			this.expectedIdentity &&
			route !== '/volumes/terminay-engine-identity'
		) {
			try {
				const marker = await this.json<{ Labels?: Record<string, string> }>(
					'GET',
					'/volumes/terminay-engine-identity',
					undefined,
					options,
				);
				if (
					marker.Labels?.['terminay.engine.identity'] !== this.expectedIdentity
				)
					throw new EngineCommandError(
						'engine-changed',
						'engine identity changed',
					);
			} catch (error) {
				if (error instanceof EngineCommandError && error.code === 'not-found')
					throw new EngineCommandError(
						'engine-changed',
						'engine identity missing',
					);
				throw error;
			}
		}
		return new Promise((resolve, reject) => {
			let response: IncomingMessage | undefined;
			let settled = false;
			const data = upload
				? undefined
				: body === undefined
					? undefined
					: JSON.stringify(body);
			const headers: Record<string, string | number> = {
				'Content-Type': upload ? 'application/x-tar' : 'application/json',
			};
			if (data !== undefined)
				headers['Content-Length'] = Buffer.byteLength(data);
			if (hijack) {
				headers.Connection = 'Upgrade';
				headers.Upgrade = 'tcp';
			}
			const req: ClientRequest = request({
				socketPath: this.socketPath,
				path: this.path(route),
				method,
				headers,
				signal,
				agent: false,
			});
			const timer = setTimeout(() => {
				const error = new EngineCommandError(
					'deadline',
					'engine request deadline exceeded',
				);
				response?.destroy(error);
				req.destroy(error);
			}, options.deadlineMs ?? 30_000);
			const clean = () => {
				clearTimeout(timer);
				upload?.destroy();
			};
			req.once('error', (error) => {
				clean();
				if (!settled) reject(socketError(error));
			});
			req.once('upgrade', (res, socket, head) => {
				if (res.statusCode !== 101) {
					socket.destroy();
					clean();
					reject(httpError(res.statusCode ?? 500));
					return;
				}
				settled = true;
				clearTimeout(timer);
				// The request's AbortSignal is retired by Node after upgrade.
				const abort = () => socket.destroy();
				signal.addEventListener('abort', abort, { once: true });
				socket.once('close', () => signal.removeEventListener('abort', abort));
				if (signal.aborted) socket.destroy();
				if (head.length) socket.unshift(head);
				resolve(socket);
			});
			req.once('response', (res) => {
				response = res;
				if ((res.statusCode ?? 500) >= 400) {
					res.destroy();
					clean();
					reject(httpError(res.statusCode ?? 500));
					return;
				}
				settled = true;
				if (persistent) clearTimeout(timer);
				res.once('close', clean);
				res.once('error', () => {});
				resolve(res);
			});
			if (upload) {
				upload.once('error', () =>
					req.destroy(
						new EngineCommandError('not-running', 'image context unavailable'),
					),
				);
				upload.pipe(req);
			} else req.end(data);
		});
	}
	/** Long-lived streams have a connection deadline, but no lifetime deadline. */
	async subscribe(
		method: string,
		route: string,
		body: unknown,
		signal: AbortSignal,
		hijack = false,
	): Promise<IncomingMessage | Duplex> {
		// open's deadline is for response setup; stream lifetime is owned by signal.
		const stream = await this.open(
			method,
			route,
			body,
			{ signal, deadlineMs: 30_000 },
			hijack,
			undefined,
			true,
		);
		return stream;
	}
}
