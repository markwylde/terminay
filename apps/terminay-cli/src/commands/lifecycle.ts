import {
	type CommandContext,
	type ForegroundContext,
	socketSender,
} from '../context.js';
import { probeHealth, waitForReady } from '../health.js';
import { activeVersion } from '../install.js';
import {
	approvalSocketPath,
	requireOk,
	type ServerStatus,
	SocketError,
	sendAsUser,
} from '../socket.js';

/**
 * `daemon start`, `daemon stop`, and `daemon status`.
 *
 * `status` is deliberately thin. It reports the unit, the version, the channel,
 * readiness, and which exposure modes are on — and nothing else. Workspace
 * names, project paths, and device records are the operator's data, not
 * service metadata, and a status command is exactly the sort of thing that
 * ends up pasted into an issue.
 */

export async function runStart(context: CommandContext): Promise<boolean> {
	await context.systemd.start();
	const snapshot = await waitForReady(context.record.healthPort);
	if (snapshot !== undefined) {
		context.write(
			`Terminay Server ${snapshot.version ?? context.record.version} is ready.`,
		);
		return true;
	}
	context.write(
		'The server started but has not reported ready. Recent log lines:',
	);
	context.write(await context.systemd.journal(20));
	return false;
}

export async function runStop(context: CommandContext): Promise<void> {
	await context.systemd.stop();
	context.write('Terminay Server is stopped.');
}

export interface StatusReport {
	readonly unit: string;
	readonly enabled: boolean;
	readonly version: string;
	readonly channel: string;
	readonly revision: string;
	readonly ready: boolean;
	readonly exposure: readonly string[] | 'off';
	readonly activeVersion?: string;
	readonly advertiseAddress?: string;
}

export async function runStatus(
	context: CommandContext,
): Promise<StatusReport> {
	const [unit, enabled, snapshot, active] = await Promise.all([
		context.systemd.state(),
		context.systemd.isEnabled(),
		probeHealth(context.record.healthPort),
		activeVersion(context.layout),
	]);

	// Exposure is asked of the running server rather than read from the record,
	// so a hand-edited environment file cannot make the status lie.
	let exposure: readonly string[] | 'off' = context.record.expose
		.split(',')
		.filter((mode) => mode.length > 0);
	try {
		const response = requireOk(
			await sendAsUser(
				approvalSocketPath(context.record.dataRoot),
				{ op: 'pairing' },
				context.record.runAs,
			),
		);
		if ('exposure' in response) exposure = response.exposure;
	} catch {
		// A stopped server cannot answer; the configured modes stand.
	}

	const report: StatusReport = Object.freeze({
		unit,
		enabled,
		version: context.record.version,
		channel: context.record.channel,
		revision: context.record.revision,
		ready: snapshot?.ready === true,
		exposure,
		...(active === undefined ? {} : { activeVersion: active }),
		...(context.record.advertiseAddress === undefined
			? {}
			: { advertiseAddress: context.record.advertiseAddress }),
	});

	context.write(
		`unit         ${report.unit}${report.enabled ? ' (enabled)' : ' (not enabled)'}`,
	);
	context.write(`version      ${report.version}`);
	context.write(`channel      ${report.channel}`);
	context.write(`revision     ${report.revision.slice(0, 12)}`);
	context.write(`ready        ${report.ready ? 'yes' : 'no'}`);
	context.write(
		`exposure     ${report.exposure === 'off' ? 'off' : report.exposure.join(', ') || 'off'}`,
	);
	// Service configuration an operator needs when a connection fails, and it
	// names no workspace, path, account, or device.
	if (report.advertiseAddress !== undefined) {
		context.write(`advertised   ${report.advertiseAddress}`);
	}
	return report;
}

/**
 * `daemon status` for a server no service unit manages.
 *
 * There is no record to read and no unit to ask, so every line comes from the
 * running server over its owner-only socket. It is the same thin report: the
 * build, readiness, and how the server expects to be reached, and no path,
 * account, workspace, or device.
 */
export async function runForegroundStatus(
	context: ForegroundContext,
	send: ReturnType<typeof socketSender> = socketSender(context),
): Promise<ServerStatus> {
	const response = requireOk(await send({ op: 'status' }));
	if (!('status' in response))
		throw new SocketError('the running server did not report its status');
	const { status } = response;

	context.write('unit         none (no service unit manages this server)');
	context.write(`version      ${status.version}`);
	context.write(`revision     ${status.revision?.slice(0, 12) ?? 'unknown'}`);
	context.write(`ready        ${status.ready ? 'yes' : 'no'}`);
	context.write(`exposure     ${status.exposeModes.join(', ') || 'off'}`);
	context.write(`public host  ${status.publicHost ?? 'not set'}`);
	context.write(`advertised   ${status.advertiseAddress ?? 'not set'}`);
	return status;
}
