import { rm } from 'node:fs/promises';

import type { DaemonOptions } from '../args.js';
import type { CommandContext } from '../context.js';
import {
	confirm,
	defaultStreams,
	isInteractive,
	type PromptStreams,
} from '../prompt.js';

/**
 * `daemon uninstall` — remove the service, keep the data.
 *
 * The data root holds the host key, the paired device records, and whatever
 * the operator's projects left behind. Removing it means every paired device
 * has to pair again and anything not backed up is gone, so it survives an
 * uninstall unless `--purge` asks for it and the operator confirms.
 */

export interface UninstallResult {
	readonly removedVersions: boolean;
	readonly removedDataRoot: boolean;
}

export class UninstallError extends Error {}

export async function runUninstall(
	options: DaemonOptions,
	context: CommandContext,
	streams: PromptStreams = defaultStreams(),
): Promise<UninstallResult> {
	const { layout, record, systemd, write } = context;

	let purge = false;
	if (options.purge) {
		if (options.yes) {
			purge = true;
		} else if (isInteractive(streams)) {
			purge = await confirm(
				`Remove ${record.dataRoot} as well? Every paired device will have to pair again, and anything stored there is gone.`,
				streams,
			);
			if (!purge) write('Keeping the data root.');
		} else {
			throw new UninstallError(
				'--purge removes the data root, so it needs --yes when there is no terminal to confirm on.',
			);
		}
	}

	// Stopped before the unit is removed, or systemd keeps supervising a
	// service whose definition no longer exists.
	await systemd.stop().catch(() => undefined);
	await systemd.disable();
	await rm(layout.unitPath, { force: true });
	await systemd.daemonReload();
	await systemd.resetFailed();

	await rm(layout.versionsDirectory, { recursive: true, force: true });
	await rm(layout.currentLink, { force: true });
	await rm(layout.recordPath, { force: true });
	await rm(layout.environmentFile, { force: true });

	if (purge) await rm(record.dataRoot, { recursive: true, force: true });

	write('Terminay Server is uninstalled.');
	write(
		purge
			? `Removed the data root at ${record.dataRoot}.`
			: `Kept the data root at ${record.dataRoot}.`,
	);
	return Object.freeze({ removedVersions: true, removedDataRoot: purge });
}

/**
 * `daemon reset-identity` — rotate the host key and revoke every device.
 *
 * The server owns the rotation; the CLI only wraps it in the stop and start it
 * requires. Confirmation is not politeness here: every paired device loses
 * access the moment this completes.
 */
export async function runResetIdentity(
	options: DaemonOptions,
	context: CommandContext,
	streams: PromptStreams = defaultStreams(),
): Promise<boolean> {
	const { record, systemd, write } = context;
	if (!options.yes) {
		if (!isInteractive(streams)) {
			throw new UninstallError(
				'resetting the identity unpairs every device, so it needs --yes when there is no terminal to confirm on.',
			);
		}
		const confirmed = await confirm(
			"Rotate this server's host key and revoke every paired device? They will all have to pair again.",
			streams,
		);
		if (!confirmed) {
			write('Left the identity unchanged.');
			return false;
		}
	}

	await systemd.stop();
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	await promisify(execFile)(
		`${context.layout.currentLink}/bin/terminay-server`,
		['reset-identity'],
		{
			timeout: 120_000,
			env: { ...process.env, TERMINAY_DATA_ROOT: record.dataRoot },
		},
	);
	await systemd.start();
	write(
		'The host key is rotated and every device is revoked. Pair again with `terminay daemon qr-code`.',
	);
	return true;
}
