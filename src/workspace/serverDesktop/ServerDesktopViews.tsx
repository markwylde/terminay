/**
 * The server desktop window's contents for each state the server reports,
 * and the header control that opens it. Nothing here holds state or reaches
 * a server: the window passes what the server said and what to do.
 */

import type {
	ServerDesktopController,
	ServerDesktopMode,
	ServerDesktopStatus,
} from '@terminay/client-core';
import {
	Check,
	Copy,
	Eye,
	Monitor,
	MousePointer2,
	Power,
	RefreshCw,
	TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
	controlLine,
	serverDesktopButtonLabel,
	setupAction,
	setupPercent,
	setupStepStates,
	turnOffConfirmation,
} from './serverDesktopModel.ts';

/** The control beside the server menu. Rendered only for a server that
 * offers a desktop. */
export function ServerDesktopButton({
	serverLabel,
	isOpen,
	onActivate,
}: Readonly<{
	serverLabel: string;
	isOpen: boolean;
	onActivate: () => void;
}>) {
	return (
		<div
			className={`terminal-activity-status server-desktop-status${isOpen ? ' terminal-activity-status--open' : ''}`}
		>
			<button
				type="button"
				className="terminal-activity-button"
				onClick={onActivate}
				title="Show desktop"
				aria-label={serverDesktopButtonLabel(serverLabel)}
				aria-pressed={isOpen}
				data-server-desktop-button="true"
			>
				<Monitor size={15} aria-hidden="true" />
			</button>
		</div>
	);
}

export type ServerDesktopActions = Readonly<{
	/** Ask the server to run setup. */
	onSetup: () => void;
	/** Ask the server to look at its host again. */
	onCheckAgain: () => void;
	onTurnOn: () => void;
	onCopyCommand: (command: string) => void;
}>;

function ManualCommand({
	command,
	copied,
	onCopy,
}: Readonly<{ command: string; copied: boolean; onCopy: () => void }>) {
	return (
		<div className="server-desktop__command">
			<code data-server-desktop-command="true">{command}</code>
			<button
				type="button"
				onClick={onCopy}
				aria-label="Copy the command"
				data-server-desktop-copy="true"
			>
				{copied ? (
					<Check size={13} aria-hidden="true" />
				) : (
					<Copy size={13} aria-hidden="true" />
				)}
				{copied ? 'Copied' : 'Copy'}
			</button>
		</div>
	);
}

function StepList({
	current,
	failed = false,
}: Readonly<{
	current: Parameters<typeof setupStepStates>[0];
	failed?: boolean;
}>) {
	return (
		<ol className="server-desktop__steps">
			{setupStepStates(current, failed).map((entry) => (
				<li
					key={entry.step}
					data-server-desktop-step={entry.step}
					data-step-state={entry.state}
					{...(entry.state === 'current' ? { 'aria-current': 'step' } : {})}
				>
					{entry.label}
				</li>
			))}
		</ol>
	);
}

/**
 * Every state but `ready`: what the desktop needs, how far setup has got,
 * or why there is none. `unsupported` offers nothing to press.
 */
export function ServerDesktopStateView({
	status,
	busy,
	error,
	copied,
	actions,
}: Readonly<{
	status: Exclude<ServerDesktopStatus, { state: 'ready' }>;
	/** A request of this window's is on its way. */
	busy: boolean;
	error?: string;
	copied: boolean;
	actions: ServerDesktopActions;
}>) {
	const action = setupAction(status);
	const command =
		status.state === 'needs-setup' || status.state === 'failed'
			? status.command
			: undefined;
	let body: ReactNode;
	if (status.state === 'unsupported') {
		body = (
			<>
				<h3>This server cannot show a desktop</h3>
				<p data-server-desktop-reason={status.reason}>{status.message}</p>
			</>
		);
	} else if (status.state === 'needs-setup') {
		body = (
			<>
				<h3>Set up the desktop</h3>
				<p>
					Programs you start in a terminal on this server can open their
					windows here. The desktop needs some Debian packages first: a display
					server and a small window environment. Nothing listens on the
					network; the desktop is reached only through Terminay.
				</p>
				{action === 'command' ? (
					<p>Run this on the server, then check again:</p>
				) : null}
			</>
		);
	} else if (status.state === 'setting-up') {
		const percent = setupPercent(status.fraction);
		body = (
			<>
				<h3>Setting up the desktop</h3>
				<div
					className="server-desktop__progress"
					role="progressbar"
					aria-label="Desktop setup"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={percent}
					data-server-desktop-progress={percent}
				>
					<span style={{ width: `${percent}%` }} />
				</div>
				<StepList current={status.step} />
				<p className="server-desktop__faint">
					Setup carries on if you close this window.
				</p>
			</>
		);
	} else if (status.state === 'off') {
		body = (
			<>
				<h3>The desktop is turned off</h3>
				<p>
					New terminals on this server are not given a display while it is off.
				</p>
			</>
		);
	} else {
		body = (
			<>
				<h3>
					<TriangleAlert size={15} aria-hidden="true" />{' '}
					{status.step === undefined || status.step === 'starting'
						? 'The desktop could not start'
						: 'Setup did not finish'}
				</h3>
				{status.step === undefined ? null : (
					<StepList current={status.step} failed />
				)}
				<p className="server-desktop__reason" role="alert">
					{status.reason}
				</p>
				{action === 'command' ? (
					<p>Run this on the server, then check again:</p>
				) : null}
			</>
		);
	}
	return (
		<div className="server-desktop__state" data-server-desktop-state={status.state}>
			{body}
			{command !== undefined && action === 'command' ? (
				<ManualCommand
					command={command}
					copied={copied}
					onCopy={() => actions.onCopyCommand(command)}
				/>
			) : null}
			{error === undefined ? null : (
				<p className="server-desktop__reason" role="alert">
					{error}
				</p>
			)}
			<div className="server-desktop__actions">
				{action === 'setup' ? (
					<button
						type="button"
						className="server-desktop__primary"
						disabled={busy}
						onClick={actions.onSetup}
						data-server-desktop-action="setup"
					>
						{status.state === 'failed' ? 'Try again' : 'Set up desktop'}
					</button>
				) : null}
				{action === 'command' || action === 'check' ? (
					<button
						type="button"
						className={action === 'check' ? 'server-desktop__primary' : ''}
						disabled={busy}
						onClick={actions.onCheckAgain}
						data-server-desktop-action="check"
					>
						<RefreshCw size={13} aria-hidden="true" />{' '}
						{action === 'check' ? 'Try again' : 'Check again'}
					</button>
				) : null}
				{status.state === 'off' ? (
					<button
						type="button"
						className="server-desktop__primary"
						disabled={busy}
						onClick={actions.onTurnOn}
						data-server-desktop-action="turn-on"
					>
						<Power size={13} aria-hidden="true" /> Turn on
					</button>
				) : null}
			</div>
		</div>
	);
}

export type ServerDesktopViewerState =
	| 'connecting'
	| 'open'
	| 'closed'
	| 'failed';

/**
 * The bar above a running desktop: who controls it, taking and giving up
 * control, the display number, reconnecting, and turning it off.
 */
export function ServerDesktopBar({
	mode,
	controller,
	display,
	state,
	busy,
	notice,
	confirmingTurnOff,
	onTakeControl,
	onReleaseControl,
	onReconnect,
	onTurnOff,
	onConfirmTurnOff,
	onCancelTurnOff,
}: Readonly<{
	/** The mode the server gave this window's stream; undefined until it has. */
	mode: ServerDesktopMode | undefined;
	controller: ServerDesktopController | null;
	display: number;
	state: ServerDesktopViewerState;
	busy: boolean;
	/** Said once, such as "Taken over by Laptop". */
	notice?: string;
	/** Set while the server has refused to turn off without confirmation. */
	confirmingTurnOff?: Readonly<{ windows?: number }>;
	onTakeControl: () => void;
	onReleaseControl: () => void;
	onReconnect: () => void;
	onTurnOff: () => void;
	onConfirmTurnOff: () => void;
	onCancelTurnOff: () => void;
}>) {
	return (
		<>
			<div className="server-desktop__bar" data-server-desktop-mode={mode ?? 'none'}>
				<span className="server-desktop__mode">
					{mode === 'control' ? (
						<MousePointer2 size={13} aria-hidden="true" />
					) : (
						<Eye size={13} aria-hidden="true" />
					)}{' '}
					{state === 'closed'
						? 'Disconnected.'
						: state === 'failed'
							? 'The desktop could not open.'
							: controlLine(mode, controller)}
				</span>
				{mode === 'control' ? (
					<button
						type="button"
						disabled={busy}
						onClick={onReleaseControl}
						data-server-desktop-action="release-control"
					>
						Give up control
					</button>
				) : (
					<button
						type="button"
						disabled={busy || mode === undefined}
						onClick={onTakeControl}
						data-server-desktop-action="take-control"
					>
						Take control
					</button>
				)}
				<span className="server-desktop__grow" />
				<span
					className="server-desktop__display"
					title="Programs started in a new terminal on this server open here"
					data-server-desktop-display={display}
				>
					DISPLAY=:{display}
				</span>
				<button
					type="button"
					onClick={onReconnect}
					data-server-desktop-action="reconnect"
				>
					<RefreshCw size={13} aria-hidden="true" /> Reconnect
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={onTurnOff}
					data-server-desktop-action="turn-off"
				>
					<Power size={13} aria-hidden="true" /> Turn off
				</button>
			</div>
			<div className="server-desktop__notes">
				<span data-server-desktop-shared-notice="true">
					One desktop for this whole server: every project and every paired
					device sees the same windows.
				</span>
				{notice === undefined ? null : (
					<span
						className="server-desktop__notice"
						role="status"
						data-server-desktop-notice="true"
					>
						{notice}
					</span>
				)}
			</div>
			{confirmingTurnOff === undefined ? null : (
				<div
					className="server-desktop__confirm"
					role="alertdialog"
					aria-label="Turn off the desktop"
					data-server-desktop-confirm="turn-off"
				>
					<span>{turnOffConfirmation(confirmingTurnOff.windows)}</span>
					<button type="button" onClick={onCancelTurnOff}>
						Cancel
					</button>
					<button
						type="button"
						className="server-desktop__danger"
						disabled={busy}
						onClick={onConfirmTurnOff}
						data-server-desktop-action="confirm-turn-off"
					>
						Turn off
					</button>
				</div>
			)}
		</>
	);
}
