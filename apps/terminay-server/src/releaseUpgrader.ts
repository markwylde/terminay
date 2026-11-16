import { type ChildProcess, spawn as spawnChild } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, watch } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type {
	ServerUpgradeCheckReport,
	ServerUpgradeHandover,
	ServerUpgradeRecordChange,
	ServerUpgradeRecordWatch,
	ServerUpgradeRunRecord,
	ServerUpgrader,
} from '@terminay/server-core';
import { z } from 'zod';

/** The variable the release's launcher sets to the upgrader it ships. */
export const TERMINAY_UPGRADER_ENV = 'TERMINAY_UPGRADER';

/** A check prints one line. Anything longer is not a check's answer. */
export const UPGRADE_CHECK_MAX_OUTPUT_BYTES = 64 * 1024;
/** A check reads release metadata over the network and nothing else. */
export const UPGRADE_CHECK_TIMEOUT_MS = 60_000;

const version = z.string().min(1).max(128);
const text = z.string().min(1).max(1024);
/** Prose for a person. A long one is cut to what a status carries rather
 * than costing the whole answer. */
const prose = z
	.string()
	.min(1)
	.max(16 * 1024)
	.transform((value) => value.slice(0, 1024));

/**
 * The one line `daemon upgrade --check` prints (design.md decision 1 of
 * change `remote-server-in-app-upgrade`). It is another process's output, so
 * it is validated field by field and anything unknown is refused.
 */
const requestPath = z
	.string()
	.min(1)
	.max(4096)
	.refine(
		(path) => isAbsolute(path) && !path.includes('\0'),
		'the request file must be an absolute path',
	);

const release = z.strictObject({
	channel: z.string().min(1).max(32),
	version,
	revision: z.string().max(128),
});

/** One record the upgrader wrote (ADR-0125), as the check reports it and as
 * it sits on disk. */
const runRecordFields = {
	run: z.string().min(1).max(64).optional(),
	runStartedAt: z.string().min(1).max(64).optional(),
	from: version,
	to: version,
	fromRelease: release.optional(),
	toRelease: release.optional(),
	outcome: z.enum(['started', 'succeeded', 'rolled-back', 'unchanged', 'failed']),
	reason: prose.optional(),
	at: z.string().min(1).max(64),
};
const runRecordSchema = z.strictObject(runRecordFields);
const runRecordFileSchema = z.strictObject({
	schemaVersion: z.literal(1),
	...runRecordFields,
});

/** The install record the upgrader rewrites beside its run record. */
export const INSTALL_RECORD_NAME = 'install.json';

const checkReportSchema = z.strictObject({
	schemaVersion: z.literal(1),
	environment: z.enum(['user', 'system', 'container']),
	installed: z.strictObject({
		channel: z.enum(['tag', 'main', 'canary', 'source']),
		version,
		revision: z.string().max(128),
	}),
	available: z.nullable(
		z.strictObject({
			version,
			revision: z.string().max(128).optional(),
			publishedAt: z.string().max(64).optional(),
		}),
	),
	canUpgrade: z.boolean(),
	modes: z
		.array(z.enum(['in-place', 'recreate']))
		.min(1)
		.max(2)
		.refine(
			(modes) =>
				modes[0] === 'in-place' &&
				(modes.length === 1 || modes[1] === 'recreate'),
			'modes must be in-place, optionally followed by recreate',
		),
	trigger: z.discriminatedUnion('kind', [
		z.strictObject({ kind: z.literal('spawn') }),
		z.strictObject({
			kind: z.literal('request-file'),
			path: requestPath,
			latestPath: requestPath.optional(),
		}),
	]),
	unavailable: z.nullable(z.strictObject({ reason: prose, command: text })),
	// Both absent from an upgrader that predates install-latest (ADR-0117).
	latest: z
		.nullable(
			z.strictObject({
				version,
				revision: z.string().max(128).optional(),
				publishedAt: z.string().max(64).optional(),
				order: z.enum(['newer', 'same', 'older']),
			}),
		)
		.optional(),
	installLatestUnavailable: z
		.nullable(z.strictObject({ reason: prose, command: text }))
		.optional(),
	// Absent from an upgrader that predates run records.
	recordPath: z.nullable(requestPath).optional(),
	lastResult: z.nullable(runRecordSchema),
	checkError: z.string().max(4096).optional(),
});

/** Parse a check's whole standard output: exactly one line of JSON. */
export function parseUpgradeCheckOutput(
	output: string,
): ServerUpgradeCheckReport {
	const lines = output.split('\n').filter((line) => line.trim().length > 0);
	if (lines.length !== 1)
		throw new Error('the upgrader did not print exactly one line');
	let value: unknown;
	try {
		value = JSON.parse(lines[0] as string);
	} catch {
		throw new Error('the upgrader did not print JSON');
	}
	const parsed = checkReportSchema.safeParse(value);
	if (!parsed.success)
		throw new Error(
			`the upgrader's answer is invalid: ${parsed.error.issues
				.slice(0, 3)
				.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
				.join('; ')}`,
		);
	const report = parsed.data;
	return {
		environment: report.environment,
		installed: report.installed,
		available:
			report.available === null
				? null
				: {
						version: report.available.version,
						...(report.available.revision === undefined
							? {}
							: { revision: report.available.revision }),
						...(report.available.publishedAt === undefined
							? {}
							: { publishedAt: report.available.publishedAt }),
					},
		canUpgrade: report.canUpgrade,
		modes: report.modes,
		trigger:
			report.trigger.kind === 'request-file'
				? {
						kind: 'request-file',
						path: report.trigger.path,
						...(report.trigger.latestPath === undefined
							? {}
							: { latestPath: report.trigger.latestPath }),
					}
				: report.trigger,
		unavailable: report.unavailable,
		...(report.latest === undefined
			? {}
			: {
					latest:
						report.latest === null
							? null
							: {
									version: report.latest.version,
									...(report.latest.revision === undefined
										? {}
										: { revision: report.latest.revision }),
									...(report.latest.publishedAt === undefined
										? {}
										: { publishedAt: report.latest.publishedAt }),
									order: report.latest.order,
								},
				}),
		...(report.installLatestUnavailable === undefined
			? {}
			: { installLatestUnavailable: report.installLatestUnavailable }),
		...(report.recordPath === undefined
			? {}
			: { recordPath: report.recordPath }),
		lastResult:
			report.lastResult === null ? null : runRecordOf(report.lastResult),
		...(report.checkError === undefined
			? {}
			: { checkError: report.checkError }),
	};
}

function runRecordOf(
	record: z.infer<typeof runRecordSchema>,
): ServerUpgradeRunRecord {
	return {
		...(record.run === undefined ? {} : { run: record.run }),
		...(record.runStartedAt === undefined
			? {}
			: { runStartedAt: record.runStartedAt }),
		from: record.from,
		to: record.to,
		...(record.fromRelease === undefined
			? {}
			: { fromRelease: record.fromRelease }),
		...(record.toRelease === undefined ? {} : { toRelease: record.toRelease }),
		outcome: record.outcome,
		...(record.reason === undefined ? {} : { reason: record.reason }),
		at: record.at,
	};
}

/** Parse the record file's content. Anything else reads as no record. */
export function parseUpgradeRunRecord(
	raw: string,
): ServerUpgradeRunRecord | undefined {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return undefined;
	}
	const parsed = runRecordFileSchema.safeParse(value);
	if (!parsed.success) return undefined;
	const { schemaVersion: _schemaVersion, ...record } = parsed.data;
	return runRecordOf(record);
}

/** Read the upgrader's record. Absent or unreadable is no record. */
export async function readUpgradeRunRecord(
	path: string,
): Promise<ServerUpgradeRunRecord | undefined> {
	if (!isAbsolute(path)) return undefined;
	const raw = await readFile(path, 'utf8').catch(() => undefined);
	return raw === undefined || raw.length > 64 * 1024
		? undefined
		: parseUpgradeRunRecord(raw);
}

/**
 * Watch the upgrader's record and the install record beside it. Both are
 * replaced by rename, so the directory is watched and its events filtered
 * to those two names (ADR-0028: a watch, never a poll). Throws when the
 * watch cannot be armed.
 */
export function watchUpgradeRunRecord(
	path: string,
	listener: (change: ServerUpgradeRecordChange) => void,
): ServerUpgradeRecordWatch {
	if (!isAbsolute(path)) throw new TypeError('the record path must be absolute');
	const recordName = basename(path);
	const watcher = watch(dirname(path), { persistent: false });
	watcher.on('change', (_event, filename) => {
		const name = filename?.toString();
		// Some platforms do not name the file; then either may have changed.
		if (name === undefined || name === recordName) listener('record');
		if (name === undefined || name === INSTALL_RECORD_NAME) listener('install');
	});
	// A watch that fails later is closed; the attempt still ends at its
	// deadlines and on a spawned upgrader's exit.
	watcher.on('error', () => watcher.close());
	return { close: () => watcher.close() };
}

/**
 * The argument vector an upgrade starts with. It is a function of the
 * install's environment and the mode and of nothing else: no version,
 * reference, URL, path, or flag from a client can reach it (ADR-0062).
 */
export function upgradeArguments(
	handover: Pick<ServerUpgradeHandover, 'environment' | 'mode' | 'allowOlder'>,
): readonly string[] {
	return Object.freeze([
		'daemon',
		'upgrade',
		...(handover.environment === 'user' ? ['--user'] : []),
		...(handover.mode === 'recreate' ? ['--recreate'] : []),
		// The one fixed flag a client's consent adds (ADR-0117). It names no
		// release: the upgrader still resolves the channel's newest itself.
		...(handover.allowOlder === true ? ['--allow-downgrade'] : []),
	]);
}

export interface ReleaseUpgraderOptions {
	/** Absolute path of the upgrader the running release ships. */
	readonly upgraderPath: string;
	/** The server's own environment; the upgrader needs what the service
	 * manager gave the server. Nothing from a client is ever added. */
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly checkTimeoutMs?: number;
	readonly maxOutputBytes?: number;
	/** Where the detached upgrader's output goes. Defaults to a new private
	 * directory under the OS temporary directory, made when first needed. */
	readonly logPath?: () => string;
	readonly spawn?: typeof spawnChild;
	readonly now?: () => number;
	/** What schedules a check's deadline. Defaults to the global timers. */
	readonly timers?: {
		setTimeout(handler: () => void, ms: number): unknown;
		clearTimeout(handle: unknown): void;
	};
}

/**
 * The upgrader the running release ships, run as its own process.
 *
 * The server learns about releases only by asking it, and hands an upgrade
 * to it rather than performing one, because the upgrade replaces the server
 * that asked.
 */
export function createReleaseUpgrader(
	options: ReleaseUpgraderOptions,
): ServerUpgrader {
	if (!isAbsolute(options.upgraderPath))
		throw new TypeError('the upgrader path must be absolute');
	const spawn = options.spawn ?? spawnChild;
	const timeoutMs = options.checkTimeoutMs ?? UPGRADE_CHECK_TIMEOUT_MS;
	const maxOutputBytes =
		options.maxOutputBytes ?? UPGRADE_CHECK_MAX_OUTPUT_BYTES;
	const env = { ...options.env } as NodeJS.ProcessEnv;
	const logPath =
		options.logPath ??
		(() =>
			join(mkdtempSync(join(tmpdir(), 'terminay-upgrade-')), 'upgrade.log'));
	const now = options.now ?? Date.now;
	const timers = options.timers ?? {
		setTimeout: (handler: () => void, ms: number) =>
			globalThis.setTimeout(handler, ms),
		clearTimeout: (handle: unknown) =>
			globalThis.clearTimeout(
				handle as ReturnType<typeof globalThis.setTimeout> | undefined,
			),
	};

	const check = (): Promise<ServerUpgradeCheckReport> =>
		new Promise((resolve, reject) => {
			let child: ChildProcess;
			try {
				// Its own process group, so a run that must be ended is ended
				// whole, launcher and runtime alike.
				child = spawn(options.upgraderPath, ['daemon', 'upgrade', '--check'], {
					detached: true,
					env,
					stdio: ['ignore', 'pipe', 'pipe'],
				});
			} catch (error) {
				reject(error);
				return;
			}
			const chunks: Buffer[] = [];
			let bytes = 0;
			let settled = false;
			// The last of what it said on stderr, so a failed check reaches the
			// operator with its reason rather than only its exit status.
			let stderr = '';
			child.stderr?.on('data', (chunk: Buffer) => {
				stderr = (stderr + chunk.toString('utf8')).slice(-1024);
			});
			// A run that overstays or overflows is ended and answered for at
			// once, without waiting on whatever still holds its output open.
			const stop = (error: Error): void => {
				try {
					if (child.pid === undefined) child.kill('SIGKILL');
					else process.kill(-child.pid, 'SIGKILL');
				} catch {
					child.kill('SIGKILL');
				}
				child.stdout?.destroy();
				child.stderr?.destroy();
				settle(error);
			};
			// A one-shot deadline on one run (ADR-0028 decision 3).
			const deadline = timers.setTimeout(
				() => stop(new Error('the upgrader did not answer in time')),
				timeoutMs,
			);
			function settle(error: Error | undefined, output?: string): void {
				if (settled) return;
				settled = true;
				timers.clearTimeout(deadline);
				if (error !== undefined) {
					reject(error);
					return;
				}
				try {
					resolve(parseUpgradeCheckOutput(output ?? ''));
				} catch (parseError) {
					reject(parseError);
				}
			}
			child.stdout?.on('data', (chunk: Buffer) => {
				bytes += chunk.byteLength;
				if (bytes > maxOutputBytes) {
					stop(
						new Error('the upgrader printed more than a check answers with'),
					);
					return;
				}
				chunks.push(chunk);
			});
			child.once('error', (error) => settle(error));
			child.once('close', (code, signal) => {
				if (code !== 0) {
					const reason = stderr.trim().split('\n').at(-1)?.trim();
					settle(
						new Error(
							`the upgrader's check ended with ${signal ?? `status ${code}`}${reason ? `: ${reason}` : ''}`,
						),
					);
				} else settle(undefined, Buffer.concat(chunks).toString('utf8'));
			});
		});

	const trigger = async (
		handover: ServerUpgradeHandover,
	): Promise<undefined | { readonly ended?: Promise<void> }> => {
		if (handover.trigger.kind === 'request-file') {
			// The root-owned helper starts one fixed command when this file
			// changes and never reads it, so it cannot carry a mode.
			if (handover.mode !== 'in-place')
				throw new Error('a request file starts an in-place upgrade only');
			// Moving backwards is the other helper's: its own file, its own
			// fixed command (ADR-0117).
			const path =
				handover.allowOlder === true
					? handover.trigger.latestPath
					: handover.trigger.path;
			if (path === undefined)
				throw new Error('this install has no helper that installs the latest release');
			await writeFile(path, `${now()}\n`, { mode: 0o600 });
			return undefined;
		}
		const log = openSync(logPath(), 'a', 0o600);
		try {
			return await new Promise((resolve, reject) => {
				// Its own session, so stopping this server's unit, or this server
				// exiting, does not end the process that is replacing it.
				const child = spawn(
					options.upgraderPath,
					[...upgradeArguments(handover)],
					{
						detached: true,
						env,
						stdio: ['ignore', log, log],
					},
				);
				const ended = new Promise<void>((finish) => {
					child.once('exit', () => finish());
				});
				child.once('error', reject);
				child.once('spawn', () => {
					child.unref();
					resolve({ ended });
				});
			});
		} finally {
			closeSync(log);
		}
	};

	return {
		check,
		trigger,
		readRecord: readUpgradeRunRecord,
		watchRecord: watchUpgradeRunRecord,
	};
}

/**
 * The upgrader of a standalone server started from a release, or `undefined`
 * where there is none to run: a server started from a checkout, and any
 * composition that is not the standalone `start` command.
 */
export function releaseUpgraderFromEnvironment(
	env: Readonly<Record<string, string | undefined>>,
): ServerUpgrader | undefined {
	const upgraderPath = env[TERMINAY_UPGRADER_ENV]?.trim();
	if (upgraderPath === undefined || upgraderPath.length === 0) return undefined;
	if (!isAbsolute(upgraderPath)) return undefined;
	return createReleaseUpgrader({ upgraderPath, env });
}
