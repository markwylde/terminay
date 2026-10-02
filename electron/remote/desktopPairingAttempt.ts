import type { TerminayPairingProgressState } from '@terminay/protocol';

export const DESKTOP_PAIRING_ATTEMPT_CANCELLED_MESSAGE =
	'Desktop pairing was cancelled.';

export type DesktopPairingApproval = Readonly<{
	deviceName: string;
	matchCode: string;
	expiresAt: number;
}>;

type ConnectionStatus = 'degraded' | 'recovered';

/**
 * One Desktop pairing attempt, from the pasted link to a mounted workspace.
 *
 * The sequence is kept apart from Electron so its ordering is testable: what
 * the user is told must follow what has actually happened. In particular the
 * profile is durable before the first reconnect, and "your server is saved" is
 * only ever implied by `connection-lost`, which is never reported before that
 * profile was written.
 */
export async function runDesktopPairingAttempt<Profile, Remote>(
	options: Readonly<{
		abort: AbortSignal;
		/** Pair and store the device identity. Rejects when the host denies the
		 * request, the link is stale, the peer is lost, or `abort` fires. */
		enroll: (
			hooks: Readonly<{
				abort: AbortSignal;
				onMatchCode: (approval: DesktopPairingApproval) => void;
				onConnectionStatus: (status: ConnectionStatus) => void;
			}>,
		) => Promise<Profile>;
		/** Persist the sanitized profile. Runs before any reconnect. */
		rememberProfile: (profile: Profile) => void;
		connect: (
			profile: Profile,
			hooks: Readonly<{
				onConnectionFailure: () => void;
				onConnectionStatus: (status: ConnectionStatus) => void;
			}>,
		) => Promise<Remote>;
		mount: (profile: Profile, remote: Remote) => Promise<void>;
		/** Undo whatever `mount` bound when the first load fails. */
		onLoadFailed?: (profile: Profile) => void;
		emitApproval: (approval: DesktopPairingApproval) => void;
		emitProgress: (state: TerminayPairingProgressState) => void;
	}>,
): Promise<void> {
	let phase: 'enrolling' | 'connecting' | 'connected' = 'enrolling';
	let lost = false;
	const reportLost = () => {
		if (lost) return;
		lost = true;
		options.emitProgress('connection-lost');
	};
	const reportStatus = (status: ConnectionStatus) => {
		if (lost) return;
		if (status === 'degraded') {
			options.emitProgress('connection-degraded');
			return;
		}
		// Recovery returns the surface to whatever the attempt was doing. Before
		// enrollment there is no progress state to return to, only the notice to
		// clear.
		options.emitProgress(
			phase === 'enrolling' ? 'connection-recovered' : phase,
		);
	};

	// A failure here leaves nothing saved, so it is reported only through the
	// rejection: `connection-lost` would promise a retryable profile.
	const profile = await options.enroll({
		abort: options.abort,
		onMatchCode: options.emitApproval,
		onConnectionStatus: reportStatus,
	});
	// Enrollment has stored the device key and pinned host identity. Persist
	// its sanitized profile now so a later reconnect or bundle failure cannot
	// strand that credential without a visible, retryable connection.
	options.rememberProfile(profile);
	if (options.abort.aborted)
		throw new Error(DESKTOP_PAIRING_ATTEMPT_CANCELLED_MESSAGE);
	phase = 'connecting';
	options.emitProgress('connecting');
	try {
		const remote = await options.connect(profile, {
			onConnectionFailure: reportLost,
			onConnectionStatus: reportStatus,
		});
		await options.mount(profile, remote);
		phase = 'connected';
		if (!lost) options.emitProgress('connected');
	} catch (error) {
		options.onLoadFailed?.(profile);
		reportLost();
		throw error;
	}
}

/**
 * The pairing attempts one window has in flight. A cancellation names its
 * attempt, so a late or repeated cancel cannot abort a newer one.
 */
export class DesktopPairingAttempts {
	private readonly controllers = new Map<string, AbortController>();

	begin(attemptId: string): AbortSignal {
		this.controllers.get(attemptId)?.abort();
		const controller = new AbortController();
		this.controllers.set(attemptId, controller);
		return controller.signal;
	}

	cancel(attemptId: string): boolean {
		const controller = this.controllers.get(attemptId);
		if (controller === undefined) return false;
		controller.abort();
		return true;
	}

	end(attemptId: string, signal: AbortSignal): void {
		if (this.controllers.get(attemptId)?.signal === signal)
			this.controllers.delete(attemptId);
	}

	cancelAll(): void {
		for (const controller of this.controllers.values()) controller.abort();
		this.controllers.clear();
	}
}
