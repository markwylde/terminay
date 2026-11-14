/**
 * A server upgrade as one ticklist.
 *
 * The upgrade restarts the server, so the window loses its connection on the
 * way. Each drop is a step of the upgrade the person asked for, not a fault,
 * and this card is what the window shows for it, from the server accepting to
 * how it ended. It reads only the board's derived steps.
 */

import { Check, Circle, LoaderCircle, X } from 'lucide-react';
import type {
	ServerUpgradeProgressView,
	ServerUpgradeStepState,
} from './serverUpgradeModel.ts';

const STATE_TEXT: Readonly<Record<ServerUpgradeStepState, string>> = {
	waiting: 'Waiting',
	running: 'In progress',
	done: 'Done',
	failed: 'Failed',
};

function StepIcon({ state }: Readonly<{ state: ServerUpgradeStepState }>) {
	const props = {
		size: 14,
		'aria-hidden': true,
		className: 'server-upgrade-progress__icon',
	} as const;
	switch (state) {
		case 'done':
			return <Check {...props} />;
		case 'failed':
			return <X {...props} />;
		case 'running':
			return <LoaderCircle {...props} />;
		default:
			return <Circle {...props} />;
	}
}

export function serverUpgradeProgressTitle(
	progress: ServerUpgradeProgressView,
): string {
	if (progress.outcome === 'success') return `${progress.label} is upgraded`;
	if (progress.outcome === 'failure')
		return `${progress.label} was not upgraded`;
	return `Upgrading ${progress.label}`;
}

export type ServerUpgradeProgressProps = Readonly<{
	progress: ServerUpgradeProgressView;
	/** Absent until the upgrade has ended: nothing puts it away before. */
	onClose?: () => void;
}>;

export function ServerUpgradeProgress({
	onClose,
	progress,
}: ServerUpgradeProgressProps) {
	const title = serverUpgradeProgressTitle(progress);
	return (
		<section
			className="server-upgrade-progress"
			role="status"
			aria-live="polite"
			aria-label={title}
			data-server-upgrade-progress={progress.profileId}
			data-server-upgrade-outcome={progress.outcome ?? 'running'}
		>
			<header className="server-upgrade-progress__header">
				<h2 className="server-upgrade-progress__title">{title}</h2>
				{progress.from === undefined || progress.to === undefined ? null : (
					<p className="server-upgrade-progress__versions">
						{progress.from} → {progress.to}
					</p>
				)}
			</header>
			<ol className="server-upgrade-progress__steps">
				{progress.steps.map((step) => (
					<li
						key={step.id}
						className={`server-upgrade-progress__step server-upgrade-progress__step--${step.state}`}
						data-step={step.id}
						data-step-state={step.state}
					>
						<StepIcon state={step.state} />
						<span className="server-upgrade-progress__label">
							{step.label}
							<span className="server-upgrade-progress__state">
								{`, ${STATE_TEXT[step.state]}`}
							</span>
						</span>
						{step.detail === undefined ? null : (
							<p className="server-upgrade-progress__detail">{step.detail}</p>
						)}
					</li>
				))}
			</ol>
			{progress.restarting ? (
				<p className="server-upgrade-progress__note">
					Disconnected while the server restarts. This reconnects by itself.
				</p>
			) : null}
			{onClose === undefined ? null : (
				<div className="server-upgrade-progress__actions">
					<button type="button" onClick={onClose}>
						Close
					</button>
				</div>
			)}
		</section>
	);
}
