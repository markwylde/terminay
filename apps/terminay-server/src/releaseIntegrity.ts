import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_FILE = 'release-integrity.json';
const SCHEMA_VERSION = 1;

interface ReleaseFile {
	readonly path: string;
	readonly size: number;
	readonly sha256: string;
}

interface ReleaseManifest {
	readonly schemaVersion: number;
	readonly packageName: string;
	readonly version: string;
	readonly files: readonly ReleaseFile[];
}

/**
 * Verifies the complete executable support bundle before either standalone
 * entrypoint accepts work. The manifest is generated after TypeScript emits
 * `dist`, so it describes the artifact rather than source intentions.
 */
export async function assertStandaloneReleaseIntegrity(
	distRoot = dirname(fileURLToPath(import.meta.url)),
): Promise<Readonly<ReleaseManifest>> {
	const manifest = parseManifest(
		await readFile(join(distRoot, MANIFEST_FILE), 'utf8'),
	);
	const packageJson = parsePackage(
		await readFile(join(distRoot, '..', 'package.json'), 'utf8'),
	);
	if (
		manifest.packageName !== packageJson.name ||
		manifest.version !== packageJson.version
	) {
		throw new Error('standalone release manifest package identity mismatch');
	}

	const expected = new Map(manifest.files.map((file) => [file.path, file]));
	if (expected.size !== manifest.files.length)
		throw new Error('standalone release manifest has duplicate files');
	const actual = await listReleaseFiles(distRoot);
	if (
		actual.length !== expected.size ||
		actual.some((path) => !expected.has(path))
	) {
		throw new Error('standalone release executable file set mismatch');
	}
	for (const file of manifest.files) {
		assertRelativePath(file.path);
		const target = join(distRoot, file.path);
		// The manifest binds the executable payload itself, not a mutable path to
		// bytes outside the staged artifact. `stat` follows a symlink and would
		// therefore let an otherwise hash-matching external file masquerade as a
		// packaged module after extraction.
		const info = await lstat(target);
		if (!info.isFile())
			throw new Error(`standalone release file is not regular: ${file.path}`);
		const bytes = await readFile(target);
		if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) {
			throw new Error(`standalone release integrity mismatch: ${file.path}`);
		}
	}
	return Object.freeze(manifest);
}

function parseManifest(value: string): ReleaseManifest {
	const raw: unknown = JSON.parse(value);
	if (
		!isRecord(raw) ||
		raw.schemaVersion !== SCHEMA_VERSION ||
		typeof raw.packageName !== 'string' ||
		!isVersion(raw.version) ||
		!Array.isArray(raw.files) ||
		raw.files.length === 0
	) {
		throw new Error('standalone release manifest is invalid');
	}
	const files = raw.files.map((file): ReleaseFile => {
		if (!isRecord(file))
			throw new Error('standalone release manifest file is invalid');
		const { path, size, sha256 } = file;
		if (
			typeof path !== 'string' ||
			typeof size !== 'number' ||
			!Number.isSafeInteger(size) ||
			size < 0 ||
			typeof sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(sha256)
		) {
			throw new Error('standalone release manifest file is invalid');
		}
		assertRelativePath(path);
		return Object.freeze({ path, size, sha256 });
	});
	return Object.freeze({
		schemaVersion: SCHEMA_VERSION,
		packageName: raw.packageName,
		version: raw.version,
		files,
	});
}

function parsePackage(value: string): {
	readonly name: string;
	readonly version: string;
} {
	const raw: unknown = JSON.parse(value);
	if (!isRecord(raw) || typeof raw.name !== 'string' || !isVersion(raw.version))
		throw new Error('standalone package metadata is invalid');
	return Object.freeze({ name: raw.name, version: raw.version });
}

async function listReleaseFiles(
	root: string,
	current = root,
): Promise<string[]> {
	const entries = await readdir(current, { withFileTypes: true });
	const paths: string[] = [];
	for (const entry of entries) {
		const target = join(current, entry.name);
		if (entry.isDirectory())
			paths.push(...(await listReleaseFiles(root, target)));
		// Include symlinks in the inventory so the per-entry `lstat`
		// below produces the precise fail-closed error instead of treating a
		// substituted module as an unrelated missing file.
		else if (
			(entry.isFile() || entry.isSymbolicLink()) &&
			entry.name !== MANIFEST_FILE
		)
			paths.push(relative(root, target));
	}
	return paths.sort((left, right) => left.localeCompare(right));
}

function assertRelativePath(path: string): void {
	if (
		path.length === 0 ||
		path.includes('\\0') ||
		path.startsWith('/') ||
		path
			.split(/[\\/]/u)
			.some((segment) => segment === '..' || segment.length === 0)
	) {
		throw new Error('standalone release manifest path is invalid');
	}
	if (path.startsWith(`..${sep}`) || path === '..')
		throw new Error('standalone release manifest path is invalid');
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isVersion(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value)
	);
}
