import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { checkForAppUpdate, installLatestAppUpdate } from '../../host/nativeActions';
import { subscribeAppUpdateStatusChanged } from '../../host/nativeEvents';
import { InPageWindow } from '../../shared/inPageWindow/InPageWindow';
import type { AppUpdateStatus } from '../../types/terminay';
import {
	type DeviceUpdateStatusLike,
	deviceInstallLatest,
	deviceVersionLines,
	type InstallLatestAction,
	type ServerUpdatesModel,
	type TrackCommand,
	type VersionLine,
} from './updatesPageModel';

function formatCheckTime(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Running and Latest, each with the exact version and what it means. */
export function VersionLines({ lines }: Readonly<{ lines: readonly VersionLine[] }>) {
	return (
		<div className="settings-group settings-version-lines">
			{lines.map((line) => (
				<div className="settings-row" key={line.label} data-version-line={line.label}>
					<div className="settings-row-info">
						<span className="settings-row-label">{line.label}</span>
						{line.note === undefined ? null : (
							<span
								className={`settings-row-description settings-version-note${
									line.tone === undefined ? '' : ` settings-version-note--${line.tone}`
								}`}
							>
								{line.note}
							</span>
						)}
					</div>
					<div className="settings-row-control">
						{line.version === undefined ? null : (
							<code className="settings-code settings-version" title={line.version}>
								{line.version}
							</code>
						)}
					</div>
				</div>
			))}
		</div>
	);
}

/**
 * The Install latest row: the target build, and a button that opens the
 * confirmation. Disabled with its reason when it cannot run.
 */
export function InstallLatestRow({
	action,
	onChoose,
}: Readonly<{ action: InstallLatestAction; onChoose: () => void }>) {
	const [copied, setCopied] = useState(false);
	const { command } = action;
	return (
		<div className="settings-row" data-install-latest={action.enabled ? 'enabled' : 'disabled'}>
			<div className="settings-row-info">
				<span className="settings-row-label">{action.label}</span>
				<span className="settings-row-description">
					{action.reason ??
						(action.downgrade
							? `Installs ${action.version}, which is older than the running build.`
							: `Installs ${action.version}.`)}
				</span>
				{command === undefined ? null : (
					<code className="settings-code settings-track-command">{command}</code>
				)}
			</div>
			<div className="settings-row-control">
				{command === undefined ? null : (
					<button
						type="button"
						className="settings-secondary-button settings-secondary-button--small"
						onClick={() => {
							void navigator.clipboard
								?.writeText(command)
								.then(() => setCopied(true))
								.catch(() => undefined);
						}}
					>
						{copied ? 'Copied' : 'Copy'}
					</button>
				)}
				<button
					type="button"
					className="settings-secondary-button"
					disabled={!action.enabled}
					onClick={onChoose}
				>
					Install latest…
				</button>
			</div>
		</div>
	);
}

/** What moving to an older build may cost, said once wherever it is confirmed. */
export const DOWNGRADE_WARNING =
	'This is older than what is running now. Settings and state written by the newer release might not carry over.';

/** The confirmation before Terminay Desktop installs its channel's latest build. */
export function DeviceInstallLatestConfirmation({
	action,
	currentVersion,
	error,
	progress,
	onCancel,
	onConfirm,
}: Readonly<{
	action: InstallLatestAction;
	currentVersion: string;
	error?: string;
	/** Set once confirmed: what the download is doing. */
	progress?: string;
	onCancel: () => void;
	onConfirm: () => void;
}>) {
	const busy = progress !== undefined;
	return (
		<div className="project-edit-modal server-upgrade-dialog" data-install-latest-dialog="device">
			<p className="server-upgrade-dialog__summary">
				Terminay is running <strong>{currentVersion}</strong>. {action.label} installs{' '}
				<strong>{action.version}</strong>.
			</p>
			{action.downgrade ? (
				<p className="server-upgrade-dialog__warning" data-install-latest-downgrade>
					{DOWNGRADE_WARNING}
				</p>
			) : null}
			<p className="server-upgrade-dialog__consequence">
				Terminay downloads and verifies it, then restarts into it. Terminals keep running.
			</p>
			{progress === undefined ? null : (
				<p className="server-upgrade-dialog__consequence" role="status">
					{progress}
				</p>
			)}
			{error === undefined ? null : (
				<div className="server-upgrade-dialog__error" role="alert">
					{error}
				</div>
			)}
			<div className="project-edit-actions">
				<button type="button" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					className="server-upgrade-dialog__primary"
					disabled={busy}
					onClick={onConfirm}
				>
					{busy ? 'Installing…' : 'Install and restart'}
				</button>
			</div>
		</div>
	);
}

function downloadProgress(status: DeviceUpdateStatusLike): string | undefined {
	if (status.installingLatest == null) return undefined;
	const percent = (status as AppUpdateStatus).downloadPercent;
	return typeof percent === 'number'
		? `Downloading ${status.installingLatest}… ${Math.round(percent)}%`
		: `Downloading ${status.installingLatest}…`;
}

/** What this device's update channel reaches, in one line. */
export function DeviceUpdatesNote({ deviceName }: Readonly<{ deviceName: string }>) {
	return (
		<p className="settings-section-desc settings-updates-reach">
			This channel updates Terminay Desktop on {deviceName.replace(/^This /, 'this ')} and
			the Local server built into it. It does not change any other server; each server's
			Updates page shows its own track.
		</p>
	);
}

/**
 * Terminay Desktop's exact versions. The host's updater paces its own checks,
 * so asking for its status here costs no extra network check.
 */
export function DeviceUpdateVersions({ channel }: Readonly<{ channel: string | undefined }>) {
	const [status, setStatus] = useState<DeviceUpdateStatusLike | null>(null);
	useEffect(() => {
		let current = true;
		const refresh = () => {
			void checkForAppUpdate()
				.then((next: AppUpdateStatus | null) => {
					if (current && next !== null) setStatus(next);
				})
				.catch(() => undefined);
		};
		refresh();
		const stop = subscribeAppUpdateStatusChanged(refresh);
		return () => {
			current = false;
			stop();
		};
	}, [channel]);
	const [confirming, setConfirming] = useState(false);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string>();
	const install = deviceInstallLatest(status, channel);
	// A download in progress is reported while the dialog stays open; the host
	// restarts once it is verified.
	const progress =
		status === null ? undefined : (downloadProgress(status) ?? (starting ? 'Starting…' : undefined));
	const confirm = (version: string) => {
		setError(undefined);
		setStarting(true);
		void installLatestAppUpdate(version)
			.then((next) => {
				if (next === null) {
					setError('This host cannot install updates.');
					return;
				}
				setStatus(next);
				if (next.installingLatest == null && next.errorMessage !== null)
					setError(next.errorMessage);
			})
			.catch((reason: unknown) => {
				setError(reason instanceof Error ? reason.message : String(reason));
			})
			.finally(() => setStarting(false));
	};
	return (
		<section className="settings-section" id="section-device-versions" aria-label="Versions">
			<div className="settings-section-title-row">
				<h3 className="settings-section-title">Versions</h3>
			</div>
			<VersionLines lines={deviceVersionLines(status, channel, formatCheckTime)} />
			{install === null ? null : (
				<div className="settings-group">
					<InstallLatestRow
						action={install}
						onChoose={() => {
							setError(undefined);
							setConfirming(true);
						}}
					/>
				</div>
			)}
			{confirming && status !== null && install?.version !== undefined
				? createPortal(
						<InPageWindow
							icon={<TriangleAlert size={14} className="server-upgrade-dialog__title-icon" />}
							kind={{ resizable: false, width: 440 }}
							name="install-latest"
							title={install.label}
							onClose={() => setConfirming(false)}
							busy={progress !== undefined}
						>
							<DeviceInstallLatestConfirmation
								action={install}
								currentVersion={status.currentVersion}
								{...(error === undefined ? {} : { error })}
								{...(progress === undefined || error !== undefined ? {} : { progress })}
								onCancel={() => setConfirming(false)}
								onConfirm={() => confirm(install.version as string)}
							/>
						</InPageWindow>,
						document.body,
					)
				: null}
		</section>
	);
}

function CopyCommand({ command }: Readonly<{ command: TrackCommand }>) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="settings-row" data-track-command={command.label}>
			<div className="settings-row-info">
				<span className="settings-row-label">Move to {command.label}</span>
				<code className="settings-code settings-track-command">{command.command}</code>
			</div>
			<div className="settings-row-control">
				<button
					type="button"
					className="settings-secondary-button settings-secondary-button--small"
					onClick={() => {
						void navigator.clipboard
							?.writeText(command.command)
							.then(() => setCopied(true))
							.catch(() => undefined);
					}}
				>
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
		</div>
	);
}

/** A server's Updates page: its track, its exact versions, how to move it. */
export function ServerUpdatesPage({
	model,
	serverName,
	onUpgrade,
	onInstallLatest,
	onCheck,
	check,
	onOpenDeviceUpdates,
}: Readonly<{
	model: ServerUpdatesModel;
	serverName: string;
	onUpgrade?: () => void;
	onInstallLatest?: () => void;
	/** Ask the server to read its release channel now. */
	onCheck?: () => void;
	/** The check in flight, or the line the last one left. */
	check?: Readonly<{ checking: boolean; result?: string }>;
	onOpenDeviceUpdates?: () => void;
}>) {
	if (model.kind === 'local')
		return (
			<section className="settings-section" aria-label="Local server updates">
				<div className="settings-section-title-row">
					<h3 className="settings-section-title">Release track</h3>
				</div>
				<p className="settings-section-desc">
					The Local server is built into Terminay Desktop and follows its update channel.
				</p>
				{model.running === undefined ? null : <VersionLines lines={[model.running]} />}
				{onOpenDeviceUpdates === undefined ? null : (
					<div className="settings-inline-actions settings-detail-buttons">
						<button
							type="button"
							className="settings-secondary-button"
							onClick={onOpenDeviceUpdates}
						>
							Open Terminay Desktop updates
						</button>
					</div>
				)}
			</section>
		);
	if (model.kind === 'no-status')
		return (
			<section className="settings-section" aria-label="Server updates">
				{model.running === undefined ? null : <VersionLines lines={[model.running]} />}
				<p className="settings-section-desc">
					{serverName} does not report a release track.
				</p>
			</section>
		);
	return (
		<>
			<section className="settings-section" aria-label="Release track">
				<div className="settings-section-title-row">
					<h3 className="settings-section-title">Release track</h3>
					<span className="settings-status-pill" data-server-track={model.trackLabel}>
						{model.trackLabel}
					</span>
				</div>
				<VersionLines lines={[model.running, model.latest]} />
				{onCheck === undefined ? null : (
					<div className="settings-inline-actions settings-detail-buttons">
						<button
							type="button"
							className="settings-secondary-button"
							data-server-update-check
							disabled={check?.checking === true}
							onClick={onCheck}
						>
							{check?.checking === true ? 'Checking…' : 'Check for updates'}
						</button>
						<span className="settings-section-desc" role="status">
							{check?.checking === true ? '' : (check?.result ?? '')}
						</span>
					</div>
				)}
				{model.installLatest === undefined || onInstallLatest === undefined ? null : (
					<div className="settings-group">
						<InstallLatestRow action={model.installLatest} onChoose={onInstallLatest} />
					</div>
				)}
				{model.upgradeAvailable && onUpgrade !== undefined ? (
					<div className="settings-inline-actions settings-detail-buttons">
						<button type="button" className="settings-primary-button" onClick={onUpgrade}>
							Upgrade {serverName}…
						</button>
					</div>
				) : null}
			</section>
			{model.commands.length === 0 ? null : (
				<section className="settings-section" aria-label="Change track">
					<div className="settings-section-title-row">
						<h3 className="settings-section-title">Change track</h3>
					</div>
					<p className="settings-section-desc">
						Run one of these on the server's host. A system install runs it with{' '}
						<code>sudo</code>. A host with both a system and a user install adds{' '}
						<code>--system</code> or <code>--user</code>. A move to an older release
						adds <code>--allow-downgrade</code>. A server in a container changes track
						by its image tag instead.
					</p>
					<div className="settings-group">
						{model.commands.map((command) => (
							<CopyCommand key={command.label} command={command} />
						))}
					</div>
				</section>
			)}
		</>
	);
}
