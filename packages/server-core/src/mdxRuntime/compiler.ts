import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@mdx-js/mdx';
import { build } from 'esbuild';
import type { FileCatalogStorage } from '../fileService/catalog.js';
import { CanonicalProjectPathResolver } from '../fileService/pathResolver.js';
import { FileServiceError } from '../fileService/types.js';

export const MDX_COMPILER_LIMITS = Object.freeze({
	maxSourceBytes: 2 * 1024 * 1024,
	maxOutputBytes: 8 * 1024 * 1024,
	maxDependencies: 256,
	maxDepth: 32,
	timeoutMs: 15_000,
});
export interface MdxCompileResource {
	readonly resourceId: string;
	readonly mimeType: string;
	readonly bytes: Uint8Array;
}
export interface MdxCompileResult {
	readonly entryPath: string;
	readonly code: Uint8Array;
	readonly dependencies: readonly string[];
	readonly resources: readonly MdxCompileResource[];
}

/** Config-free compiler. Every project read is resolved by the environment's
 * canonical resolver; server Node never evaluates the generated bundle. */
export class MdxCompiler {
	constructor(
		private readonly resolver: CanonicalProjectPathResolver,
		private readonly storage: FileCatalogStorage,
	) {}
	async compile(
		entryPath: string,
		signal?: AbortSignal,
	): Promise<MdxCompileResult> {
		configurePackagedEsbuildBinary();
		if (!validPath(entryPath))
			throw new FileServiceError('invalid_path', 'MDX entry path is invalid.');
		const dependencies = new Set<string>();
		const resources = new Map<string, MdxCompileResource>();
		const depthByModule = new Map<string, number>();
		const entry = await this.resolve(entryPath);
		const entryDirectory = entry.slice(0, entry.lastIndexOf('/'));
		const entryBytes = await this.read(entry, signal);
		const entryExtension = entry.split('.').at(-1)?.toLowerCase();
		const entryContents =
			entryExtension === 'mdx' || entryExtension === 'md'
				? String(
						await compile(new TextDecoder().decode(entryBytes), {
							jsx: true,
							outputFormat: 'program',
						}),
					)
				: new TextDecoder().decode(entryBytes);
		// Keep guest-module imports out of the host artifact's static dependency
		// graph. The standalone packager must inspect server imports without
		// mistaking source compiled for the sandbox for server authority.
		const guestImport = ['im', 'port'].join('');
		const bootstrap = `${guestImport} React from 'react';\n${guestImport} { createRoot } from 'react-dom/client';\n${guestImport} Content from 'terminay:entry';\nconst root = document.getElementById('root');\nif (!root) throw new Error('MDX preview root is unavailable');\ncreateRoot(root).render(React.createElement(Content));`;
		let result: Awaited<ReturnType<typeof build>>;
		try {
			result = await withTimeout(
				build({
					stdin: {
						contents: bootstrap,
						resolveDir: entry.slice(0, entry.lastIndexOf('/')),
						sourcefile: 'terminay:bootstrap',
						loader: 'js',
					},
					bundle: true,
					format: 'iife',
					platform: 'browser',
					write: false,
					logLevel: 'silent',
					jsx: 'automatic',
					plugins: [
						{
							name: 'terminay-mdx',
							setup: (api) => {
								api.onResolve({ filter: /^terminay:entry$/ }, () => ({
									path: 'terminay:entry',
									namespace: 'terminay-entry',
								}));
								api.onLoad(
									{ filter: /^terminay:entry$/, namespace: 'terminay-entry' },
									() => ({
										contents: entryContents,
										loader: loader(entryExtension),
									}),
								);
								api.onResolve({ filter: /.*/ }, async (args) => {
									if (signal?.aborted)
										return {
											errors: [{ text: 'MDX compilation was cancelled.' }],
										};
									if (isBlockedImport(args.path))
										return {
											errors: [
												{
													text: `Node/Electron imports are blocked: ${args.path}`,
												},
											],
										};
									try {
										const base =
											args.importer === '<stdin>' ||
											args.importer === 'terminay:entry'
												? entryDirectory
												: args.importer.slice(
														0,
														args.importer.lastIndexOf('/') + 1,
													);
										const path = args.path.startsWith('.')
											? await this.resolve(
													normalizeRelativeImport(base, args.path),
												)
											: await this.resolvePackage(args.path);
										const depth =
											args.importer === '<stdin>'
												? 1
												: (depthByModule.get(args.importer) ?? 0) + 1;
										if (depth > MDX_COMPILER_LIMITS.maxDepth)
											return {
												errors: [
													{ text: 'MDX dependency depth limit exceeded.' },
												],
											};
										depthByModule.set(path, depth);
										dependencies.add(path);
										return dependencies.size >
											MDX_COMPILER_LIMITS.maxDependencies
											? { errors: [{ text: 'MDX dependency limit exceeded.' }] }
											: { path, namespace: 'terminay-project' };
									} catch (error) {
										return {
											errors: [
												{
													text:
														error instanceof Error
															? error.message
															: 'MDX import failed.',
												},
											],
										};
									}
								});
								api.onLoad(
									{ filter: /.*/, namespace: 'terminay-project' },
									async (args) => {
										try {
											const bytes = await this.read(args.path, signal);
											const ext = args.path.split('.').at(-1)?.toLowerCase();
											if (ext === 'md' || ext === 'mdx')
												return {
													contents: String(
														await compile(new TextDecoder().decode(bytes), {
															jsx: true,
															outputFormat: 'program',
														}),
													),
													loader: 'jsx',
												};
											if (ext === 'css')
												return {
													contents: cssModule(new TextDecoder().decode(bytes)),
													loader: 'js',
												};
											if (assetExtension(ext)) {
												const resourceId = `asset-${resources.size + 1}`;
												resources.set(resourceId, {
													resourceId,
													mimeType: mimeType(ext),
													bytes,
												});
												return {
													contents: `export default "__terminay_resource_${resourceId}__";`,
													loader: 'js',
												};
											}
											return {
												contents: new TextDecoder().decode(bytes),
												loader: loader(ext),
											};
										} catch (error) {
											return {
												errors: [
													{
														text:
															error instanceof Error
																? error.message
																: 'MDX source failed.',
													},
												],
											};
										}
									},
								);
							},
						},
					],
				}),
				signal,
			);
		} catch (error) {
			if (error instanceof FileServiceError) throw error;
			throw new FileServiceError(
				'invalid_path',
				`MDX compilation failed: ${boundedCompilerError(error)}`,
			);
		}
		const code = result.outputFiles?.find(
			(file) => !file.path.endsWith('.css'),
		)?.contents;
		if (
			code === undefined ||
			code.byteLength > MDX_COMPILER_LIMITS.maxOutputBytes
		)
			throw new FileServiceError(
				'invalid_path',
				'Compiled MDX output exceeds the allowed size.',
			);
		return Object.freeze({
			entryPath,
			code: new Uint8Array(code),
			dependencies: Object.freeze([...dependencies]),
			resources: Object.freeze([...resources.values()]),
		});
	}
	private async resolve(path: string): Promise<string> {
		for (const candidate of /\.[a-z0-9]+$/iu.test(path)
			? [path]
			: [
					path,
					`${path}.mdx`,
					`${path}.md`,
					`${path}.tsx`,
					`${path}.ts`,
					`${path}.jsx`,
					`${path}.js`,
					`${path}.json`,
				]) {
			try {
				return await this.resolver.resolve(candidate, { requireFile: true });
			} catch (error) {
				if (
					!(error instanceof FileServiceError) ||
					error.code !== 'path_missing'
				)
					throw error;
			}
		}
		throw new FileServiceError(
			'path_missing',
			'Imported MDX module does not exist.',
		);
	}
	private async resolvePackage(specifier: string): Promise<string> {
		if (
			!/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[a-z0-9][a-z0-9._/-]*)?$/iu.test(
				specifier,
			)
		)
			throw new FileServiceError(
				'invalid_path',
				'MDX package import is invalid.',
			);
		const parts = specifier.startsWith('@')
			? specifier.split('/').slice(0, 2)
			: specifier.split('/').slice(0, 1);
		const packageRoot = `node_modules/${parts.join('/')}`;
		const suffix = specifier.slice(parts.join('/').length).replace(/^\//u, '');
		if (suffix) return this.resolve(`${packageRoot}/${suffix}`);
		const manifestPath = await this.resolver.resolve(
			`${packageRoot}/package.json`,
			{ requireFile: true },
		);
		const manifest = JSON.parse(
			new TextDecoder().decode(await this.read(manifestPath)),
		) as Record<string, unknown>;
		const entry =
			typeof manifest.browser === 'string'
				? manifest.browser
				: typeof manifest.module === 'string'
					? manifest.module
					: typeof manifest.main === 'string'
						? manifest.main
						: 'index.js';
		if (entry.startsWith('/') || entry.includes('..'))
			throw new FileServiceError(
				'path_escape',
				'MDX package entry is invalid.',
			);
		return this.resolve(`${packageRoot}/${entry}`);
	}
	private async read(path: string, signal?: AbortSignal): Promise<Uint8Array> {
		if (this.storage.readRange === undefined)
			throw new FileServiceError(
				'invalid_path',
				'Project does not provide source reads.',
			);
		const bytes = await this.storage.readRange(
			path,
			0,
			MDX_COMPILER_LIMITS.maxSourceBytes + 1,
			signal,
		);
		if (bytes.byteLength > MDX_COMPILER_LIMITS.maxSourceBytes)
			throw new FileServiceError(
				'invalid_path',
				'MDX source exceeds the allowed size.',
			);
		return bytes;
	}
}

function boundedCompilerError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.replaceAll(/\s+/gu, ' ').trim().slice(0, 512) ||
		'unknown compiler error'
	);
}

function configurePackagedEsbuildBinary(): void {
	if (process.env.ESBUILD_BINARY_PATH) return;
	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
		.resourcesPath;
	if (typeof resourcesPath !== 'string' || resourcesPath.length === 0) return;
	const platformBinary = esbuildPlatformBinary();
	if (platformBinary === undefined) return;
	const candidate = join(
		resourcesPath,
		'esbuild',
		platformBinary.packageName,
		...platformBinary.relativePath,
	);
	if (existsSync(candidate)) process.env.ESBUILD_BINARY_PATH = candidate;
}

function esbuildPlatformBinary():
	| { readonly packageName: string; readonly relativePath: readonly string[] }
	| undefined {
	const key = `${process.platform}-${process.arch}`;
	const packageName = (
		{
			'darwin-arm64': 'darwin-arm64',
			'darwin-x64': 'darwin-x64',
			'linux-arm64': 'linux-arm64',
			'linux-x64': 'linux-x64',
			'win32-arm64': 'win32-arm64',
			'win32-ia32': 'win32-ia32',
			'win32-x64': 'win32-x64',
		} as Readonly<Record<string, string>>
	)[key];
	return packageName === undefined
		? undefined
		: {
				packageName,
				relativePath:
					process.platform === 'win32' ? ['esbuild.exe'] : ['bin', 'esbuild'],
			};
}
function loader(
	extension: string | undefined,
): 'tsx' | 'ts' | 'jsx' | 'json' | 'js' {
	return extension === 'tsx'
		? 'tsx'
		: extension === 'ts'
			? 'ts'
			: extension === 'jsx' || extension === 'mdx' || extension === 'md'
				? 'jsx'
				: extension === 'json'
					? 'json'
					: 'js';
}
function assetExtension(extension: string | undefined): boolean {
	return (
		extension !== undefined &&
		/^(?:png|jpe?g|gif|webp|svg|avif|ico|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf)$/u.test(
			extension,
		)
	);
}
function mimeType(extension: string | undefined): string {
	return (
		(
			{
				png: 'image/png',
				jpg: 'image/jpeg',
				jpeg: 'image/jpeg',
				gif: 'image/gif',
				webp: 'image/webp',
				svg: 'image/svg+xml',
				avif: 'image/avif',
				ico: 'image/x-icon',
				mp4: 'video/mp4',
				webm: 'video/webm',
				mp3: 'audio/mpeg',
				wav: 'audio/wav',
				ogg: 'audio/ogg',
				woff: 'font/woff',
				woff2: 'font/woff2',
				ttf: 'font/ttf',
				otf: 'font/otf',
			} as Record<string, string>
		)[extension ?? ''] ?? 'application/octet-stream'
	);
}
function cssModule(css: string): string {
	return `const css=${JSON.stringify(css)};const style=document.createElement('style');style.textContent=css;document.head.append(style);export default css;`;
}
function isBlockedImport(value: string): boolean {
	return (
		value.startsWith('node:') ||
		/^(?:electron|fs|path|child_process|worker_threads|module|process|os|net|tls|http|https|zlib|crypto|stream|buffer|url|util|vm|assert)(?:\/|$)/u.test(
			value,
		)
	);
}
function normalizeRelativeImport(base: string, request: string): string {
	const absolute = base.startsWith('/');
	const parts: string[] = [];
	for (const segment of `${base}/${request}`.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') {
			if (parts.length === 0)
				throw new FileServiceError(
					'path_escape',
					'MDX import escapes its project root.',
				);
			parts.pop();
			continue;
		}
		parts.push(segment);
	}
	return `${absolute ? '/' : ''}${parts.join('/')}`;
}
async function withTimeout<T>(
	operation: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new FileServiceError('invalid_path', 'MDX compilation timed out.'),
				),
			MDX_COMPILER_LIMITS.timeoutMs,
		);
	});
	const aborted =
		signal === undefined
			? undefined
			: new Promise<never>((_, reject) =>
					signal.addEventListener(
						'abort',
						() =>
							reject(
								signal.reason ?? new DOMException('Aborted', 'AbortError'),
							),
						{ once: true },
					),
				);
	try {
		return await Promise.race([
			operation,
			timeout,
			...(aborted === undefined ? [] : [aborted]),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
function validPath(value: string): boolean {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		!value.startsWith('/') &&
		!value.includes('\\') &&
		!value.split('/').some((part) => !part || part === '.' || part === '..')
	);
}
