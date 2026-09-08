import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { request, requestJson } from './http.js';

/**
 * Turning an operator's reference into something installable.
 *
 * Four shapes are accepted, and the shape decides the channel the install
 * follows afterwards. The channel matters more than the version: an upgrade
 * with no reference re-resolves whatever channel the machine is already on,
 * so a box tracking `main` never silently jumps onto the tag stream.
 */

const execFileAsync = promisify(execFile);

export const DEFAULT_REPOSITORY = 'markwylde/terminay';

/**
 * The rolling channel is tagged `main-latest`, not `main`: a release tag named
 * for the default branch makes the ref ambiguous in every clone, so
 * `git fetch main` resolves the tag instead of the branch.
 */
export const ROLLING_TAG = 'main-latest';

/** Assets on the rolling release are named for the channel, not a version. */
const ROLLING_ASSET_VERSION = 'main';

export type ReleaseChannel = 'tag' | 'main' | 'source';
export type Architecture = 'x64' | 'arm64';

export interface ResolvedAssets {
	readonly archive: string;
	readonly sha256: string;
	readonly signature: string;
}

export interface ResolvedRef {
	readonly channel: ReleaseChannel;
	/** Release version for `tag`, the channel name for `main`, the short commit for `source`. */
	readonly version: string;
	/** Known up front only for `source`; otherwise read from the signed manifest after install. */
	readonly revision?: string;
	readonly tag?: string;
	readonly publishedAt?: string;
	readonly assets?: ResolvedAssets;
	/** Set for `source`: the reference to clone and build. */
	readonly sourceRef?: string;
}

export interface ResolveOptions {
	readonly repository?: string;
	readonly architecture: Architecture;
	/** Overridden by tests to point at a local server. */
	readonly apiBase?: string;
	readonly webBase?: string;
}

interface ReleasePayload {
	readonly tagName: string;
	readonly publishedAt: string | undefined;
	readonly assetNames: readonly string[];
}

const SEMVER_TAG = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const COMMIT_SHA = /^[0-9a-f]{7,40}$/u;

function apiBase(options: ResolveOptions): string {
	return options.apiBase ?? 'https://api.github.com';
}

function webBase(options: ResolveOptions): string {
	return options.webBase ?? 'https://github.com';
}

function repository(options: ResolveOptions): string {
	return options.repository ?? DEFAULT_REPOSITORY;
}

export function archiveName(
	version: string,
	architecture: Architecture,
): string {
	return `terminay-server-${version}-linux-${architecture}.tar.gz`;
}

function assetUrls(
	options: ResolveOptions,
	tag: string,
	version: string,
): ResolvedAssets {
	const base = `${webBase(options)}/${repository(options)}/releases/download/${encodeURIComponent(tag)}`;
	const name = archiveName(version, options.architecture);
	return Object.freeze({
		archive: `${base}/${name}`,
		sha256: `${base}/${name}.sha256`,
		signature: `${base}/${name}.sig`,
	});
}

function readReleaseJson(document: unknown): ReleasePayload | undefined {
	if (typeof document !== 'object' || document === null) return undefined;
	const release = document as Record<string, unknown>;
	if (typeof release.tag_name !== 'string') return undefined;
	const assets = Array.isArray(release.assets) ? release.assets : [];
	return Object.freeze({
		tagName: release.tag_name,
		publishedAt:
			typeof release.published_at === 'string'
				? release.published_at
				: undefined,
		assetNames: Object.freeze(
			assets
				.map((asset) =>
					typeof asset === 'object' && asset !== null
						? (asset as Record<string, unknown>).name
						: undefined,
				)
				.filter((name): name is string => typeof name === 'string'),
		),
	});
}

/**
 * The release page's asset fragment is plain HTML and is not rate limited, so
 * it answers when an anonymous `npx` install has exhausted the API budget.
 */
async function readReleaseHtml(
	options: ResolveOptions,
	tag: string,
): Promise<ReleasePayload> {
	const url = `${webBase(options)}/${repository(options)}/releases/expanded_assets/${encodeURIComponent(tag)}`;
	const response = await request(url, 'text/html');
	if (response.status !== 200)
		throw new Error(
			`release ${tag} was not found (GitHub returned ${response.status})`,
		);
	const names = new Set<string>();
	const pattern = /\/releases\/download\/[^"'/]+\/([^"'?#]+)/gu;
	for (const match of response.body.matchAll(pattern)) {
		const name = match[1];
		if (name !== undefined) names.add(decodeURIComponent(name));
	}
	return Object.freeze({
		tagName: tag,
		publishedAt: undefined,
		assetNames: Object.freeze([...names]),
	});
}

async function readRelease(
	options: ResolveOptions,
	path: string,
	tag: string,
): Promise<ReleasePayload> {
	try {
		const payload = readReleaseJson(
			await requestJson(
				`${apiBase(options)}/repos/${repository(options)}/releases/${path}`,
			),
		);
		if (payload !== undefined) return payload;
	} catch {
		// Falls through to the release page, which is the documented fallback
		// for a rate-limited or unavailable API.
	}
	return readReleaseHtml(options, tag);
}

/** `latest` has no fixed tag, so the redirect on the web release page names it. */
async function readLatestTag(options: ResolveOptions): Promise<string> {
	try {
		const payload = readReleaseJson(
			await requestJson(
				`${apiBase(options)}/repos/${repository(options)}/releases/latest`,
			),
		);
		if (payload !== undefined) return payload.tagName;
	} catch {
		// Falls through to the redirect below.
	}
	const response = await request(
		`${webBase(options)}/${repository(options)}/releases/latest`,
		'text/html',
		false,
	);
	const location = response.headers.location;
	const target = typeof location === 'string' ? location : response.body;
	const match = /\/releases\/tag\/([^"'?#\s]+)/u.exec(target);
	if (match?.[1] === undefined)
		throw new Error('no tagged release could be resolved for this repository');
	return decodeURIComponent(match[1]);
}

function requireArchitectureAsset(
	payload: ReleasePayload,
	options: ResolveOptions,
	version: string,
): void {
	const name = archiveName(version, options.architecture);
	if (payload.assetNames.length > 0 && !payload.assetNames.includes(name)) {
		throw new Error(
			`release ${payload.tagName} has no server archive for the ${options.architecture} architecture (expected ${name})`,
		);
	}
}

async function resolveTag(
	options: ResolveOptions,
	tag: string,
): Promise<ResolvedRef> {
	const payload = await readRelease(
		options,
		`tags/${encodeURIComponent(tag)}`,
		tag,
	);
	const version = payload.tagName.replace(/^v/u, '');
	requireArchitectureAsset(payload, options, version);
	return Object.freeze({
		channel: 'tag' as const,
		version,
		tag: payload.tagName,
		...(payload.publishedAt === undefined
			? {}
			: { publishedAt: payload.publishedAt }),
		assets: assetUrls(options, payload.tagName, version),
	});
}

async function resolveRolling(options: ResolveOptions): Promise<ResolvedRef> {
	const payload = await readRelease(
		options,
		`tags/${ROLLING_TAG}`,
		ROLLING_TAG,
	);
	requireArchitectureAsset(payload, options, ROLLING_ASSET_VERSION);
	return Object.freeze({
		channel: 'main' as const,
		version: ROLLING_ASSET_VERSION,
		tag: ROLLING_TAG,
		...(payload.publishedAt === undefined
			? {}
			: { publishedAt: payload.publishedAt }),
		assets: assetUrls(options, ROLLING_TAG, ROLLING_ASSET_VERSION),
	});
}

async function resolveSource(
	options: ResolveOptions,
	ref: string,
): Promise<ResolvedRef> {
	const remote = `${webBase(options)}/${repository(options)}.git`;
	if (COMMIT_SHA.test(ref)) {
		return Object.freeze({
			channel: 'source' as const,
			version: ref.slice(0, 12),
			revision: ref,
			sourceRef: ref,
		});
	}
	let stdout: string;
	try {
		({ stdout } = await execFileAsync('git', ['ls-remote', remote, ref], {
			timeout: 60_000,
		}));
	} catch (error) {
		throw new Error(
			`could not resolve "${ref}" as a release, a branch, or a commit: ${message(error)}`,
		);
	}
	const line = stdout.split('\n').find((entry) => entry.trim().length > 0);
	const revision = line?.split(/\s+/u)[0];
	if (revision === undefined || !/^[0-9a-f]{40}$/u.test(revision)) {
		throw new Error(
			`could not resolve "${ref}" as a release, a branch, or a commit`,
		);
	}
	return Object.freeze({
		channel: 'source' as const,
		version: revision.slice(0, 12),
		revision,
		sourceRef: ref,
	});
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function resolveRef(
	ref: string | undefined,
	options: ResolveOptions,
): Promise<ResolvedRef> {
	if (ref === undefined)
		return resolveTag(options, await readLatestTag(options));
	if (ref === 'latest')
		return resolveTag(options, await readLatestTag(options));
	if (SEMVER_TAG.test(ref)) return resolveTag(options, ref);
	if (ref === 'main') return resolveRolling(options);
	return resolveSource(options, ref);
}
