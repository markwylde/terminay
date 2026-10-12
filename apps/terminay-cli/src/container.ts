import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { activate, activeVersion } from './install.js';
import { type ReleaseTree, UPGRADE_RESULT } from './layout.js';
import {
	type ArchiveManifest,
	readArchiveManifest,
	validateUnpackedArchive,
} from './manifest.js';
import { releaseLabel, writeUpgradeOutcome } from './outcome.js';
import { compareVersions } from './plan.js';

/**
 * A container's releases: the one the image was built with, and any newer one
 * staged on its data volume.
 *
 * The image is a baseline. An in-place upgrade stages a release under
 * `<data root>/releases/` and marks it, and the entrypoint, which stays the
 * container's main process, starts the server from whichever release this
 * module selects. Nothing here opens the server's own state: the releases
 * directory holds release files and the few small records below, and the rest
 * of the data root is not read.
 *
 *   versions/<name>/     staged releases, immutable once verified
 *   current              symbolic link to the marked release
 *   staged/<name>.json   what a staged release was staged over
 *   pending.json         an upgrade the new server has not yet confirmed
 *   restart-requested    asks the entrypoint to start the server again
 *   server.pid, running  written by the entrypoint: its child, and its release
 *   upgrade-result.json  the outcome of the last attempt
 */

export const IMAGE_RELEASE_DEFAULT = '/opt/terminay';
export const DATA_ROOT_DEFAULT = '/var/lib/terminay';
export const HEALTH_PORT_DEFAULT = 8444;
export const RESTART_MARKER = 'restart-requested';

type Environment = Readonly<Record<string, string | undefined>>;

export function isContainerManaged(env: Environment = process.env): boolean {
	return env.TERMINAY_MANAGED_BY === 'container';
}

export interface ContainerLayout extends ReleaseTree {
	/** The release built into the image. Never written. */
	readonly imageRelease: string;
	readonly stagedDirectory: string;
	readonly pendingPath: string;
	readonly restartMarker: string;
	readonly serverPidPath: string;
	readonly runningPath: string;
	readonly healthPort: number;
}

export function containerLayout(
	env: Environment = process.env,
): ContainerLayout {
	const dataRoot = resolve(env.TERMINAY_DATA_ROOT || DATA_ROOT_DEFAULT);
	const prefix = join(dataRoot, 'releases');
	const port = Number(env.TERMINAY_HEALTH_PORT);
	return Object.freeze({
		prefix,
		versionsDirectory: join(prefix, 'versions'),
		currentLink: join(prefix, 'current'),
		resultPath: join(prefix, UPGRADE_RESULT),
		imageRelease: resolve(env.TERMINAY_IMAGE_RELEASE || IMAGE_RELEASE_DEFAULT),
		stagedDirectory: join(prefix, 'staged'),
		pendingPath: join(prefix, 'pending.json'),
		restartMarker: join(prefix, RESTART_MARKER),
		serverPidPath: join(prefix, 'server.pid'),
		runningPath: join(prefix, 'running'),
		healthPort:
			Number.isSafeInteger(port) && port > 0 && port < 65536
				? port
				: HEALTH_PORT_DEFAULT,
	});
}

async function writeJsonAtomically(
	path: string,
	value: unknown,
): Promise<void> {
	const temporary = `${path}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o644,
	});
	await rename(temporary, path);
}

async function readJson(
	path: string,
): Promise<Record<string, unknown> | undefined> {
	const raw = await readFile(path, 'utf8').catch(() => undefined);
	if (raw === undefined) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * What a staged release was staged over.
 *
 * A tagged release orders itself against the image by version. A rolling
 * build cannot: its manifest carries a commit and no ordering. So the commit
 * of the image it was staged over is recorded, and while the image is still
 * that commit the staged build is the newer one by construction. An image at
 * any other commit is one the operator pulled deliberately, and it wins.
 */
export interface StagedRecord {
	readonly schemaVersion: 1;
	readonly name: string;
	readonly imageRevision: string;
	/** When the staged build was published, for the next check to compare. */
	readonly publishedAt?: string;
	readonly stagedAt: string;
}

function stagedRecordPath(layout: ContainerLayout, name: string): string {
	return join(layout.stagedDirectory, `${name}.json`);
}

export async function writeStagedRecord(
	layout: ContainerLayout,
	record: Omit<StagedRecord, 'schemaVersion' | 'stagedAt'>,
): Promise<void> {
	await mkdir(layout.stagedDirectory, { recursive: true, mode: 0o755 });
	await writeJsonAtomically(stagedRecordPath(layout, record.name), {
		schemaVersion: 1,
		...record,
		stagedAt: new Date().toISOString(),
	});
}

export async function readStagedRecord(
	layout: ContainerLayout,
	name: string,
): Promise<StagedRecord | undefined> {
	const record = await readJson(stagedRecordPath(layout, name));
	if (
		record === undefined ||
		record.schemaVersion !== 1 ||
		record.name !== name ||
		typeof record.imageRevision !== 'string'
	)
		return undefined;
	return record as unknown as StagedRecord;
}

export async function removeStagedRecord(
	layout: ContainerLayout,
	name: string,
): Promise<void> {
	await rm(stagedRecordPath(layout, name), { force: true });
}

export interface SelectedRelease {
	readonly root: string;
	/** The staged name, or `undefined` for the release built into the image. */
	readonly staged?: string;
	/** Why the marked release was passed over, when one was. */
	readonly skipped?: string;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The release the server should start from.
 *
 * The marked release when its manifest and every file it lists verify and it
 * is not older than the image's; otherwise the image's. A release that is
 * passed over is named with the reason and never stands in the way: the
 * image's own release is always there to start.
 */
export async function selectRelease(
	layout: ContainerLayout,
): Promise<SelectedRelease> {
	const image = Object.freeze({ root: layout.imageRelease });
	const name = await activeVersion(layout);
	if (name === undefined) return image;
	const skip = (reason: string): SelectedRelease =>
		Object.freeze({
			root: layout.imageRelease,
			skipped: `skipping the staged release ${name}: ${reason}`,
		});

	const root = join(layout.versionsDirectory, name);
	let staged: ArchiveManifest;
	try {
		staged = await validateUnpackedArchive(root);
	} catch (error) {
		return skip(message(error));
	}
	// An image whose own manifest cannot be read has nothing to be compared
	// with, and the staged release has just been verified file by file.
	const baseline = await readArchiveManifest(layout.imageRelease).catch(
		() => undefined,
	);
	if (baseline === undefined) return Object.freeze({ root, staged: name });

	if (staged.channel === 'tag' && baseline.channel === 'tag') {
		if (compareVersions(staged.version, baseline.version) < 0) {
			return skip(
				`it is ${staged.version}, older than the ${baseline.version} this image carries`,
			);
		}
		return Object.freeze({ root, staged: name });
	}
	const record = await readStagedRecord(layout, name);
	if (record === undefined)
		return skip('nothing records which image it was staged over');
	if (record.imageRevision !== baseline.revision) {
		return skip(
			`it was staged over image revision ${record.imageRevision.slice(0, 12)}, and this image is ${baseline.revision.slice(0, 12)}`,
		);
	}
	return Object.freeze({ root, staged: name });
}

/**
 * An upgrade whose new server has not yet reported ready.
 *
 * Written before the mark moves and removed once the upgrade is confirmed or
 * undone. While it exists, a server that exits on its own, or a container that
 * stops, is taken as the new release failing: the previous mark is restored
 * before anything is started again, so a release that cannot start can never
 * be the one the container keeps starting.
 */
export interface PendingUpgrade {
	readonly schemaVersion: 1;
	/** The previously marked release, or `null` for the image's own. */
	readonly previous: string | null;
	readonly next: string;
	readonly from: string;
	readonly to: string;
	readonly startedAt: string;
}

export async function writePendingUpgrade(
	layout: ContainerLayout,
	pending: Omit<PendingUpgrade, 'schemaVersion' | 'startedAt'>,
): Promise<void> {
	await writeJsonAtomically(layout.pendingPath, {
		schemaVersion: 1,
		...pending,
		startedAt: new Date().toISOString(),
	});
}

export async function readPendingUpgrade(
	layout: ContainerLayout,
): Promise<PendingUpgrade | undefined> {
	const record = await readJson(layout.pendingPath);
	if (
		record === undefined ||
		record.schemaVersion !== 1 ||
		typeof record.next !== 'string' ||
		typeof record.from !== 'string' ||
		typeof record.to !== 'string' ||
		(record.previous !== null && typeof record.previous !== 'string')
	)
		return undefined;
	return record as unknown as PendingUpgrade;
}

/** Point the mark at a staged release, or clear it to fall back to the image. */
export async function markRelease(
	layout: ContainerLayout,
	name: string | null,
): Promise<void> {
	if (name === null) {
		await rm(layout.currentLink, { force: true });
		return;
	}
	await activate(layout, name);
}

/** Undo an unconfirmed upgrade and record why. */
export async function rollBackPending(
	layout: ContainerLayout,
	pending: PendingUpgrade,
	reason: string,
): Promise<void> {
	await markRelease(layout, pending.previous).catch(async () => {
		// A previous release that has gone missing leaves the image's own.
		await rm(layout.currentLink, { force: true });
	});
	await writeUpgradeOutcome(layout.resultPath, {
		from: pending.from,
		to: pending.to,
		outcome: 'rolled-back',
		reason,
	}).catch(() => undefined);
	await rm(layout.pendingPath, { force: true });
}

async function consume(path: string): Promise<boolean> {
	try {
		await rm(path);
		return true;
	} catch {
		return false;
	}
}

export type SupervisorEvent =
	| { readonly phase: 'select' }
	| { readonly phase: 'start' }
	| { readonly phase: 'exited'; readonly status: number };

export type SupervisorStep =
	| { readonly action: 'run'; readonly release: string }
	| { readonly action: 'exit' };

/**
 * What the entrypoint does next.
 *
 * The entrypoint is a few lines of shell that start the server, wait for it,
 * and forward signals. Every decision it makes is this function's, so the
 * decisions can be tested without a container.
 *
 *   select  Name the release, changing nothing. For a command that prints
 *           and exits, such as `--version`.
 *   start   The container is starting. Anything left by a container that
 *           stopped mid-upgrade is settled first.
 *   exited  The server has exited. A requested restart starts it again; an
 *           unconfirmed upgrade is undone and the previous release started;
 *           anything else ends the container with the server's status.
 */
export async function superviseStep(
	layout: ContainerLayout,
	event: SupervisorEvent,
	log: (line: string) => void = () => undefined,
): Promise<SupervisorStep> {
	if (event.phase === 'start') {
		await rm(layout.restartMarker, { force: true });
		await rm(layout.serverPidPath, { force: true });
		const pending = await readPendingUpgrade(layout);
		if (pending !== undefined) {
			log(
				`the upgrade to ${pending.to} was never confirmed; restoring ${pending.from}`,
			);
			await rollBackPending(
				layout,
				pending,
				`the container stopped before ${pending.to} reported ready`,
			);
		}
	}
	if (event.phase === 'exited') {
		const requested = await consume(layout.restartMarker);
		const pending = requested ? undefined : await readPendingUpgrade(layout);
		if (pending !== undefined) {
			log(
				`${pending.to} exited with status ${event.status} before it reported ready; restoring ${pending.from}`,
			);
			await rollBackPending(
				layout,
				pending,
				`${pending.to} exited with status ${event.status} before it reported ready`,
			);
		} else if (!requested) {
			return Object.freeze({ action: 'exit' });
		}
	}
	const selected = await selectRelease(layout);
	if (selected.skipped !== undefined) log(selected.skipped);
	return Object.freeze({ action: 'run', release: selected.root });
}

/**
 * The hidden `terminay container-release <phase> [status]` command the
 * entrypoint runs on the image's own Node. One line on stdout — `run <path>`
 * or `exit` — and reasons on stderr, where the container's log collects them.
 *
 * Any failure answers with the image's own release rather than an error: the
 * entrypoint must always have something to start.
 */
export async function runContainerRelease(
	argv: readonly string[],
	env: Environment = process.env,
	write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
	log: (line: string) => void = (line) =>
		process.stderr.write(`terminay: ${line}\n`),
): Promise<number> {
	const layout = containerLayout(env);
	const [phase, status] = argv;
	const event: SupervisorEvent | undefined =
		phase === 'select' || phase === 'start'
			? { phase }
			: phase === 'exited'
				? { phase, status: Number(status ?? 0) || 0 }
				: undefined;
	if (event === undefined) {
		log('container-release expects select, start, or exited <status>');
		return 64;
	}
	try {
		const step = await superviseStep(layout, event, log);
		write(step.action === 'run' ? `run ${step.release}` : 'exit');
	} catch (error) {
		log(`release selection failed: ${message(error)}`);
		write(event.phase === 'exited' ? 'exit' : `run ${layout.imageRelease}`);
	}
	return 0;
}

export interface RunningRelease {
	readonly root: string;
	readonly manifest: ArchiveManifest;
	/** The staged name when the running release is not the image's own. */
	readonly staged?: string;
	/** False when no entrypoint has recorded what it started. */
	readonly supervised: boolean;
}

/**
 * The release the server in this container is running.
 *
 * The entrypoint records what it started. Where it has not — an image started
 * with another entrypoint — the image's own release is the only candidate.
 */
export async function runningRelease(
	layout: ContainerLayout,
): Promise<RunningRelease> {
	const recorded = (
		await readFile(layout.runningPath, 'utf8').catch(() => '')
	).trim();
	const supervised = recorded.length > 0 && isAbsolute(recorded);
	const root = supervised ? resolve(recorded) : layout.imageRelease;
	const staged =
		root.startsWith(`${layout.versionsDirectory}/`) &&
		!root.slice(layout.versionsDirectory.length + 1).includes('/')
			? root.slice(layout.versionsDirectory.length + 1)
			: undefined;
	// Anything that is neither the image's release nor a staged one is not a
	// path this container starts servers from, whatever the file says.
	const known = staged !== undefined || root === layout.imageRelease;
	const manifest = await readArchiveManifest(
		known ? root : layout.imageRelease,
	);
	return Object.freeze({
		root: known ? root : layout.imageRelease,
		manifest,
		...(known && staged !== undefined ? { staged } : {}),
		supervised,
	});
}

/** The pid the entrypoint recorded for the server it started, while it lives. */
export async function supervisedServerPid(
	layout: ContainerLayout,
): Promise<number | undefined> {
	const raw = (
		await readFile(layout.serverPidPath, 'utf8').catch(() => '')
	).trim();
	if (!/^[1-9]\d{0,9}$/u.test(raw)) return undefined;
	const pid = Number(raw);
	return isAlive(pid) ? pid : undefined;
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists and belongs to another account.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

export function containerReleaseLabel(manifest: ArchiveManifest): string {
	return releaseLabel(manifest.channel, manifest.version, manifest.revision);
}
