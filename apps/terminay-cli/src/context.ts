import { homedir } from 'node:os';
import { resolve } from 'node:path';

import type { DaemonCommand, DaemonOptions, InstallScope } from './args.js';
import {
	type InstallLayout,
	type InstallRecord,
	installLayout,
	readInstallRecord,
} from './layout.js';
import {
	type ApprovalRequest,
	type ApprovalResponse,
	approvalSocketPath,
	noForegroundServerMessage,
	sendApprovalRequest,
	sendAsUser,
} from './socket.js';
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

/**
 * A server nobody installed: one run in the foreground, as a container's main
 * process is. There is no record, no unit, and no account to drop to — only
 * the data root it was started against, which the invoking account must
 * already own for the socket inside it to open.
 */
export interface ForegroundContext {
	readonly dataRoot: string;
	readonly write: (line: string) => void;
}

/** The commands that only talk to a running server, so need no install. */
export const FOREGROUND_COMMANDS: readonly DaemonCommand[] = [
	'status',
	'qr-code',
	'approvals',
	'approve',
	'deny',
];

/** The lifecycle commands, which a container runtime owns when it is there. */
const CONTAINER_ACTIONS: Readonly<Partial<Record<DaemonCommand, string>>> =
	Object.freeze({
		install:
			'To install a different version, pull a newer image and recreate the container.',
		upgrade: 'To upgrade, pull a newer image and recreate the container.',
		start: 'To start it, run `docker start <container>`.',
		stop: 'To stop it, run `docker stop <container>`.',
		uninstall:
			'To uninstall, remove the container with `docker rm <container>`; to delete its data as well, remove its volume with `docker volume rm <volume>`.',
	});

export class NotInstalledError extends Error {}
export class ContainerManagedError extends Error {}

/**
 * Refuse a lifecycle command where a container runtime manages the server.
 *
 * Called before anything is resolved, downloaded, or written: inside an image
 * the server is the container's main process, so there is no unit to drive and
 * an install would only leave a second, unmanaged copy beside it.
 */
export function assertNotContainerManaged(
	command: DaemonCommand,
	env: Readonly<Record<string, string | undefined>> = process.env,
): void {
	const action = CONTAINER_ACTIONS[command];
	if (action === undefined || env.TERMINAY_MANAGED_BY !== 'container') return;
	throw new ContainerManagedError(
		`this Terminay Server is managed by the container runtime, so \`daemon ${command}\` changes nothing here. ${action}`,
	);
}

export function isForeground(
	context: CommandContext | ForegroundContext,
): context is ForegroundContext {
	return !('record' in context);
}

/**
 * How a command reaches the server's owner-only socket.
 *
 * An installed server may need a drop to its run-as account. A foreground one
 * is reached as whoever is asking: no `sudo`, no systemd, and a refusal that
 * names the data root when nothing is listening there.
 */
export function socketSender(
	context: CommandContext | ForegroundContext,
): (request: ApprovalRequest) => Promise<ApprovalResponse> {
	if (isForeground(context)) {
		const socketPath = approvalSocketPath(context.dataRoot);
		const message = noForegroundServerMessage(context.dataRoot);
		return (request) => sendApprovalRequest(socketPath, request, message);
	}
	const socketPath = approvalSocketPath(context.record.dataRoot);
	const runAs = context.record.runAs;
	return (request) => sendAsUser(socketPath, request, runAs);
}

export interface ResolveContextOptions {
	readonly options: DaemonOptions;
	readonly home?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly write?: (line: string) => void;
}

export interface ResolveForegroundOptions extends ResolveContextOptions {
	readonly command: DaemonCommand;
}

/**
 * The foreground server a command should talk to, when there is one.
 *
 * Only when nothing is installed and the environment names a data root. An
 * install record always wins, so a machine with a service behaves exactly as
 * it did, and a scope flag asks for an installation by name, so it is never
 * answered with a foreground server instead.
 */
export async function resolveForeground(
	options: ResolveForegroundOptions,
): Promise<ForegroundContext | undefined> {
	const dataRoot = (options.env ?? process.env).TERMINAY_DATA_ROOT;
	if (
		options.options.scope !== undefined ||
		dataRoot === undefined ||
		dataRoot.length === 0 ||
		!FOREGROUND_COMMANDS.includes(options.command)
	)
		return undefined;
	const home = options.home ?? homedir();
	for (const scope of ['system', 'user'] as const) {
		const record = await readInstallRecord(installLayout(scope, home)).catch(
			() => undefined,
		);
		if (record !== undefined) return undefined;
	}
	return Object.freeze({
		dataRoot: resolve(dataRoot),
		write:
			options.write ?? ((line: string) => process.stdout.write(`${line}\n`)),
	});
}

export async function resolveContext(
	options: ResolveContextOptions,
): Promise<CommandContext> {
	const home = options.home ?? homedir();
	const write =
		options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
	const requested = options.options.scope;

	const candidates: InstallScope[] =
		requested === undefined ? ['system', 'user'] : [requested];
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
		systemd: createSystemd({
			scope: only.layout.scope,
			...(options.env === undefined ? {} : { env: options.env }),
		}),
		write,
	});
}
