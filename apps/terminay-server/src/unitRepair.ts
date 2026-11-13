import { execFile } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A standalone server that finds itself started under a systemd private
 * `/tmp` asks for its unit to be repaired (ADR-0115).
 *
 * `PrivateTmp=true` gives each run of the service its own `/tmp` and deletes it
 * when that run stops. Terminals outlive the run, so after a restart every held
 * shell, and every shell its session holder starts later, has a `/tmp` that no
 * longer exists. A release that runs here keeps its scratch files safe in a
 * shared `/tmp`, and its CLI writes no `PrivateTmp`. A unit can still carry it
 * when an older CLI performed the upgrade: that CLI is the one that ran, and
 * it knew nothing of this. So the server asks the system-scope upgrade helper,
 * which runs the CLI now installed, and that CLI repairs the unit before it
 * looks for any release.
 *
 * The request is the helper's own request file, the same one an upgrade from
 * the workspace writes. The helper reads nothing from it and runs one fixed
 * command, so no new privileged surface is added. It is written only once the
 * helper's service is idle: a path trigger that lands while the oneshot is
 * still running, as an older upgrader's readiness wait is, is merged into that
 * run and lost.
 */

/** The helper's oneshot, as `terminay daemon install --system` names it. */
export const UPGRADE_HELPER_SERVICE = 'terminay-upgrade.service';

/** How long to wait for a running helper: its own `TimeoutStartSec`. */
export const UPGRADE_HELPER_WAIT_MS = 30 * 60 * 1000;

const RECORD_FILE = 'unit-repair-request.json';

/**
 * Whether `/proc/self/mountinfo` shows `/tmp` as a systemd private temporary
 * directory: the mount at `/tmp` whose root lies under `/systemd-private-`.
 * The last mount at a point is the visible one.
 */
export function detectPrivateTmp(mountinfo: string): boolean {
	let privateTmp = false;
	for (const line of mountinfo.split('\n')) {
		// id parent major:minor root mount-point options ... - type source super
		const fields = line.split(' ');
		if (fields.length < 5) continue;
		const root = unescapeMountField(fields[3] as string);
		const mountPoint = unescapeMountField(fields[4] as string);
		if (mountPoint !== '/tmp') continue;
		privateTmp = root.includes('/systemd-private-');
	}
	return privateTmp;
}

function unescapeMountField(field: string): string {
	return field.replace(/\\([0-7]{3})/gu, (_match, octal: string) =>
		String.fromCharCode(Number.parseInt(octal, 8)),
	);
}

/** What the server says about its unit in `daemon status`. */
export type UnitRepairState =
	/** Not under a private /tmp: nothing to say. */
	| 'not-needed'
	/** The helper was asked; the next start should be under the host's /tmp. */
	| 'requested'
	/** Nothing could ask on the operator's behalf: they must run the upgrade. */
	| 'needed';

export interface UnitRepairDependencies {
	readonly dataRoot: string;
	/** The helper's request file, from the upgrader's check, when it has one. */
	readonly requestFile: () => Promise<string | undefined>;
	readonly readMountinfo?: () => Promise<string>;
	readonly readBootId?: () => Promise<string>;
	/** Whether the helper's oneshot is running now. */
	readonly helperActive?: () => Promise<boolean>;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly now?: () => number;
	readonly waitMs?: number;
	readonly onDiagnostic?: (message: string) => void;
}

/**
 * States in which the helper's oneshot is still running. A oneshot that is
 * executing reports `activating`, not `active`, so `is-active --quiet` alone
 * would call it idle.
 */
const BUSY_STATES = new Set([
	'active',
	'activating',
	'deactivating',
	'reloading',
	'refreshing',
]);

export function helperBusy(isActiveOutput: string): boolean {
	return BUSY_STATES.has(isActiveOutput.trim());
}

async function systemctlIsActive(unit: string): Promise<boolean> {
	return new Promise((resolve) => {
		// Exits non-zero for anything but `active`; the state is on stdout.
		execFile('systemctl', ['is-active', unit], (_error, stdout) =>
			resolve(helperBusy(String(stdout ?? ''))),
		);
	});
}

/**
 * Detect a private `/tmp`, and ask the helper to repair the unit at most once
 * per boot. Resolves with what `daemon status` should say; never rejects.
 */
export async function requestUnitRepairIfNeeded(
	dependencies: UnitRepairDependencies,
): Promise<UnitRepairState> {
	const diagnostic = dependencies.onDiagnostic ?? (() => undefined);
	try {
		const mountinfo = await (
			dependencies.readMountinfo ??
			(() => readFile('/proc/self/mountinfo', 'utf8'))
		)();
		if (!detectPrivateTmp(mountinfo)) return 'not-needed';
		diagnostic(
			'this server was started under a private /tmp, which every restart deletes from under the terminals it keeps',
		);

		const requestFile = await dependencies.requestFile().catch(() => undefined);
		if (requestFile === undefined) {
			diagnostic(
				'there is no upgrade helper to repair the unit; run `terminay daemon upgrade`',
			);
			return 'needed';
		}

		const bootId = (
			await (
				dependencies.readBootId ??
				(() => readFile('/proc/sys/kernel/random/boot_id', 'utf8'))
			)()
		).trim();
		const recordPath = join(dependencies.dataRoot, RECORD_FILE);
		const previous = await readFile(recordPath, 'utf8')
			.then((text) => JSON.parse(text) as { bootId?: unknown })
			.catch(() => undefined);
		if (previous?.bootId === bootId) {
			diagnostic(
				'the unit repair was already requested this boot and did not take; run `terminay daemon upgrade`',
			);
			return 'needed';
		}

		const helperActive =
			dependencies.helperActive ??
			(() => systemctlIsActive(UPGRADE_HELPER_SERVICE));
		const sleep =
			dependencies.sleep ??
			((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
		const now = dependencies.now ?? Date.now;
		const deadline = now() + (dependencies.waitMs ?? UPGRADE_HELPER_WAIT_MS);
		let delay = 1_000;
		while (await helperActive()) {
			if (now() >= deadline) {
				diagnostic(
					'the upgrade helper stayed busy, so the unit repair was not requested; run `terminay daemon upgrade`',
				);
				return 'needed';
			}
			await sleep(delay);
			delay = Math.min(delay * 2, 30_000);
		}

		// Recorded first, so a failure after this cannot become a loop.
		const temporary = `${recordPath}.tmp`;
		await writeFile(
			temporary,
			`${JSON.stringify({ bootId, at: new Date(now()).toISOString() })}\n`,
			{ mode: 0o600 },
		);
		await rename(temporary, recordPath);
		await writeFile(requestFile, `${now()}\n`, { mode: 0o600 });
		diagnostic('asked the upgrade helper to repair the unit');
		return 'requested';
	} catch (error) {
		diagnostic(
			`the unit repair could not be requested: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 'needed';
	}
}
