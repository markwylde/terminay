import { AsyncLocalStorage } from 'node:async_hooks';
import type { JsonValue } from '@terminay/protocol';
import { ServerFileAdapter } from '../fileService/adapter.js';
import { FileCatalog } from '../fileService/catalog.js';
import { ServerFileCatalogAdapter } from '../fileService/catalogAdapter.js';
import { DocumentationCatalog } from '../fileService/documentationCatalog.js';
import { ServerDocumentationCatalogAdapter } from '../fileService/documentationCatalogAdapter.js';
import { MdxRuntime } from '../mdxRuntime/runtime.js';
import { ServerMdxRuntimeAdapter } from '../mdxRuntime/adapter.js';
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

/** SFTP calls must use the in-flight protocol request. Caching the first
 * invoke's AbortSignal on the shared catalog made later listings inherit a
 * disposed deadline from `files.watch.start` or the first `files.list`. */
const invocationContext =
	new AsyncLocalStorage<ProjectEnvironmentInvocationContext>();

/**
 * Maps the fixed file application protocol onto a provider's bounded
 * filesystem service.  The ordinary catalog/content/session adapters remain
 * authoritative for DTO shape, draft ownership, limits, and binary framing;
 * only their storage boundary is remote.
 */
export class RemoteFileProtocol {
	private readonly bundles = new Map<string, Promise<Bundle>>();
	constructor(
		private readonly invokeFilesystem: InvokeFilesystem,
		private readonly projectRoot?: (projectId: string) => string | undefined,
	) {}

	forgetProject(projectId: string): void {
		for (const key of [...this.bundles.keys()]) {
			if (key.split('\0')[2] === projectId) this.bundles.delete(key);
		}
	}

	async invoke(
		operation: string,
		rawInput: unknown,
		context: ProjectEnvironmentInvocationContext,
	): Promise<unknown> {
		return invocationContext.run(context, async () => {
			try {
				const input = protocolInput(rawInput);
				const bundle = await this.bundle(context, input.request.clientId);
				const query = bundle.queries[operation];
				const command = bundle.commands[operation];
				if (query === undefined && command === undefined)
					throw new Error('remote file protocol operation is unavailable');
				const request = protocolRequest(operation, input, context);
				return query === undefined
					? command!(request as CommandRequest)
					: query(request as QueryRequest);
			} catch (error) {
				// Provider execution is already capability-scoped and extension IPC
				// bounds failure text. Preserve that bounded reason at the server
				// protocol boundary: replacing every SFTP/root failure with "query
				// failed" turns a recoverable connection problem into an impossible
				// support case.
				throw remoteFilesystemFailure(error);
			}
		});
	}

	private bundle(
		context: ProjectEnvironmentInvocationContext,
		clientId: string,
	): Promise<Bundle> {
		const requestedRoot = this.projectRoot?.(context.projectId) ?? '';
		const key = `${context.projectEnvironmentId}\0${context.environmentRevision}\0${context.projectId}\0${clientId}\0${requestedRoot}`;
		const existing = this.bundles.get(key);
		if (existing !== undefined) return existing;
		let tracked: Promise<Bundle>;
		tracked = this.createBundle(context).catch((error: unknown) => {
			if (this.bundles.get(key) === tracked) this.bundles.delete(key);
			throw error;
		});
		this.bundles.set(key, tracked);
		return tracked;
	}

	private filesystemCall(
		operation: string,
		input: Record<string, unknown>,
		fallback: ProjectEnvironmentInvocationContext,
	): Promise<unknown> {
		return this.invokeFilesystem(
			operation,
			input,
			invocationContext.getStore() ?? fallback,
		);
	}

	private async createBundle(
		context: ProjectEnvironmentInvocationContext,
	): Promise<Bundle> {
		const requestedRoot = this.projectRoot?.(context.projectId);
		const resolved = asRecord(
			await this.filesystemCall(
				'resolveRoot',
				requestedRoot === undefined || requestedRoot.length === 0
					? {}
					: { root: requestedRoot },
				context,
			),
		);
		const root = stringValue(resolved.root, 'remote root');
		const call = (operation: string, input: Record<string, unknown>) =>
			this.filesystemCall(operation, { root, ...input }, context);
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
		const documentation = new ServerDocumentationCatalogAdapter({
			serverId: 'remote-runtime',
			projects: new Map([[context.projectId, { projectId: context.projectId, catalog: new DocumentationCatalog(resolver, storage) }]]),
		}).operations();
		const mdxRuntime = new ServerMdxRuntimeAdapter({
			serverId: 'remote-runtime',
			projects: new Map([[context.projectId, { projectId: context.projectId, runtime: new MdxRuntime({ projectId: context.projectId, resolver, storage }) }]]),
		}).operations();
		const sessions = new ServerFileAdapter({
			serverId: 'remote-runtime',
			projects,
		}).operations();
		return {
			queries: { ...catalog.queries, ...content.queries, ...documentation.queries, ...mdxRuntime.queries, ...sessions.queries },
			commands: {
				...catalog.commands,
				...content.commands,
				...mdxRuntime.commands, ...sessions.commands,
			},
		};
	}
}

function remoteFilesystemFailure(error: unknown): Error & { readonly code: 'unavailable'; readonly retryable: true } {
	const message = error instanceof Error ? error.message : 'remote filesystem request failed';
	return Object.assign(
		new Error(`Remote filesystem is unavailable: ${message.replace(/[\r\n]/gu, ' ').slice(0, 1_000)}`),
		{ code: 'unavailable' as const, retryable: true as const },
	);
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
