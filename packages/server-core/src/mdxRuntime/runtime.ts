import { randomUUID } from 'node:crypto';
import { MdxCompiler } from './compiler.js';
import type { FileCatalogStorage } from '../fileService/catalog.js';
import { CanonicalProjectPathResolver } from '../fileService/pathResolver.js';
import { FileServiceError } from '../fileService/types.js';

export const MDX_RESOURCE_MAX_BYTES = 1024 * 1024;
export interface MdxRuntimeProject {
	readonly projectId: string;
	readonly resolver: CanonicalProjectPathResolver;
	readonly storage: FileCatalogStorage;
}
export interface MdxRuntimeResourceDescriptor {
	readonly resourceId: string;
	readonly mimeType: string;
	readonly totalLength: number;
}
export interface MdxRuntimeCompile {
	readonly runtimeId: string;
	readonly revision: string;
	readonly entryPath: string;
	readonly dependencies: readonly string[];
	readonly resources: readonly MdxRuntimeResourceDescriptor[];
	readonly code: Uint8Array;
}
export interface MdxRuntimeResource {
	readonly bytes: Uint8Array;
	readonly mimeType: string;
	readonly totalLength: number;
	readonly offset: number;
}

/** Per-project disposable compilation ownership. Runtime ids are opaque and
 * client-scoped at the protocol adapter; this class never exposes host paths. */
export class MdxRuntime {
	private readonly compiled = new Map<
		string,
		MdxRuntimeCompile & {
			readonly resourceBytes: ReadonlyMap<
				string,
				{ readonly bytes: Uint8Array; readonly mimeType: string }
			>;
		}
	>();
	constructor(private readonly project: MdxRuntimeProject) {}
	async compile(
		entryPath: string,
		signal?: AbortSignal,
	): Promise<MdxRuntimeCompile> {
		if (signal?.aborted) throw signal.reason;
		const output = await new MdxCompiler(
			this.project.resolver,
			this.project.storage,
		).compile(entryPath, signal);
		if (signal?.aborted) throw signal.reason;
		const resourceBytes = new Map(
			output.resources.map((resource) => [
				resource.resourceId,
				{ bytes: resource.bytes, mimeType: resource.mimeType },
			]),
		);
		const result = Object.freeze({
			runtimeId: randomUUID(),
			revision: `${Date.now()}:${output.code.byteLength}`,
			entryPath: output.entryPath,
			dependencies: output.dependencies,
			resources: Object.freeze(
				output.resources.map((resource) =>
					Object.freeze({
						resourceId: resource.resourceId,
						mimeType: resource.mimeType,
						totalLength: resource.bytes.byteLength,
					}),
				),
			),
			code: output.code,
			resourceBytes,
		});
		this.compiled.set(result.runtimeId, result);
		return result;
	}
	async resource(
		runtimeId: string,
		resourceId: string,
		offset: number,
		length: number,
		signal?: AbortSignal,
	): Promise<MdxRuntimeResource> {
		if (signal?.aborted) throw signal.reason;
		if (!this.compiled.has(runtimeId))
			throw new FileServiceError(
				'path_missing',
				'MDX runtime is no longer available.',
			);
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			!Number.isSafeInteger(length) ||
			length < 1 ||
			length > MDX_RESOURCE_MAX_BYTES
		)
			throw new FileServiceError(
				'invalid_path',
				'MDX resource request is invalid.',
			);
		const result = this.compiled.get(runtimeId)!;
		if (signal?.aborted) throw signal.reason;
		const resource =
			resourceId === 'entry'
				? { bytes: result.code, mimeType: 'text/javascript' }
				: result.resourceBytes.get(resourceId);
		if (resource === undefined)
			throw new FileServiceError(
				'path_missing',
				'MDX resource is unavailable.',
			);
		const bytes = resource.bytes.slice(
			offset,
			Math.min(resource.bytes.byteLength, offset + length),
		);
		return Object.freeze({
			bytes,
			mimeType: resource.mimeType,
			totalLength: resource.bytes.byteLength,
			offset,
		});
	}
	dispose(runtimeId: string): void {
		this.compiled.delete(runtimeId);
	}
	disposeAll(): void {
		this.compiled.clear();
	}
}
