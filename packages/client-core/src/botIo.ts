import {
	type BotDesktopMode,
	type BotFileEntry,
	type BotFileListing,
	type BotIoHandle,
	botEnvironmentId,
	botStreamGeneration,
	type JsonValue,
	BOT_IO_OPERATIONS as op,
} from '@terminay/protocol';
import type {
	BinaryCommandTransport,
	BinaryQueryTransport,
} from './queryCommand.js';
import type { CommandOptions, QueryOptions } from './types.js';
export type BotIoTransport = BinaryCommandTransport & BinaryQueryTransport;

/** A pull is one credit. No timer or background read runs when unused. */
export class BotByteStreamClient {
	private closed = false;
	constructor(
		private readonly transport: BotIoTransport,
		readonly handle: BotIoHandle,
	) {}
	async *read(options: QueryOptions = {}): AsyncIterable<Uint8Array> {
		try {
			while (!this.closed) {
				const { result, body } = await this.transport.queryWithBody(
					op.read,
					{ ...this.handle },
					options,
				);
				if (
					!result ||
					typeof result !== 'object' ||
					Array.isArray(result) ||
					typeof result.done !== 'boolean' ||
					body.length > 1024 * 1024
				)
					throw new TypeError('invalid bot stream response');
				if (result.done) {
					this.closed = true;
					return;
				}
				yield body;
			}
		} finally {
			await this.close();
		}
	}
	async write(bytes: Uint8Array, options: CommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('bot stream closed');
		if (bytes.length > 1024 * 1024)
			throw new RangeError('bot stream chunk too large');
		await this.transport.commandWithBody(
			op.write,
			{ ...this.handle },
			bytes,
			options,
		);
	}
	async finish(options: CommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('bot stream closed');
		await this.transport.command(op.finish, { ...this.handle }, options);
		this.closed = true;
	}
	async resize(
		cols: number,
		rows: number,
		options: CommandOptions = {},
	): Promise<void> {
		if (this.closed) throw new Error('bot stream closed');
		await this.transport.command(
			op.shellResize,
			{ ...this.handle, cols, rows },
			options,
		);
	}
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.transport
			.command(op.close, { ...this.handle })
			.catch(() => undefined);
	}
}
export class BotFilesClient {
	constructor(
		private readonly transport: BotIoTransport,
		readonly handle: BotIoHandle,
	) {}
	async list(
		path: string,
		options: QueryOptions = {},
	): Promise<BotFileListing> {
		const result = record(
			await this.transport.query(
				op.filesList,
				{ ...this.handle, path },
				options,
			),
		);
		if (
			!Array.isArray(result.entries) ||
			result.entries.length > 10000 ||
			typeof result.truncated !== 'boolean'
		)
			throw new TypeError('invalid bot file listing');
		return { entries: result.entries.map(entry), truncated: result.truncated };
	}
	async stat(path: string, options: QueryOptions = {}): Promise<BotFileEntry> {
		return entry(
			await this.transport.query(
				op.filesStat,
				{ ...this.handle, path },
				options,
			),
		);
	}
	async mkdir(path: string, options: CommandOptions = {}): Promise<void> {
		await this.transport.command(
			op.filesMkdir,
			{ ...this.handle, path },
			options,
		);
	}
	async rename(
		from: string,
		to: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(
			op.filesRename,
			{ ...this.handle, from, to },
			options,
		);
	}
	async delete(path: string, options: CommandOptions = {}): Promise<void> {
		await this.transport.command(
			op.filesDelete,
			{ ...this.handle, path },
			options,
		);
	}
	async *read(
		path: string,
		options: QueryOptions = {},
	): AsyncIterable<Uint8Array> {
		const stream = await this.open(op.filesRead, { path }, options);
		yield* stream.read(options);
	}
	async *downloadFolder(
		path: string,
		options: QueryOptions = {},
	): AsyncIterable<Uint8Array> {
		const stream = await this.open(
			op.filesRead,
			{ path, archive: true },
			options,
		);
		yield* stream.read(options);
	}
	async write(
		path: string,
		size: number,
		chunks: AsyncIterable<Uint8Array>,
		options: CommandOptions = {},
	): Promise<void> {
		if (!Number.isSafeInteger(size) || size < 0 || size > 1024 ** 3)
			throw new RangeError('invalid bot upload size');
		const stream = await this.open(op.filesWrite, { path, size }, options);
		let written = 0;
		try {
			for await (const chunk of chunks) {
				if (chunk.length > 1024 * 1024 || written + chunk.length > size)
					throw new RangeError('invalid bot upload chunk');
				written += chunk.length;
				await stream.write(chunk, options);
			}
			if (written !== size) throw new RangeError('incomplete bot upload');
			await stream.finish(options);
		} finally {
			await stream.close();
		}
	}
	async watch(
		paths: readonly string[],
		changed: () => void,
		options: CommandOptions = {},
	): Promise<() => void> {
		const stream = await this.open(
			op.filesWatch,
			{ paths: [...paths] },
			options,
		);
		let closed = false;
		void (async () => {
			try {
				for await (const _chunk of stream.read(options)) {
					if (!closed) changed();
				}
			} catch {
				/* transport resync/authority owner closes the view */
			}
		})();
		return () => {
			closed = true;
			void stream.close();
		};
	}
	async close(): Promise<void> {
		await this.transport
			.command(op.close, { ...this.handle })
			.catch(() => undefined);
	}
	private async open(
		operation: string,
		fields: Record<string, JsonValue>,
		options: CommandOptions,
	): Promise<BotByteStreamClient> {
		return new BotByteStreamClient(
			this.transport,
			handle(
				await this.transport.command(
					operation,
					{ ...this.handle, ...fields },
					options,
				),
			),
		);
	}
}
export class BotIoClient {
	private generation = 0;
	constructor(private readonly transport: BotIoTransport) {}
	async files(
		botId: string,
		options: CommandOptions = {},
	): Promise<BotFilesClient> {
		return new BotFilesClient(
			this.transport,
			handle(
				await this.transport.command(
					op.filesOpen,
					{ botId: botEnvironmentId(botId), generation: ++this.generation },
					options,
				),
			),
		);
	}
	async desktop(
		botId: string,
		generation: number,
		mode: BotDesktopMode = 'view-only',
		thumbnail = false,
		options: CommandOptions = {},
	): Promise<BotByteStreamClient> {
		return new BotByteStreamClient(
			this.transport,
			handle(
				await this.transport.command(
					op.desktopOpen,
					{
						botId: botEnvironmentId(botId),
						generation: botStreamGeneration(generation),
						mode,
						thumbnail,
					},
					options,
				),
			),
		);
	}
	async shell(
		botId: string,
		generation: number,
		cols: number,
		rows: number,
		options: CommandOptions = {},
		purpose: 'shell' | 'sign-in' = 'shell',
	): Promise<BotByteStreamClient> {
		return new BotByteStreamClient(
			this.transport,
			handle(
				await this.transport.command(
					op.shellOpen,
					{
						botId: botEnvironmentId(botId),
						generation: botStreamGeneration(generation),
						cols,
						rows,
						...(purpose === 'sign-in' ? { purpose } : {}),
					},
					options,
				),
			),
		);
	}
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('invalid bot result');
	return value as Record<string, unknown>;
}
function handle(value: unknown): BotIoHandle {
	const r = record(value);
	if (typeof r.streamId !== 'string' || r.streamId.length > 256)
		throw new TypeError('invalid bot stream id');
	return {
		streamId: r.streamId,
		botId: botEnvironmentId(r.botId),
		generation: botStreamGeneration(r.generation),
	};
}
function entry(value: unknown): BotFileEntry {
	const r = record(value);
	if (
		typeof r.name !== 'string' ||
		r.name.length > 255 ||
		r.name.includes('/') ||
		!['file', 'dir', 'link', 'credential-link', 'other'].includes(
			String(r.kind),
		) ||
		typeof r.size !== 'number' ||
		!Number.isSafeInteger(r.size) ||
		r.size < 0 ||
		typeof r.mtime !== 'number' ||
		!Number.isFinite(r.mtime)
	)
		throw new TypeError('invalid bot file entry');
	return {
		name: r.name,
		kind: r.kind as BotFileEntry['kind'],
		size: r.size,
		mtime: r.mtime,
	};
}
