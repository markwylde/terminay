import { homedir } from 'node:os';

import type { DaemonOptions, InstallScope } from './args.js';
import { type InstallLayout, type InstallRecord, installLayout, readInstallRecord } from './layout.js';
import { createSystemd, type Systemd } from './systemd.js';

/**
 * What every command after `install` needs: which installation it is acting
 * on, and the record describing it.
 *
 * A machine can hold a system install and a user install at once, so a command
 * with no scope flag looks for whichever one actually exists rather than
 * guessing. Finding both without a flag is ambiguous and says so.
 */

export interface CommandContext {
	readonly layout: InstallLayout;
	readonly record: InstallRecord;
	readonly systemd: Systemd;
	readonly write: (line: string) => void;
}

export class NotInstalledError extends Error {}

export interface ResolveContextOptions {
	readonly options: DaemonOptions;
	readonly home?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly write?: (line: string) => void;
}

export async function resolveContext(options: ResolveContextOptions): Promise<CommandContext> {
	const home = options.home ?? homedir();
	const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
	const requested = options.options.scope;

	const candidates: InstallScope[] = requested === undefined ? ['system', 'user'] : [requested];
	const found: { layout: InstallLayout; record: InstallRecord }[] = [];
	for (const scope of candidates) {
		const layout = installLayout(scope, home);
		const record = await readInstallRecord(layout).catch(() => undefined);
		if (record !== undefined) found.push({ layout, record });
	}

	if (found.length === 0) {
		throw new NotInstalledError(
			requested === undefined
				? 'no Terminay Server is installed on this machine. Install one with `npx terminay daemon install`.'
				: `no ${requested}-scope Terminay Server is installed on this machine.`,
		);
	}
	if (found.length > 1) {
		throw new NotInstalledError(
			'both a system-wide and a user install exist here. Choose one with --system or --user.',
		);
	}

	const [only] = found as [{ layout: InstallLayout; record: InstallRecord }];
	return Object.freeze({
		layout: only.layout,
		record: only.record,
		systemd: createSystemd({ scope: only.layout.scope, ...(options.env === undefined ? {} : { env: options.env }) }),
		write,
	});
}
