import QRCode from 'qrcode';

import type { DaemonOptions, PairingMode } from '../args.js';
import type { CommandContext } from '../context.js';
import {
	confirm,
	defaultStreams,
	isInteractive,
	type PromptStreams,
} from '../prompt.js';
import {
	type ApprovalResponse,
	approvalSocketPath,
	type PairingHandoff,
	type PendingApproval,
	requireOk,
	sendAsUser,
} from '../socket.js';

/**
 * `daemon qr-code` — pairing and approval on one screen.
 *
 * The runbook's version of this is: read the journal for a URL, type it into a
 * device, read the match code off the device, then run `approve <id>` in
 * another terminal before the room expires. This collapses that into one
 * command without moving where the decision happens: the match code is still
 * compared by a human on the host, and approval still goes to the server over
 * its owner-only socket. Nothing here can approve a device on its own.
 *
 * Neither a host key nor a device key is ever printed. The pairing URL's
 * fragment carries a one-time secret and is meant to be shown; a key is not.
 */

const POLL_INTERVAL_MS = 1_000;
const REFRESH_WINDOW_MS = 30_000;

export class PairingError extends Error {}

export interface PairingDependencies {
	readonly streams?: PromptStreams;
	readonly pollIntervalMs?: number;
	readonly now?: () => number;
	readonly renderQr?: (url: string) => Promise<string>;
	readonly send?: (
		request: Parameters<typeof sendAsUser>[1],
	) => Promise<ApprovalResponse>;
}

async function renderTerminalQr(url: string): Promise<string> {
	return QRCode.toString(url, { type: 'terminal', small: true });
}

function selectHandoff(
	handoffs: readonly PairingHandoff[],
	mode: PairingMode | undefined,
): PairingHandoff | undefined {
	if (mode !== undefined)
		return handoffs.find((handoff) => handoff.mode === mode);
	// Direct is preferred when it is on: it reaches the server without a relay,
	// which is the point of enabling it.
	return handoffs.find((handoff) => handoff.mode === 'direct') ?? handoffs[0];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PairingResult {
	readonly printed: readonly string[];
	readonly waited: boolean;
	readonly outcome?: 'approved' | 'denied';
	readonly deviceName?: string;
}

export async function runPairing(
	options: DaemonOptions,
	context: CommandContext,
	dependencies: PairingDependencies = {},
): Promise<PairingResult> {
	const { record, write } = context;
	const streams = dependencies.streams ?? defaultStreams();
	const now = dependencies.now ?? Date.now;
	const renderQr = dependencies.renderQr ?? renderTerminalQr;
	const socketPath = approvalSocketPath(record.dataRoot);
	const send =
		dependencies.send ??
		((request: Parameters<typeof sendAsUser>[1]) =>
			sendAsUser(socketPath, request, record.runAs));

	const fetchPairing = async (rotate: boolean) => {
		const response = requireOk(
			await send(rotate ? { op: 'pairing', rotate: true } : { op: 'pairing' }),
		);
		if (!('handoffs' in response))
			throw new PairingError(
				'the server did not return any pairing information',
			);
		if (response.exposure === 'off' || response.handoffs.length === 0) {
			throw new PairingError(
				'this server is not exposed, so there is no pairing URL to show. Reinstall with --expose hosted,direct, or edit the environment file and restart it.',
			);
		}
		return response;
	};

	let pairing = await fetchPairing(false);
	const printed: string[] = [];

	const show = async () => {
		const chosen = selectHandoff(pairing.handoffs, options.mode);
		if (chosen === undefined) {
			throw new PairingError(
				`this server does not expose a ${options.mode} pairing URL. Enabled modes: ${pairing.exposure === 'off' ? 'none' : pairing.exposure.join(', ')}.`,
			);
		}
		write(await renderQr(chosen.pairingUrl));
		write(`Scan this to pair, or open the ${chosen.mode} URL below.`);
		write('');
		for (const handoff of pairing.handoffs) {
			write(`  ${handoff.mode.padEnd(7)} ${handoff.pairingUrl}`);
			write(`  ${''.padEnd(7)} expires ${handoff.pairingExpiresAt}`);
			printed.push(handoff.pairingUrl);
		}
		write('');
	};

	await show();

	if (!options.wait) return Object.freeze({ printed, waited: false });

	if (!isInteractive(streams)) {
		write(
			'No terminal is attached, so there is nothing to approve on. Use `daemon approvals` and `daemon approve <id>`.',
		);
		return Object.freeze({ printed, waited: false });
	}

	write('Waiting for a device to scan it. Press Ctrl+C to stop.');
	for (;;) {
		const listed = requireOk(await send({ op: 'list' }));
		const pending: readonly PendingApproval[] =
			'pending' in listed ? listed.pending : [];
		const first = pending[0];
		if (first !== undefined) {
			write('');
			write(`Device:     ${first.deviceName}`);
			write(`Match code: ${first.matchCode}`);
			write('');
			write('Approve this device only if that code is the one shown on it.');
			const approved = await confirm('Approve?', streams);
			const outcome = requireOk(
				await send(
					approved
						? { op: 'approve', approvalId: first.approvalId }
						: { op: 'deny', approvalId: first.approvalId },
				),
			);
			const resolved =
				'outcome' in outcome
					? outcome.outcome
					: approved
						? 'approved'
						: 'denied';
			write(
				resolved === 'approved'
					? `${first.deviceName} is paired.`
					: `${first.deviceName} was denied.`,
			);
			return Object.freeze({
				printed,
				waited: true,
				outcome: resolved,
				deviceName: first.deviceName,
			});
		}

		// A room that expires while nobody is looking would leave a QR on
		// screen that no longer works, so it is replaced before that happens.
		const soonest = Math.min(
			...pairing.handoffs
				.map((handoff) => Date.parse(handoff.pairingExpiresAt))
				.filter((value) => Number.isFinite(value)),
		);
		if (Number.isFinite(soonest) && soonest - now() < REFRESH_WINDOW_MS) {
			pairing = await fetchPairing(true);
			write('');
			write('That pairing code expired. Here is a fresh one:');
			write('');
			await show();
			write('Waiting for a device to scan it. Press Ctrl+C to stop.');
		}
		await sleep(dependencies.pollIntervalMs ?? POLL_INTERVAL_MS);
	}
}

/** `daemon approvals`, `approve <id>`, and `deny <id>` for scripted use. */
export async function runApprovals(
	context: CommandContext,
	dependencies: PairingDependencies = {},
): Promise<readonly PendingApproval[]> {
	const socketPath = approvalSocketPath(context.record.dataRoot);
	const send =
		dependencies.send ??
		((request: Parameters<typeof sendAsUser>[1]) =>
			sendAsUser(socketPath, request, context.record.runAs));
	const response = requireOk(await send({ op: 'list' }));
	const pending: readonly PendingApproval[] =
		'pending' in response ? response.pending : [];
	if (pending.length === 0) {
		context.write('No devices are waiting for approval.');
		return pending;
	}
	for (const approval of pending) {
		context.write(
			`${approval.approvalId}  ${approval.deviceName}  match code ${approval.matchCode}`,
		);
	}
	return pending;
}

export async function runResolveApproval(
	action: 'approve' | 'deny',
	approvalId: string,
	context: CommandContext,
	dependencies: PairingDependencies = {},
): Promise<void> {
	const socketPath = approvalSocketPath(context.record.dataRoot);
	const send =
		dependencies.send ??
		((request: Parameters<typeof sendAsUser>[1]) =>
			sendAsUser(socketPath, request, context.record.runAs));
	const response = requireOk(await send({ op: action, approvalId }));
	const name = 'deviceName' in response ? response.deviceName : approvalId;
	context.write(
		action === 'approve' ? `${name} is paired.` : `${name} was denied.`,
	);
}
