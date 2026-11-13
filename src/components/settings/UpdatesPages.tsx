import { useEffect, useState } from 'react';
import { checkForAppUpdate } from '../../host/nativeActions';
import { subscribeAppUpdateStatusChanged } from '../../host/nativeEvents';
import type { AppUpdateStatus } from '../../types/terminay';
import {
	type DeviceUpdateStatusLike,
	deviceVersionLines,
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
	return (
		<section className="settings-section" id="section-device-versions" aria-label="Versions">
			<div className="settings-section-title-row">
				<h3 className="settings-section-title">Versions</h3>
			</div>
			<VersionLines lines={deviceVersionLines(status, channel, formatCheckTime)} />
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
	onOpenDeviceUpdates,
}: Readonly<{
	model: ServerUpdatesModel;
	serverName: string;
	onUpgrade?: () => void;
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
