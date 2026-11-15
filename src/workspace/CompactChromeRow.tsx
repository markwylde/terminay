/**
 * The compact workspace chrome: one row.
 *
 * At phone width the three bands a wide window can afford — the application
 * menu, the project strip, the panel tab strip — cost more than the terminal
 * they frame. This row keeps one control per destination: the Command Bar,
 * the title block that opens the switcher, the bell, Pixel while it is on,
 * and the sidebar toggle. Home, the server menu, and the application menu
 * all live in the switcher, so none of them is drawn twice.
 *
 * The sidebar toggle opens the right-hand column, so it sits at the trailing
 * end and its glyph is a panel on the right, as on a wide window.
 *
 * The Command Bar control is the one door the collapse could not do without.
 * Every command the hidden bands used to carry — new terminal, split, clear,
 * save, dictation, tab and project editing, every macro — is reachable through
 * it, because a phone has no key to press. One control for all of them costs
 * the row less than one control each.
 *
 * The title block says where you are rather than listing where you could go.
 * Its first line is the panel in front — the thing being typed into — and its
 * second the project and folder, which gives up the project first so the
 * worktree the keystrokes land in stays readable. With no server glyph on the
 * row, the server's warnings ride on it.
 */

import { Bell, Search, TriangleAlert } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { LiveTerminalTitle } from '../shared/useWorkspaceProjection';
import { activityCountDigits, formatActivityCount } from './activityCountBadge';
import { displayFolderName } from './compactSwitcherModel.ts';
import { TerminalWorkflowBadge } from './workflows/WorkflowTabBadge';
import { notificationsButtonLabel } from './TerminalActivityOverview';

export type CompactConnectionPresentation = Readonly<{
	/** Named in the title block's warning when the server cannot be reached. */
	serverLabel: string;
	isReachable: boolean;
	/** The version the active tab's server reports available; never Local's. */
	upgradeVersion?: string;
}>;

export type CompactChromeRowProps = Readonly<{
	connection: CompactConnectionPresentation;
	/** Whether the sidebar the trailing toggle answers for is shown. */
	isExplorerOpen: boolean;
	isNotificationsOpen: boolean;
	isSwitcherOpen: boolean;
	breadcrumbButtonRef?: RefObject<HTMLButtonElement | null>;
	/** How many notifications there are, across every project and server. */
	notificationCount: number;
	notificationsButtonRef?: RefObject<HTMLButtonElement | null>;
	onOpenCommandBar: () => void;
	onToggleNotifications: () => void;
	onOpenSwitcher: () => void;
	onToggleExplorer: () => void;
	/**
	 * While Home is selected the trailing toggle opens the Home options panel
	 * instead of a sidebar. Absent with a project in front. `isOffered` is
	 * false while the Home tab in front has no options; `isFiltered` marks a
	 * filter that hides items.
	 */
	homeOptions?: Readonly<{ isOffered: boolean; isFiltered: boolean }>;
	sidebarToggleRef?: RefObject<HTMLButtonElement | null>;
	/** Present while Pixel is on: the element Pixel docks into, just before
	 * the sidebar toggle. */
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

function homeOptionsLabel(
	isOpen: boolean,
	options: Readonly<{ isFiltered: boolean }>,
): string {
	const action = isOpen ? 'Hide options' : 'Show options';
	return options.isFiltered ? `${action}, filters applied` : action;
}

export function CompactChromeRow({
	breadcrumbButtonRef,
	connection,
	isExplorerOpen,
	isNotificationsOpen,
	isSwitcherOpen,
	notificationCount,
	notificationsButtonRef,
	onOpenCommandBar,
	onOpenSwitcher,
	onToggleNotifications,
	onToggleExplorer,
	homeOptions,
	sidebarToggleRef,
	pixelSlotRef,
	title,
	updateAction,
}: CompactChromeRowProps) {
	const countLabel = formatActivityCount(notificationCount);
	const breadcrumbAlert = !connection.isReachable
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
	const toggleLabel =
		homeOptions === undefined
			? 'Toggle file explorer'
			: homeOptionsLabel(isExplorerOpen, homeOptions);
	return (
		<div className="compact-chrome" data-compact-chrome="true">
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
				onClick={onOpenSwitcher}
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
			{pixelSlotRef === undefined ? null : (
				<span
					ref={pixelSlotRef}
					className="compact-chrome__pixel-slot"
					data-compact-pixel-slot="true"
				/>
			)}
			{homeOptions !== undefined && !homeOptions.isOffered ? null : (
				<button
					type="button"
					className={`compact-chrome__icon${isExplorerOpen ? ' compact-chrome__icon--active' : ''}`}
					ref={sidebarToggleRef}
					onClick={onToggleExplorer}
					aria-label={toggleLabel}
					aria-pressed={isExplorerOpen}
					title={toggleLabel}
					data-compact-sidebar-toggle="true"
					{...(homeOptions === undefined
						? {}
						: {
								'data-compact-home-options-toggle': 'true',
								'data-filtered': homeOptions.isFiltered ? 'true' : 'false',
							})}
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
						<path d="M9 2.25V11.75" stroke="currentColor" strokeWidth="1.4" />
					</svg>
					{homeOptions?.isFiltered === true ? (
						<span className="compact-chrome__filtered-dot" aria-hidden="true" />
					) : null}
				</button>
			)}
		</div>
	);
}
