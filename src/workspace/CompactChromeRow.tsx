/**
 * The compact workspace chrome: one row.
 *
 * At phone width the three bands a wide window can afford — the application
 * menu, the project strip, the panel tab strip — cost more than the terminal
 * they frame. This row keeps what a one-handed user actually reaches for and
 * sends the rest to the rail drawer, which the title block and the connection
 * glyph both open. Home is both a toggle on the row, one press from anywhere,
 * and the first item of the drawer's rail.
 *
 * While Pixel is on it takes the glyph's trailing slot: docked in the header it
 * covers nothing, where the corner dock sat on the terminal's last lines. The
 * glyph's two warnings then ride on the title block, which opens the same
 * drawer.
 *
 * The Command Bar control is the one door the collapse could not do without.
 * Every command the hidden bands used to carry — new terminal, split, clear,
 * save, dictation, tab and project editing, every macro — is reachable through
 * it and through nothing else at this width, because a phone has no key to
 * press. One control for all of them costs the row less than one control each.
 *
 * The title block says where you are rather than listing where you could go.
 * Its first line is the panel in front — the thing being typed into — and its
 * second the project and folder, which gives up the project first so the
 * worktree the keystrokes land in stays readable.
 */

import { Bell, House, Search, Server, TriangleAlert } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { LiveTerminalTitle } from '../shared/useWorkspaceProjection';
import { activityCountDigits, formatActivityCount } from './activityCountBadge';
import { displayFolderName } from './compactSwitcherModel.ts';
import { TerminalWorkflowBadge } from './workflows/WorkflowTabBadge';
import { upgradeAvailableSuffix } from './serverUpgradeModel.ts';
import { notificationsButtonLabel } from './TerminalActivityOverview';

export type CompactConnectionPresentation = Readonly<{
	/** Named for assistive technology even though the glyph carries no label. */
	serverLabel: string;
	isExposed: boolean;
	isReachable: boolean;
	/** The same tone class the wide bar's connection button carries. */
	tone: string;
	/** The version the active tab's server reports available; never Local's. */
	upgradeVersion?: string;
}>;

export type CompactChromeRowProps = Readonly<{
	/** Rendered only by hosts that draw their own application menu in-page. */
	applicationMenu?: ReactNode;
	connection: CompactConnectionPresentation;
	connectionButtonRef?: RefObject<HTMLButtonElement | null>;
	/** False on Home, where the command acts on no project. */
	isExplorerOpen: boolean;
	isNotificationsOpen: boolean;
	isSwitcherOpen: boolean;
	breadcrumbButtonRef?: RefObject<HTMLButtonElement | null>;
	/** How many notifications there are, across every project and server. */
	notificationCount: number;
	notificationsButtonRef?: RefObject<HTMLButtonElement | null>;
	onOpenCommandBar: () => void;
	onToggleNotifications: () => void;
	onOpenSwitcher: (source: 'breadcrumb' | 'connection') => void;
	onToggleExplorer: () => void;
	/** Selects Home, or goes back to the project in front before Home. */
	onToggleHome: () => void;
	isHomeSelected: boolean;
	/** True while Home is not selected and some terminal needs the user. */
	homeAttention: boolean;
	/** Present while Pixel is on: the element Pixel docks into replaces the
	 * connection glyph. */
	pixelSlotRef?: (element: HTMLSpanElement | null) => void;
	title: CompactTitle;
	/** A pending update stays visible here; it is never worth hiding. */
	updateAction?: ReactNode;
}>;

/** What the title block names: always the thing on screen. */
export type CompactTitle =
	| Readonly<{ kind: 'home'; tabTitle: string }>
	| Readonly<{ kind: 'none' }>
	| Readonly<{
			kind: 'project';
			color?: string;
			/** The selected folder, when this window knows the project's folders. */
			folderName?: string;
			projectTitle: string;
			/** The active panel; absent when the project has none in front. */
			panel?: Readonly<{
				title: string;
				panelId: string;
				isTerminal: boolean;
				serverId?: string;
				sessionId?: string;
			}>;
	  }>;

/** The title block's accessible name, before any server warning. */
export function compactTitleLabel(title: CompactTitle): string {
	if (title.kind === 'home') return `Switch terminal — ${title.tabTitle}, Home`;
	if (title.kind === 'none') return 'Switch terminal — No project';
	const where =
		title.folderName === undefined
			? title.projectTitle
			: `${title.folderName} in ${title.projectTitle}`;
	return title.panel === undefined
		? `Switch terminal — ${where}`
		: `Switch terminal — ${title.panel.title}, ${where}`;
}

export function CompactChromeRow({
	applicationMenu,
	breadcrumbButtonRef,
	connection,
	connectionButtonRef,
	isExplorerOpen,
	isNotificationsOpen,
	isSwitcherOpen,
	notificationCount,
	notificationsButtonRef,
	onOpenCommandBar,
	onOpenSwitcher,
	onToggleNotifications,
	onToggleExplorer,
	onToggleHome,
	isHomeSelected,
	homeAttention,
	pixelSlotRef,
	title,
	updateAction,
}: CompactChromeRowProps) {
	const countLabel = formatActivityCount(notificationCount);
	const breadcrumbAlert =
		pixelSlotRef === undefined
			? undefined
			: !connection.isReachable
				? `${connection.serverLabel} unreachable`
				: connection.upgradeVersion === undefined
					? undefined
					: `Server upgrade ${connection.upgradeVersion} available`;
	const breadcrumbLabel = compactTitleLabel(title);
	const projectColor = title.kind === 'project' ? title.color : undefined;
	let primary: ReactNode;
	let secondary: ReactNode;
	if (title.kind === 'home') {
		primary = title.tabTitle;
		secondary = <span className="compact-title__where">Home</span>;
	} else if (title.kind === 'none') {
		primary = 'No project';
		secondary = null;
	} else {
		primary =
			title.panel === undefined ? (
				title.projectTitle
			) : title.panel.isTerminal ? (
				<LiveTerminalTitle
					panelId={title.panel.panelId}
					fallback={title.panel.title}
				/>
			) : (
				title.panel.title
			);
		secondary = (
			<>
				<span className="compact-breadcrumb__swatch" aria-hidden="true" />
				<span
					className="compact-breadcrumb__project"
					data-compact-breadcrumb-segment="project"
				>
					{title.projectTitle}
				</span>
				{title.folderName === undefined ? null : (
					<>
						<span className="compact-breadcrumb__separator" aria-hidden="true">
							›
						</span>
						<span className="compact-title__folder">
							{displayFolderName(title.folderName)}
						</span>
					</>
				)}
				{title.panel?.isTerminal === true ? (
					<TerminalWorkflowBadge
						serverId={title.panel.serverId}
						sessionId={title.panel.sessionId}
					/>
				) : null}
			</>
		);
	}
	return (
		<div className="compact-chrome" data-compact-chrome="true">
			{applicationMenu}
			<button
				type="button"
				className={`compact-chrome__icon${isExplorerOpen ? ' compact-chrome__icon--active' : ''}`}
				onClick={onToggleExplorer}
				aria-label="Toggle file explorer"
				aria-pressed={isExplorerOpen}
				title="Toggle file explorer"
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 14 14"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M2.25 2.25H11.75V11.75H2.25V2.25Z"
						stroke="currentColor"
						strokeWidth="1.4"
					/>
					<path d="M5 2.25V11.75" stroke="currentColor" strokeWidth="1.4" />
				</svg>
			</button>
			<button
				type="button"
				className="compact-chrome__icon"
				onClick={onOpenCommandBar}
				aria-label="Open command bar"
				title="Open command bar"
				data-compact-command-bar="true"
			>
				<Search size={14} aria-hidden="true" />
			</button>
			<button
				ref={breadcrumbButtonRef}
				type="button"
				className="compact-breadcrumb"
				onClick={() => onOpenSwitcher('breadcrumb')}
				aria-haspopup="dialog"
				aria-expanded={isSwitcherOpen}
				aria-label={
					breadcrumbAlert === undefined
						? breadcrumbLabel
						: `${breadcrumbLabel} — ${breadcrumbAlert}`
				}
				data-compact-breadcrumb="true"
				style={
					projectColor === undefined
						? undefined
						: ({ '--project-color': projectColor } as React.CSSProperties)
				}
			>
				<span
					className="compact-title__primary"
					data-compact-breadcrumb-segment="terminal"
				>
					{primary}
				</span>
				<span className="compact-title__secondary">
					{secondary}
					{breadcrumbAlert === undefined ? null : (
						<TriangleAlert
							className="compact-breadcrumb__alert"
							size={11}
							aria-hidden="true"
							data-compact-breadcrumb-alert="true"
						/>
					)}
				</span>
			</button>
			{updateAction}
			<button
				type="button"
				className={`compact-chrome__icon compact-home-toggle${isHomeSelected ? ' compact-chrome__icon--active' : ''}`}
				onClick={onToggleHome}
				aria-label={
					isHomeSelected
						? 'Back to project'
						: homeAttention
							? 'Home, a terminal needs you'
							: 'Home'
				}
				aria-pressed={isHomeSelected}
				title="Home"
				data-compact-home-toggle="true"
			>
				<House size={15} aria-hidden="true" />
				{homeAttention && !isHomeSelected ? (
					<span className="compact-home-toggle__dot" aria-hidden="true" />
				) : null}
			</button>
			{/* The bell is the one place a phone lists what needs the user. A
			    notification a process sent has no terminal indicator to show it. */}
			<button
				ref={notificationsButtonRef}
				type="button"
				className="compact-chrome__icon compact-notifications-button"
				onClick={onToggleNotifications}
				aria-haspopup="dialog"
				aria-expanded={isNotificationsOpen}
				aria-label={notificationsButtonLabel(notificationCount)}
				title="Notifications"
				data-compact-notifications-button="true"
			>
				<Bell size={15} aria-hidden="true" />
				{notificationCount > 0 ? (
					<span
						className="notifications-count"
						data-digits={activityCountDigits(countLabel)}
						aria-hidden="true"
					>
						{countLabel}
					</span>
				) : null}
			</button>
			{pixelSlotRef !== undefined ? (
				<span
					ref={pixelSlotRef}
					className="compact-chrome__pixel-slot"
					data-compact-pixel-slot="true"
				/>
			) : (
				<button
					ref={connectionButtonRef}
					type="button"
					className={`compact-chrome__icon compact-connection ${connection.tone}`.trim()}
					onClick={() => onOpenSwitcher('connection')}
					aria-haspopup="dialog"
					aria-expanded={isSwitcherOpen}
					aria-label={`Connections — ${connection.serverLabel}, ${connection.isExposed ? 'Exposed' : 'Offline'}${upgradeAvailableSuffix(connection.upgradeVersion)}`}
					title={connection.serverLabel}
					data-compact-connection="true"
				>
					<Server size={15} aria-hidden="true" />
					{connection.upgradeVersion === undefined ? null : (
						<TriangleAlert
							className="compact-connection__upgrade"
							size={10}
							aria-hidden="true"
							data-server-upgrade-indicator={connection.upgradeVersion}
						/>
					)}
					<span
						className={`compact-connection__dot${connection.isReachable ? '' : ' compact-connection__dot--unreachable'}`}
						aria-hidden="true"
					/>
				</button>
			)}
		</div>
	);
}
