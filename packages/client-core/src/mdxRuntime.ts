import type { JsonValue } from '@terminay/protocol';
import type {
	BinaryQueryTransport,
	QueryCommandTransport,
} from './queryCommand.js';
import type { QueryOptions } from './types.js';

export const MDX_RUNTIME_OPERATIONS = Object.freeze({
	compile: 'mdx.compile',
	resource: 'mdx.resource',
	dispose: 'mdx.dispose',
} as const);
export interface MdxRuntimeResourceDescriptor {
	readonly resourceId: string;
	readonly mimeType: string;
	readonly totalLength: number;
}
export interface MdxCompiledDocument {
	readonly runtimeId: string;
	readonly revision: string;
	readonly entryResourceId: string;
	readonly entryPath: string;
	readonly dependencies: readonly string[];
	readonly resources: readonly MdxRuntimeResourceDescriptor[];
	readonly code: Uint8Array;
}
export interface MdxRuntimeResource {
	readonly runtimeId: string;
	readonly resourceId: string;
	readonly offset: number;
	readonly totalLength: number;
	readonly mimeType: string;
	readonly bytes: Uint8Array;
}
export class MdxRuntimeClient {
	private readonly owned = new Map<string, string>();
	constructor(
		private readonly transport: BinaryQueryTransport & QueryCommandTransport,
	) {}
	async compile(
		projectId: string,
		path: string,
		options: QueryOptions = {},
	): Promise<MdxCompiledDocument> {
		const response = await this.transport.queryWithBody<JsonValue>(
			MDX_RUNTIME_OPERATIONS.compile,
			{ projectId, path },
			options,
		);
		const result = record(response.result);
		const compiled = Object.freeze({
			runtimeId: text(result.runtimeId),
			revision: text(result.revision),
			entryResourceId: text(result.entryResourceId),
			entryPath: pathValue(result.entryPath),
			dependencies: Object.freeze(array(result.dependencies).map(text)),
			resources: Object.freeze(array(result.resources).map(resource)),
			code: response.body,
		});
		this.owned.set(compiled.runtimeId, projectId);
		return compiled;
	}
	async resource(
		projectId: string,
		runtimeId: string,
		resourceId: string,
		offset: number,
		length: number,
		options: QueryOptions = {},
	): Promise<MdxRuntimeResource> {
		const response = await this.transport.queryWithBody<JsonValue>(
			MDX_RUNTIME_OPERATIONS.resource,
			{ projectId, runtimeId, resourceId, offset, length },
			options,
		);
		const result = record(response.result);
		const value = Object.freeze({
			runtimeId: text(result.runtimeId),
			resourceId: text(result.resourceId),
			offset: integer(result.offset),
			totalLength: integer(result.totalLength),
			mimeType: text(result.mimeType),
			bytes: response.body,
		});
		if (
			value.runtimeId !== runtimeId ||
			value.resourceId !== resourceId ||
			value.offset !== offset ||
			value.bytes.byteLength > length ||
			value.offset + value.bytes.byteLength > value.totalLength
		)
			throw new TypeError('MDX resource range is not contiguous');
		return value;
	}
	async dispose(projectId: string, runtimeId: string): Promise<void> {
		await this.transport.command(MDX_RUNTIME_OPERATIONS.dispose, {
			projectId,
			runtimeId,
		});
		this.owned.delete(runtimeId);
	}
	async disposeAll(): Promise<void> {
		const entries = [...this.owned];
		this.owned.clear();
		await Promise.all(
			entries.map(([runtimeId, projectId]) =>
				this.transport
					.command(MDX_RUNTIME_OPERATIONS.dispose, { projectId, runtimeId })
					.catch(() => undefined),
			),
		);
	}
}
function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('MDX response is invalid');
	return value as Record<string, unknown>;
}
function text(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > 4096)
		throw new TypeError('MDX response text is invalid');
	return value;
}
function pathValue(value: unknown): string {
	const path = text(value);
	if (
		path.startsWith('/') ||
		path.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new TypeError('MDX response path is invalid');
	return path;
}
function array(value: unknown): readonly unknown[] {
	if (!Array.isArray(value) || value.length > 256)
		throw new TypeError('MDX dependency list is invalid');
	return value;
}
function integer(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw new TypeError('MDX response offset is invalid');
	return value as number;
}
function resource(value: unknown): MdxRuntimeResourceDescriptor {
	const item = record(value);
	return Object.freeze({
		resourceId: text(item.resourceId),
		mimeType: text(item.mimeType),
		totalLength: integer(item.totalLength),
	});
}
