import { mkdtemp, readFile, readlink, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Whether a session holder's environment can still serve new terminals
 * (ADR-0116). Linux only: elsewhere there are no mount namespaces to differ.
 *
 * A holder outlives the server that launched it. Under systemd's `PrivateTmp`
 * the run that launched it has its `/tmp` deleted when it stops, and the
 * holder, with every shell it starts later, keeps the deleted directory. Only
 * a positive result earns a holder new sessions; anything that could not be
 * checked counts against it, because a holder that is passed over costs one
 * extra process while a broken one costs every new terminal.
 */

/** One temporary directory, as seen by the process that would use it. */
export type TemporaryPathHealth = 'ok' | 'missing' | 'unwritable' | 'unknown';

export interface HolderHealthFacts {
	/** Whether the holder sees the same mounts as this server. */
	readonly sameNamespace: 'yes' | 'no' | 'unknown';
	/** `/tmp` inside the holder's view. */
	readonly tmp: TemporaryPathHealth;
	/** The holder's `TMPDIR`, or `/tmp` again when it has none. */
	readonly tmpdir: TemporaryPathHealth;
}

/** This server's own view of the same two paths. */
export interface OwnHealthFacts {
	readonly tmp: TemporaryPathHealth;
	readonly tmpdir: TemporaryPathHealth;
}

/** The procfs and file-system reads a check makes, injectable for tests. */
export interface HealthProbeHost {
	readonly readlink: (path: string) => Promise<string>;
	readonly readFile: (path: string) => Promise<Buffer>;
	/** Whether a directory exists and a file can be made in it. */
	readonly probeDirectory: (path: string) => Promise<TemporaryPathHealth>;
	readonly env: Readonly<Record<string, string | undefined>>;
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code: unknown }).code)
		: undefined;
}

/**
 * Make, then remove, a directory: the one test that tells a deleted `/tmp`
 * (it still stats, with no links, and refuses new entries with ENOENT) from a
 * working one.
 */
export async function probeTemporaryDirectory(
	path: string,
): Promise<TemporaryPathHealth> {
	try {
		const info = await stat(path);
		if (!info.isDirectory()) return 'missing';
		if (info.nlink === 0) return 'missing';
	} catch (error) {
		const code = errorCode(error);
		return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unknown';
	}
	try {
		const made = await mkdtemp(join(path, '.terminay-health-'));
		await rmdir(made).catch(() => undefined);
		return 'ok';
	} catch (error) {
		const code = errorCode(error);
		if (code === 'ENOENT') return 'missing';
		if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')
			return 'unwritable';
		return 'unknown';
	}
}

export const nodeHealthProbeHost: HealthProbeHost = {
	readlink: (path) => readlink(path),
	readFile: (path) => readFile(path),
	probeDirectory: probeTemporaryDirectory,
	env: process.env,
};

function temporaryDirectoryOf(value: string | undefined): string {
	return value?.startsWith('/') ? value : '/tmp';
}

function environmentValue(environ: Buffer, name: string): string | undefined {
	const prefix = `${name}=`;
	for (const entry of environ.toString('utf8').split('\0'))
		if (entry.startsWith(prefix)) return entry.slice(prefix.length);
	return undefined;
}

/** Check a running holder through `/proc/<pid>`. Never throws. */
export async function checkHolderHealth(
	pid: number,
	host: HealthProbeHost = nodeHealthProbeHost,
): Promise<HolderHealthFacts> {
	const proc = `/proc/${pid}`;
	const [own, theirs] = await Promise.all([
		host.readlink('/proc/self/ns/mnt').catch(() => undefined),
		host.readlink(`${proc}/ns/mnt`).catch(() => undefined),
	]);
	const sameNamespace =
		own === undefined || theirs === undefined
			? 'unknown'
			: own === theirs
				? 'yes'
				: 'no';
	const root = `${proc}/root`;
	const tmp = await host
		.probeDirectory(`${root}/tmp`)
		.catch((): TemporaryPathHealth => 'unknown');
	let tmpdir: TemporaryPathHealth;
	try {
		const environ = await host.readFile(`${proc}/environ`);
		const path = temporaryDirectoryOf(environmentValue(environ, 'TMPDIR'));
		tmpdir =
			path === '/tmp'
				? tmp
				: await host
						.probeDirectory(`${root}${path}`)
						.catch((): TemporaryPathHealth => 'unknown');
	} catch {
		tmpdir = 'unknown';
	}
	return Object.freeze({ sameNamespace, tmp, tmpdir });
}

/** This server's own `/tmp` and `TMPDIR`. Never throws. */
export async function checkOwnHealth(
	host: HealthProbeHost = nodeHealthProbeHost,
): Promise<OwnHealthFacts> {
	const tmp = await host
		.probeDirectory('/tmp')
		.catch((): TemporaryPathHealth => 'unknown');
	const path = temporaryDirectoryOf(host.env.TMPDIR);
	const tmpdir =
		path === '/tmp'
			? tmp
			: await host
					.probeDirectory(path)
					.catch((): TemporaryPathHealth => 'unknown');
	return Object.freeze({ tmp, tmpdir });
}

/** Only a holder whose every fact is good may take new sessions. */
export function holderIsHealthy(facts: HolderHealthFacts): boolean {
	return (
		facts.sameNamespace === 'yes' && facts.tmp === 'ok' && facts.tmpdir === 'ok'
	);
}

const broken = (health: TemporaryPathHealth): boolean =>
	health === 'missing' || health === 'unwritable';

/**
 * Whether the holder's sessions have lost their temporary directory: one of
 * its paths is positively broken while this server's own are fine. A
 * namespace difference alone, or anything unknown, says nothing about what a
 * shell can do, so it shows nothing.
 */
export function holderTmpUnusable(
	facts: HolderHealthFacts,
	own: OwnHealthFacts,
): boolean {
	return (
		(broken(facts.tmp) || broken(facts.tmpdir)) &&
		own.tmp === 'ok' &&
		own.tmpdir === 'ok'
	);
}

/** Whether this server's own temporary directories fail: a host problem. */
export function ownTmpUnusable(own: OwnHealthFacts): boolean {
	return own.tmp !== 'ok' || own.tmpdir !== 'ok';
}
