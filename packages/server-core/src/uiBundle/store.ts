import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { UiBundleError, verifyUiBundle } from "./manifest.js";
import type {
	UiBundleAssetReader,
	UiBundleLimits,
	VerifiedUiBundle,
} from "./types.js";

const POINTER_SCHEMA_VERSION = 1;
const POINTER_FILE = "current.json";
const BUNDLE_DIRECTORY = /^[A-Za-z0-9_-]{8,128}$/u;

export interface UiBundleStoreOptions extends UiBundleLimits {
	/** Absolute directory containing versioned bundle namespaces. */
	readonly rootDirectory: string;
	/** Bound each untrusted remote asset read during staged verification. */
	readonly sourceReadTimeoutMs?: number;
}

export interface UiBundleInstallSource {
	readonly manifest: unknown;
	readonly read: UiBundleAssetReader["read"];
}

interface CurrentPointer {
	readonly schemaVersion: 1;
	readonly bundleId: string;
}

/**
 * Owns committed server UI bundles at the privileged server boundary.
 *
 * A bundle is fully verified and written under a private staging directory,
 * then renamed into its content-addressed namespace. Only after that succeeds
 * is the small current pointer atomically replaced. A failed install therefore
 * leaves the previous pointer (and every previously committed bundle) intact.
 */
export class UiBundleStore {
	private readonly rootDirectory: string;
	private readonly limits: UiBundleLimits;
	private readonly sourceReadTimeoutMs: number;

	constructor(options: UiBundleStoreOptions) {
		if (
		typeof options.rootDirectory !== "string" ||
			options.rootDirectory.length === 0 ||
			options.rootDirectory.length > 4096 ||
			!isAbsolute(options.rootDirectory)
		) {
			throw new TypeError("UI bundle store root must be absolute");
		}
		this.rootDirectory = resolve(options.rootDirectory);
		this.sourceReadTimeoutMs = positiveTimeout(options.sourceReadTimeoutMs ?? 30_000);
		this.limits = {
			...(options.maxAssets === undefined ? {} : { maxAssets: options.maxAssets }),
			...(options.maxAssetBytes === undefined ? {} : { maxAssetBytes: options.maxAssetBytes }),
			...(options.maxTotalBytes === undefined ? {} : { maxTotalBytes: options.maxTotalBytes }),
			...(options.maxPathBytes === undefined ? {} : { maxPathBytes: options.maxPathBytes }),
			...(options.maxContentTypeBytes === undefined ? {} : { maxContentTypeBytes: options.maxContentTypeBytes }),
		};
	}

	get root(): string {
		return this.rootDirectory;
	}

	/** Return the committed bundle, or undefined before the first install. */
	async open(): Promise<VerifiedUiBundle | undefined> {
		let pointer: CurrentPointer;
		try {
			pointer = parsePointer(JSON.parse(await readFile(join(this.rootDirectory, POINTER_FILE), "utf8")));
		} catch (error) {
			if (isMissing(error)) return undefined;
			if (error instanceof UiBundleError) throw error;
			throw new UiBundleError("integrity", "committed UI bundle pointer is invalid");
		}
		try {
			return await this.readCommitted(pointer.bundleId);
		} catch (error) {
			if (error instanceof UiBundleError) throw error;
			throw new UiBundleError("integrity", "committed UI bundle is unavailable");
		}
	}

	/**
	 * Verify and atomically commit a complete bundle. The source may be remote
	 * or another local bundle, but it is never allowed to control a filesystem
	 * path; only verified manifest paths are materialized below the staging root.
	 */
	async install(source: UiBundleInstallSource): Promise<VerifiedUiBundle> {
		const verified = await verifyUiBundle(source.manifest, {
			read: (assetPath) => readWithTimeout(source.read, assetPath, this.sourceReadTimeoutMs),
		}, this.limits);
		await mkdir(this.rootDirectory, { recursive: true });
		const stagingDirectory = join(this.rootDirectory, `.staging-${randomUUID()}`);
		const bundleDirectory = join(this.rootDirectory, verified.manifest.bundleId);
		try {
			await mkdir(stagingDirectory, { recursive: true });
			await writeFile(
				join(stagingDirectory, "manifest.json"),
				JSON.stringify(verified.manifest),
				{ encoding: "utf8", mode: 0o600 },
			);
			for (const asset of verified.manifest.assets) {
				const relativeAsset = asset.path.slice(`/remote-app/${verified.manifest.bundleId}/`.length);
				const destination = safeChild(stagingDirectory, relativeAsset);
				if (destination === null) throw new UiBundleError("validation", "UI bundle asset path escapes staging root");
				await mkdir(resolve(destination, ".."), { recursive: true });
				await writeFile(destination, verified.read(asset.path), { mode: 0o600 });
			}
			try {
				await rename(stagingDirectory, bundleDirectory);
			} catch (error) {
				if (!isAlreadyExists(error)) throw error;
				// Content-addressed bundle ids make an existing namespace safe to
				// reuse; validate it before moving the current pointer.
				await this.readCommitted(verified.manifest.bundleId);
				await rm(stagingDirectory, { recursive: true, force: true });
			}
			await atomicWrite(
				join(this.rootDirectory, POINTER_FILE),
				JSON.stringify({ schemaVersion: POINTER_SCHEMA_VERSION, bundleId: verified.manifest.bundleId }),
			);
			// The pointer is the commit point. Only now may superseded immutable
			// caches be removed; a failed verification or materialization above
			// therefore cannot destroy the bundle that is still current.
			await this.pruneSupersededBundles(verified.manifest.bundleId);
			return this.readCommitted(verified.manifest.bundleId);
		} catch (error) {
			await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
			throw error;
		}
	}

	private async readCommitted(bundleId: string): Promise<VerifiedUiBundle> {
		const bundleDirectory = join(this.rootDirectory, bundleId);
		const raw = JSON.parse(await readRegularTextFile(join(bundleDirectory, "manifest.json"), "committed UI bundle manifest")) as unknown;
		return verifyUiBundle(
			raw,
			{
				read: async (assetPath) => {
					const prefix = `/remote-app/${bundleId}/`;
					if (!assetPath.startsWith(prefix)) throw new UiBundleError("validation", "UI bundle path is outside its committed namespace");
					const filePath = safeChild(bundleDirectory, assetPath.slice(prefix.length));
					if (filePath === null) throw new UiBundleError("validation", "UI bundle asset path escapes committed root");
					return readRegularBinaryFile(filePath, "committed UI bundle asset");
				},
			},
			this.limits,
		);
	}

	private async pruneSupersededBundles(currentBundleId: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(this.rootDirectory, { withFileTypes: true });
		} catch {
			// The committed pointer is already durable. Retaining a stale cache is
			// safe if cleanup is unavailable, so never turn a successful install
			// into a failed install because pruning could not run.
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name === currentBundleId || !BUNDLE_DIRECTORY.test(entry.name)) continue;
			const candidate = join(this.rootDirectory, entry.name);
			try {
				if ((await lstat(candidate)).isDirectory()) await rm(candidate, { recursive: true, force: true });
			} catch {
				// A stale cache is disposable; leave it in place when the filesystem
				// does not permit removal and keep the committed bundle usable.
			}
		}
	}
}

async function readWithTimeout(
	read: UiBundleAssetReader["read"],
	assetPath: string,
	timeoutMs: number,
): Promise<Uint8Array> {
	const pending = Promise.resolve().then(() => read(assetPath));
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new UiBundleError("not_found", "UI bundle asset transfer timed out")),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		void pending.catch(() => undefined);
	}
}

function positiveTimeout(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 5 * 60 * 1000) {
		throw new RangeError("UI bundle source read timeout is invalid");
	}
	return value;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true }).catch(() => undefined);
	}
}

function parsePointer(value: unknown): CurrentPointer {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		(value as Record<string, unknown>).schemaVersion !== POINTER_SCHEMA_VERSION ||
		typeof (value as Record<string, unknown>).bundleId !== "string" ||
		!(/^[A-Za-z0-9_-]{8,128}$/u).test((value as Record<string, unknown>).bundleId as string)
	) {
		throw new UiBundleError("integrity", "committed UI bundle pointer is invalid");
	}
	return value as CurrentPointer;
}

function safeChild(root: string, child: string): string | null {
	if (child.length === 0 || child.includes("\0") || child.startsWith("/") || isAbsolute(child)) return null;
	const candidate = resolve(root, child);
	const escaped = relative(root, candidate);
	return escaped.length > 0 && !escaped.startsWith(`..${sep}`) && escaped !== ".." && !isAbsolute(escaped)
		? candidate
		: null;
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}

/**
 * A committed bundle is an immutable server-owned cache. Treat a symbolic link
 * in that cache as tampering, rather than following it outside the verified
 * content-addressed namespace. `readFile` alone would follow the link before
 * the hash check, which can expose an arbitrary local file to the server UI
 * delivery path.
 */
async function assertRegularFile(path: string, description: string): Promise<void> {
	let metadata: Awaited<ReturnType<typeof lstat>>;
	try {
		metadata = await lstat(path);
	} catch (error) {
		void error;
		throw new UiBundleError("integrity", `${description} is unavailable`);
	}
	if (!metadata.isFile()) {
		throw new UiBundleError("integrity", `${description} is not a regular file`);
	}
}

async function readRegularTextFile(path: string, description: string): Promise<string> {
	await assertRegularFile(path, description);
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		void error;
		throw new UiBundleError("integrity", `${description} is unavailable`);
	}
}

async function readRegularBinaryFile(path: string, description: string): Promise<Buffer> {
	await assertRegularFile(path, description);
	try {
		return await readFile(path);
	} catch (error) {
		void error;
		throw new UiBundleError("integrity", `${description} is unavailable`);
	}
}
