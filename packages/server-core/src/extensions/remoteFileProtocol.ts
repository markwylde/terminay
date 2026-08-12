import type { JsonValue } from '@terminay/protocol';
import { ServerFileAdapter } from '../fileService/adapter.js';
import { FileCatalog } from '../fileService/catalog.js';
import { ServerFileCatalogAdapter } from '../fileService/catalogAdapter.js';
import { ServerFileContentAdapter } from '../fileService/contentAdapter.js';
import { FileContentStreamService } from '../fileService/contentStream.js';
import { CanonicalProjectPathResolver } from '../fileService/pathResolver.js';
import type { ProjectEnvironmentInvocationContext } from '../projectEnvironment/registry.js';
import type {
	CommandHandler,
	CommandRequest,
	QueryHandler,
	QueryRequest,
} from '../types.js';

type InvokeFilesystem = (
	operation: string,
	input: Record<string, unknown>,
	context: ProjectEnvironmentInvocationContext,
) => Promise<unknown>;
type ProtocolInput = {
	payload: JsonValue;
	body?: string;
	request: {
		clientId: string;
		authScope: 'read' | 'write' | 'admin';
		expectedRevision?: number;
	};
};
type RemoteMetadata = {
	path?: string;
	size: number;
	mode: number;
	mtimeMs: number;
	atimeMs: number;
	type: 'directory' | 'symlink' | 'file';
};
type RemoteRead = {
	path: string;
	data: string;
	encoding: 'base64';
	metadata: RemoteMetadata;
};
type RemoteList = {
	path: string;
	entries: readonly ({ name: string; path: string } & RemoteMetadata)[];
};

/**
 * Maps the fixed file application protocol onto a provider's bounded
 * filesystem service.  The ordinary catalog/content/session adapters remain
 * authoritative for DTO shape, draft ownership, limits, and binary framing;
 * only their storage boundary is remote.
 */
export class RemoteFileProtocol {
	private readonly bundles = new Map<string, Promise<Bundle>>();
	constructor(private readonly invokeFilesystem: InvokeFilesystem) {}

	async invoke(
		operation: string,
		rawInput: unknown,
		context: ProjectEnvironmentInvocationContext,
	): Promise<unknown> {
		const input = protocolInput(rawInput);
		const bundle = await this.bundle(context);
		const query = bundle.queries[operation];
		const command = bundle.commands[operation];
		if (query === undefined && command === undefined)
			throw new Error('remote file protocol operation is unavailable');
		const request = protocolRequest(operation, input, context);
		return query === undefined
			? command!(request as CommandRequest)
			: query(request as QueryRequest);
	}

	private bundle(
		context: ProjectEnvironmentInvocationContext,
	): Promise<Bundle> {
		const key = `${context.projectEnvironmentId}\0${context.environmentRevision}\0${context.projectId}`;
		let value = this.bundles.get(key);
		if (value === undefined) {
			value = this.createBundle(context);
			this.bundles.set(key, value);
		}
		return value;
	}

	private async createBundle(
		context: ProjectEnvironmentInvocationContext,
	): Promise<Bundle> {
		const resolved = asRecord(
			await this.invokeFilesystem('resolveRoot', {}, context),
		);
		const root = stringValue(resolved.root, 'remote root');
		const call = (operation: string, input: Record<string, unknown>) =>
			this.invokeFilesystem(operation, input, context);
		const storage = {
			realpath: async (path: string) =>
				stringValue(
					asRecord(await call('realpath', { path })).path,
					'remote path',
				),
			stat: async (path: string) =>
				pathStat(asMetadata(await call('stat', { path }))),
			readDirectory: async (path: string) =>
				asList(await call('list', { path })).entries.map((entry) => ({
					name: entry.name,
					...pathStat(entry),
				})),
			readRange: async (path: string, offset: number, length: number) =>
				readChunks(call, path, offset, length),
			atomicWrite: async (path: string, bytes: Uint8Array) => {
				await call('write', {
					path,
					data: Buffer.from(bytes).toString('base64'),
					encoding: 'base64',
				});
			},
			makeDirectory: async (path: string) => {
				await call('createDirectory', { path });
			},
			rename: async (path: string, destination: string) => {
				await call('rename', { path, destination });
			},
			remove: async (path: string) => {
				await call('remove', { path });
			},
		};
		const resolver = new CanonicalProjectPathResolver(root, storage);
		const project = { projectId: context.projectId, resolver, storage };
		const projects = new Map([[context.projectId, project]]);
		const catalog = new ServerFileCatalogAdapter({
			serverId: 'remote-runtime',
			projects: new Map([
				[
					context.projectId,
					{
						projectId: context.projectId,
						catalog: new FileCatalog(resolver, storage),
					},
				],
			]),
		}).operations();
		const content = new ServerFileContentAdapter({
			serverId: 'remote-runtime',
			projects: new Map([
				[
					context.projectId,
					{
						projectId: context.projectId,
						content: new FileContentStreamService(resolver, storage),
					},
				],
			]),
		}).operations();
		const sessions = new ServerFileAdapter({
			serverId: 'remote-runtime',
			projects,
		}).operations();
		return {
			queries: { ...catalog.queries, ...content.queries, ...sessions.queries },
			commands: {
				...catalog.commands,
				...content.commands,
				...sessions.commands,
			},
		};
	}
}

interface Bundle {
	queries: Readonly<Record<string, QueryHandler>>;
	commands: Readonly<Record<string, CommandHandler>>;
}

function protocolInput(value: unknown): ProtocolInput {
	const input = asRecord(value),
		request = asRecord(input.request);
	if (
		!('payload' in input) ||
		typeof request.clientId !== 'string' ||
		!['read', 'write', 'admin'].includes(String(request.authScope))
	)
		throw new TypeError('remote file protocol input is invalid');
	if (
		input.body !== undefined &&
		(typeof input.body !== 'string' ||
			!/^[A-Za-z0-9+/]*={0,2}$/u.test(input.body))
	)
		throw new TypeError('remote file protocol body is invalid');
	return input as unknown as ProtocolInput;
}

function protocolRequest(
	operation: string,
	input: ProtocolInput,
	context: ProjectEnvironmentInvocationContext,
): QueryRequest | CommandRequest {
	return {
		envelope: { id: 'remote-file', operation, payload: input.payload } as never,
		body:
			input.body === undefined
				? new Uint8Array()
				: Buffer.from(input.body, 'base64'),
		context: {
			connectionId: 'remote-file',
			clientId: input.request.clientId,
			authScope: input.request.authScope,
			claims: { projectId: context.projectId },
			signal: context.signal,
			deadline: context.deadline,
			...(input.request.expectedRevision === undefined
				? {}
				: { expectedRevision: input.request.expectedRevision }),
		},
	};
}

function pathStat(value: RemoteMetadata) {
	return {
		size: value.size,
		mtimeMs: value.mtimeMs,
		mode: value.mode,
		isDirectory: value.type === 'directory',
		isFile: value.type === 'file',
		isSymbolicLink: value.type === 'symlink',
		identity: `${value.size}:${value.mtimeMs}:${value.mode}`,
	};
}
async function readChunks(
	call: (operation: string, input: Record<string, unknown>) => Promise<unknown>,
	path: string,
	offset: number,
	length: number,
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let cursor = offset;
	let remaining = length;
	while (remaining > 0) {
		const requested = Math.min(remaining, 160 * 1024);
		const chunk = decodeRead(
			await call('read', { path, offset: cursor, length: requested }),
		).bytes;
		chunks.push(chunk);
		cursor += chunk.byteLength;
		remaining -= chunk.byteLength;
		if (chunk.byteLength < requested) break;
	}
	const bytes = new Uint8Array(
		chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
	);
	let position = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, position);
		position += chunk.byteLength;
	}
	return bytes;
}
function decodeRead(value: unknown): {
	bytes: Uint8Array;
	metadata: RemoteMetadata;
} {
	const read = asRecord(value) as unknown as RemoteRead;
	if (read.encoding !== 'base64' || typeof read.data !== 'string')
		throw new TypeError('remote read result is invalid');
	return {
		bytes: Buffer.from(read.data, 'base64'),
		metadata: asMetadata(read.metadata),
	};
}
function asMetadata(value: unknown): RemoteMetadata {
	const item = asRecord(value);
	if (
		typeof item.size !== 'number' ||
		typeof item.mode !== 'number' ||
		typeof item.mtimeMs !== 'number' ||
		typeof item.atimeMs !== 'number' ||
		!['directory', 'symlink', 'file'].includes(String(item.type))
	)
		throw new TypeError('remote metadata is invalid');
	return item as unknown as RemoteMetadata;
}
function asList(value: unknown): RemoteList {
	const list = asRecord(value);
	if (typeof list.path !== 'string' || !Array.isArray(list.entries))
		throw new TypeError('remote list result is invalid');
	return {
		path: list.path,
		entries: list.entries.map((entry) => {
			const item = asMetadata(entry);
			const record = asRecord(entry);
			return {
				...item,
				name: stringValue(record.name, 'remote entry name'),
				path: stringValue(record.path, 'remote entry path'),
			};
		}),
	};
}
function asRecord(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('remote filesystem result is invalid');
	return value as Record<string, unknown>;
}
function stringValue(value: unknown, name: string): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 4096 ||
		value.includes('\0')
	)
		throw new TypeError(`${name} is invalid`);
	return value;
}
