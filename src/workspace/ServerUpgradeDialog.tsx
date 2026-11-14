/**
 * The confirmation before a server is asked to upgrade itself.
 *
 * It names the server and both versions and says what the upgrade costs: a
 * brief disconnect, and — only when the container is recreated — every
 * terminal on that server. Nothing is sent until Upgrade is pressed, and the
 * request names a mode the server offers and nothing else.
 */

import type { ServerUpgradeMode } from '@terminay/client-core';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DOWNGRADE_WARNING } from '../components/settings/UpdatesPages';
import { InPageWindow } from '../shared/inPageWindow/InPageWindow';
import {
	preselectedUpgradeMode,
	type ServerUpgradeEntry,
	upgradeConsequenceText,
} from './serverUpgradeModel.ts';
import type { ServerUpgradeConfirmationState } from './useServerUpgrades.ts';

const MODE_LABELS: Readonly<Record<ServerUpgradeMode, string>> = {
	'in-place': 'Upgrade in place',
	recreate: 'Recreate the container',
};

export type ServerUpgradeConfirmationProps = Readonly<{
	entry: ServerUpgradeEntry;
	mode: ServerUpgradeMode;
	onModeChange: (mode: ServerUpgradeMode) => void;
	/** The request is on its way. */
	isStarting: boolean;
	error?: string;
	onCancel: () => void;
	onConfirm: () => void;
	/** Confirms Install latest on the channel instead of an upgrade. */
	installLatest?: Readonly<{ version: string; downgrade: boolean }>;
}>;

/** The confirmation's body. It holds no state of its own. */
export function ServerUpgradeConfirmation({
	entry,
	error,
	isStarting,
	mode,
	onCancel,
	onConfirm,
	onModeChange,
	installLatest,
}: ServerUpgradeConfirmationProps) {
	const { status } = entry;
	const isRunning = status.upgrade.state === 'in-progress';
	const available = installLatest?.version ?? status.available?.version;
	return (
		<div
			className="project-edit-modal server-upgrade-dialog"
			data-server-upgrade-dialog={entry.profileId}
			{...(installLatest === undefined ? {} : { 'data-install-latest-dialog': 'server' })}
		>
			<p className="server-upgrade-dialog__summary">
				{entry.label} is running <strong>{status.version}</strong>.
				{available === undefined ? null : installLatest !== undefined ? (
					<>
						{' '}
						The latest release on its channel is <strong>{available}</strong>.
					</>
				) : (
					<>
						{' '}
						Version <strong>{available}</strong> is available.
					</>
				)}
			</p>
			{installLatest?.downgrade === true ? (
				<p className="server-upgrade-dialog__warning" data-install-latest-downgrade>
					{DOWNGRADE_WARNING}
				</p>
			) : null}
			{installLatest === undefined && status.modes.length > 1 ? (
				<div
					className="server-upgrade-dialog__modes"
					role="radiogroup"
					aria-label="How to upgrade"
				>
					{status.modes.map((offered) => (
						<label key={offered} className="server-upgrade-dialog__mode">
							<input
								type="radio"
								name="server-upgrade-mode"
								value={offered}
								checked={mode === offered}
								disabled={isStarting}
								onChange={() => onModeChange(offered)}
							/>
							<span>
								<span className="server-upgrade-dialog__mode-label">
									{MODE_LABELS[offered]}
								</span>
								{offered === 'recreate' ? (
									<span className="server-upgrade-dialog__mode-note">
										Ends every terminal on this server.
									</span>
								) : null}
							</span>
						</label>
					))}
				</div>
			) : null}
			<p
				className="server-upgrade-dialog__consequence"
				data-server-upgrade-consequence={mode}
			>
				{upgradeConsequenceText(mode)}
			</p>
			{error !== undefined || isRunning ? (
				<div className="server-upgrade-dialog__error" role="alert">
					{error ?? 'An upgrade is already running.'}
				</div>
			) : null}
			<div className="project-edit-actions">
				<button type="button" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					className="server-upgrade-dialog__primary"
					disabled={
						isStarting ||
						isRunning ||
						available === undefined ||
						!entry.reachable
					}
					onClick={onConfirm}
				>
					{isStarting ? 'Starting…' : installLatest === undefined ? 'Upgrade' : 'Install'}
				</button>
			</div>
		</div>
	);
}

export function ServerUpgradeDialog({
	confirmation,
}: Readonly<{ confirmation: ServerUpgradeConfirmationState }>) {
	const { close, entry, installLatest, start } = confirmation;
	// Install latest is in place only: recreating would pull the same image.
	const modes = installLatest === undefined ? entry.status.modes : (['in-place'] as const);
	const [mode, setMode] = useState(() => preselectedUpgradeMode(modes));
	const [isStarting, setIsStarting] = useState(false);
	const [error, setError] = useState<string>();
	// A mode the server stopped offering while this was open cannot be sent.
	useEffect(() => {
		if (!modes.includes(mode)) setMode(preselectedUpgradeMode(modes));
	}, [mode, modes]);
	const confirm = () => {
		setError(undefined);
		setIsStarting(true);
		void start(mode).then((refusal) => {
			setIsStarting(false);
			if (refusal === undefined) close();
			else setError(refusal);
		});
	};
	// Portalled out of the header so its window-drag regions cannot sit over
	// the confirmation.
	return createPortal(
		<InPageWindow
			icon={
				<TriangleAlert
					size={14}
					className="server-upgrade-dialog__title-icon"
				/>
			}
			kind={{ resizable: false, width: 440 }}
			name="server-upgrade"
			title={
				installLatest === undefined
					? `Upgrade ${entry.label}`
					: `Install latest on ${entry.label}`
			}
			onClose={close}
			busy={isStarting}
		>
			<ServerUpgradeConfirmation
				entry={entry}
				mode={mode}
				onModeChange={setMode}
				isStarting={isStarting}
				{...(error === undefined ? {} : { error })}
				{...(installLatest === undefined ? {} : { installLatest })}
				onCancel={close}
				onConfirm={confirm}
			/>
		</InPageWindow>,
		document.body,
	);
}
