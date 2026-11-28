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
	ClipboardCheck,
	Clipboard as ClipboardIcon,
	Copy,
	Eye,
	House,
	Monitor,
	MonitorOff,
	MonitorX,
	MoreHorizontal,
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

/** The control beside the server menu, and the dropdown it opens. Rendered
 * only for a server that offers a desktop. */
export function ServerDesktopButton({
	serverLabel,
	isOpen,
	onActivate,
	children,
}: Readonly<{
	serverLabel: string;
	isOpen: boolean;
	onActivate: () => void;
	/** The dropdown, while it is open. */
	children?: ReactNode;
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
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				data-server-desktop-button="true"
			>
				<Monitor size={15} aria-hidden="true" />
			</button>
			{children}
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
					Run graphical programs from a terminal on this server and their
					windows appear here. Setup installs a display server and a small
					window environment from Debian. Nothing listens on the network: the
					desktop is reached only through Terminay.
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
	const icon =
		status.state === 'unsupported' ? (
			<MonitorX size={22} aria-hidden="true" />
		) : status.state === 'off' ? (
			<MonitorOff size={22} aria-hidden="true" />
		) : status.state === 'failed' ? (
			<TriangleAlert size={22} aria-hidden="true" />
		) : (
			<Monitor size={22} aria-hidden="true" />
		);
	return (
		<div
			className="server-desktop__state"
			data-server-desktop-state={status.state}
		>
			<div className="server-desktop__card">
				<span
					className={`server-desktop__badge server-desktop__badge--${status.state}`}
					aria-hidden="true"
				>
					{icon}
				</span>
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
		</div>
	);
}

export type ServerDesktopViewerState =
	| 'connecting'
	| 'open'
	| 'closed'
	| 'failed';

/** Somewhere a desktop tab can be moved to. */
export type ServerDesktopMoveTarget =
	| Readonly<{ kind: 'home' }>
	| Readonly<{
			kind: 'project';
			projectId: string;
			title: string;
			emoji?: string;
	  }>;

/** How the device clipboard reaches a controlling window, as the canvas says. */
export type ServerDesktopSharing =
	| 'syncing'
	| 'active'
	| 'inactive'
	| 'unavailable';

const SHARING_TEXT: Record<
	ServerDesktopSharing,
	Readonly<{ label: string; title: string }>
> = {
	active: {
		label: 'Clipboard synced',
		title: 'Clipboard text is shared both ways while you control this desktop.',
	},
	syncing: {
		label: 'Syncing clipboard…',
		title: 'Starting clipboard sharing…',
	},
	unavailable: {
		label: 'Paste with your shortcut',
		title: 'Use your device’s paste shortcut to send text to the desktop.',
	},
	inactive: {
		label: 'Clipboard paused',
		title: 'Click the desktop to share your clipboard with it.',
	},
};

/**
 * The one toolbar above a running desktop: who controls it and the control
 * button on the left, the clipboard state and a menu on the right. The menu
 * holds the display number, what the desktop is, reconnecting, and turning
 * it off. Hookless: the window owns whether the menu is open.
 */
export function ServerDesktopBar({
	mode,
	controller,
	display,
	state,
	busy,
	notice,
	sharing,
	menuOpen = false,
	compact = false,
	leading,
	moveTargets = [],
	onMove,
	confirmingTurnOff,
	onToggleMenu,
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
	/** Shown only while this window controls an open desktop. */
	sharing?: ServerDesktopSharing;
	menuOpen?: boolean;
	/** The dropdown's bar: no status text, which its heading shows. */
	compact?: boolean;
	/** Drawn first, such as the dropdown's Open in tab. */
	leading?: ReactNode;
	/** Where this tab could be moved; none outside a tab. */
	moveTargets?: readonly ServerDesktopMoveTarget[];
	onMove?: (target: ServerDesktopMoveTarget) => void;
	/** Set while the server has refused to turn off without confirmation. */
	confirmingTurnOff?: Readonly<{ windows?: number }>;
	onToggleMenu?: () => void;
	onTakeControl: () => void;
	onReleaseControl: () => void;
	onReconnect: () => void;
	onTurnOff: () => void;
	onConfirmTurnOff: () => void;
	onCancelTurnOff: () => void;
}>) {
	const controls = mode === 'control';
	const clipboard =
		controls && state === 'open' && sharing !== undefined
			? SHARING_TEXT[sharing]
			: undefined;
	return (
		<>
			<div
				className={`server-desktop__bar${compact ? ' server-desktop__bar--compact' : ''}`}
				data-server-desktop-mode={mode ?? 'none'}
			>
				{leading}
				{compact ? null : (
					<span
						className={`server-desktop__mode${controls ? ' server-desktop__mode--control' : ''}`}
					>
						{controls ? (
							<MousePointer2 size={13} aria-hidden="true" />
						) : (
							<Eye size={13} aria-hidden="true" />
						)}
						<span>
							{state === 'closed'
								? 'Disconnected.'
								: state === 'failed'
									? 'The desktop could not open.'
									: controlLine(mode, controller)}
						</span>
					</span>
				)}
				{controls ? (
					<button
						type="button"
						className="server-desktop__quiet"
						disabled={busy}
						onClick={onReleaseControl}
						data-server-desktop-action="release-control"
					>
						Give up control
					</button>
				) : (
					<button
						type="button"
						className="server-desktop__accent"
						disabled={busy || mode === undefined}
						onClick={onTakeControl}
						data-server-desktop-action="take-control"
					>
						Take control
					</button>
				)}
				{notice === undefined ? null : (
					<span
						className="server-desktop__notice"
						role="status"
						data-server-desktop-notice="true"
					>
						{notice}
					</span>
				)}
				<span className="server-desktop__grow" />
				{clipboard === undefined || compact ? null : (
					<span
						className="server-desktop__clipboard"
						title={clipboard.title}
						data-server-desktop-sharing={sharing}
					>
						{sharing === 'active' ? (
							<ClipboardCheck size={13} aria-hidden="true" />
						) : (
							<ClipboardIcon size={13} aria-hidden="true" />
						)}
						<span className="server-desktop__clipboard-label">
							{clipboard.label}
						</span>
					</span>
				)}
				<div className="server-desktop__menu-anchor">
					<button
						type="button"
						className="server-desktop__icon-button"
						aria-label="Desktop options"
						title="Desktop options"
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onClick={onToggleMenu}
						data-server-desktop-menu-button="true"
					>
						<MoreHorizontal size={15} aria-hidden="true" />
					</button>
					<div
						className="server-desktop__menu"
						role="menu"
						aria-label="Desktop options"
						tabIndex={-1}
						hidden={!menuOpen}
						data-server-desktop-menu="true"
					>
						<div className="server-desktop__menu-info">
							<span
								className="server-desktop__display"
								data-server-desktop-display={display}
							>
								DISPLAY=:{display}
							</span>
							<span>Programs started in a new terminal open here.</span>
							<span data-server-desktop-shared-notice="true">
								One desktop for this whole server: every project and every
								paired device sees the same windows.
							</span>
						</div>
						<hr />
						{moveTargets.length === 0 || onMove === undefined ? null : (
							<>
								<span className="server-desktop__menu-heading">
									Move tab to
								</span>
								{moveTargets.map((target) => (
									<button
										key={target.kind === 'home' ? 'home' : target.projectId}
										type="button"
										role="menuitem"
										tabIndex={-1}
										onClick={() => onMove(target)}
										aria-label={`Move tab to ${target.kind === 'home' ? 'Home' : target.title}`}
										data-server-desktop-move={
											target.kind === 'home' ? 'home' : target.projectId
										}
									>
										{target.kind === 'home' ? (
											<>
												<House size={13} aria-hidden="true" /> Home
											</>
										) : (
											<>
												<span
													className="server-desktop__menu-emoji"
													aria-hidden="true"
												>
													{target.emoji ?? '📁'}
												</span>
												{target.title}
											</>
										)}
									</button>
								))}
								<hr />
							</>
						)}
						<button
							type="button"
							role="menuitem"
							tabIndex={-1}
							onClick={onReconnect}
							data-server-desktop-action="reconnect"
						>
							<RefreshCw size={13} aria-hidden="true" /> Reconnect
						</button>
						<button
							type="button"
							role="menuitem"
							tabIndex={-1}
							className="server-desktop__danger"
							disabled={busy}
							onClick={onTurnOff}
							data-server-desktop-action="turn-off"
						>
							<Power size={13} aria-hidden="true" /> Turn off desktop…
						</button>
					</div>
				</div>
			</div>
			{confirmingTurnOff === undefined ? null : (
				<div
					className="server-desktop__confirm"
					role="alertdialog"
					aria-label="Turn off the desktop"
					data-server-desktop-confirm="turn-off"
				>
					<TriangleAlert size={14} aria-hidden="true" />
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

/** Over the desktop frame while there is no picture to show. */
export function ServerDesktopOverlay({
	state,
	failure,
	onReconnect,
}: Readonly<{
	state: ServerDesktopViewerState;
	failure?: string;
	onReconnect: () => void;
}>) {
	if (state === 'open') return null;
	return (
		<div
			className="server-desktop__overlay"
			data-server-desktop-overlay={state}
		>
			{state === 'connecting' ? (
				<p className="server-desktop__faint">Connecting to the desktop…</p>
			) : (
				<>
					<p>
						{state === 'closed'
							? 'The desktop disconnected.'
							: 'The desktop could not open.'}
					</p>
					{failure === undefined ? null : (
						<p className="server-desktop__reason" role="alert">
							{failure}
						</p>
					)}
					<button
						type="button"
						className="server-desktop__accent"
						onClick={onReconnect}
						data-server-desktop-action="overlay-reconnect"
					>
						<RefreshCw size={13} aria-hidden="true" /> Reconnect
					</button>
				</>
			)}
		</div>
	);
}
