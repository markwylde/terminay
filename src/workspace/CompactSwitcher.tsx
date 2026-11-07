/**
 * The one surface that answers "which panel", at phone width.
 *
 * A drawer from the leading edge: a rail of places (Home, then every project
 * of every attached connection) and a panel presenting the one selected. A
 * project is a tree of its folders and the panels each holds; Home is its
 * sections and the terminals waiting on the user. Choosing a rail item only
 * changes what the panel presents; choosing a panel, a folder, or a create
 * action changes what is on screen.
 *
 * The drawer is mounted once per open and its entrance is a CSS animation on
 * this shell alone. Rail selection, edit mode, the filter, menus, and the
 * launcher dropup are state inside it, so none of them replays the entrance.
 *
 * It overlays the workspace instead of taking width from it, so opening it
 * never resizes a terminal and dismissing it never costs a relayout.
 */

import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Ellipsis,
	Folder,
	FolderPlus,
	GitBranch,
	GripVertical,
	House,
	Pencil,
	Plus,
	Search,
	Server,
	X,
} from 'lucide-react';
import type {
	CSSProperties,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
	ReactNode,
} from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import './CompactSwitcher.css';
import { AgentStatusIndicator } from '../components/AgentStatusIndicator';
import { FOLDERS_COLUMN_TABS } from '../components/folders/foldersColumnTabs';
import { LauncherIcon } from '../components/folders/launcherIcons';
import { SidebarGroupTabs } from '../components/sidebar/SidebarGroupTabs';
import { useLongPress } from '../hooks/useLongPress';
import { LiveTerminalTitle } from '../shared/useWorkspaceProjection';
import type { FoldersColumnTabId } from '../types/settings';
import type { TerminalLauncherView } from '../types/terminalLaunchers';
import { type CompactSheetItem, CompactSheetMenu } from './CompactSheetMenu';
import type {
	CompactSwitcherConnectionGroup,
	CompactSwitcherFolderGroup,
	CompactSwitcherPanelRow,
	CompactSwitcherProjectGroup,
} from './compactSwitcherModel.ts';
import {
	compactNeedsYou,
	compactProjectInitials,
	compactRailBadge,
	compactSwitcherIsEmpty,
	displayFolderName,
	filterCompactSwitcherGroups,
	formatCompactSwitcherSummary,
	orderCompactRailConnections,
} from './compactSwitcherModel.ts';
import type { FolderMenuActionId, FolderMenuEntry } from './folderMenuModel';
import { moveItem } from './gripReorderModel.ts';
import { HOME_SECTION_LABELS, type HomeSection } from './homeSection';
import { COMPACT_SHELL_LAUNCHER } from './localViewState';
import { gripDragState, useGripReorder } from './useGripReorder';
import {
	TerminalWorkflowBadge,
	TerminalWorkflowStep,
} from './workflows/WorkflowTabBadge';

export type CompactSwitcherServer = Readonly<{
	profileId: string;
	label: string;
	isCurrent: boolean;
	isSwitching: boolean;
}>;

export type CompactHomeSectionItem = Readonly<{
	section: HomeSection;
	/** One line of what the window already knows about the section. */
	summary: string;
}>;

export type CompactSwitcherProps = Readonly<{
	/** The row for the panel on screen, so the tree says where you are. */
	activePanelKey?: string;
	/** The agents of the project in front, shown under its Agents tab. */
	agents?: ReactNode;
	/** The folders of a project this device draws collapsed. */
	collapsedFolderIdsFor: (
		project: CompactSwitcherProjectGroup,
	) => ReadonlySet<string>;
	currentServer: Readonly<{ id: string; label: string; isReachable: boolean }>;
	/** A folder's context-menu entries, for a project on the current server. */
	folderMenuFor?: (
		project: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup,
	) => readonly FolderMenuEntry[] | undefined;
	/** The project in front, absent while Home is selected. */
	frontProjectKey?: string;
	groups: readonly CompactSwitcherConnectionGroup[];
	/** The section of the Home tab in front, while Home is the view. */
	homeFrontSection?: HomeSection;
	homeSections: readonly CompactHomeSectionItem[];
	isHomeSelected: boolean;
	/** The launchers the current server lists, in its order. */
	launchers: readonly TerminalLauncherView[];
	/** `shell` or a launcher id: what the split control repeats. */
	rememberedLauncherId: string;
	/** The folder this device has selected in a project, when it knows. */
	selectedFolderIdFor: (
		project: CompactSwitcherProjectGroup,
	) => string | undefined;
	/** The servers this window could show, where the host can switch. */
	servers?: readonly CompactSwitcherServer[];
	/** A row for each attached server that has an upgrade to show. */
	serverUpgrades?: ReactNode;
	onActivateFolder: (
		project: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup,
	) => void;
	onActivatePanel: (row: CompactSwitcherPanelRow) => void;
	onAddConnection: () => void;
	onClosePanel: (row: CompactSwitcherPanelRow) => void;
	onCloseProject: (project: CompactSwitcherProjectGroup) => void;
	/** Create a terminal; `launcherId` is `shell` or a launcher's id. */
	onCreateTerminal: (
		project: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup | undefined,
		launcherId: string,
	) => void;
	onDismiss: () => void;
	onEditProject: (project: CompactSwitcherProjectGroup) => void;
	onFolderMenuAction: (
		project: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup,
		action: FolderMenuActionId,
	) => void;
	onMovePanelToFolder: (row: CompactSwitcherPanelRow, folderId: string) => void;
	onNewProject: () => void;
	onOpenHomeSection: (section: HomeSection) => void;
	onRenamePanel: (row: CompactSwitcherPanelRow) => void;
	onReorderFolders: (
		project: CompactSwitcherProjectGroup,
		folderIds: readonly string[],
	) => void;
	onReorderPanels: (
		project: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup,
		panelIds: readonly string[],
	) => void;
	/** The current server's projects, by project id, in their new order. */
	onReorderProjects: (projectIds: readonly string[]) => void;
	onSwitchServer?: (profileId: string) => void;
	onToggleFolderCollapsed: (
		project: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup,
	) => void;
}>;

const HOME = 'home';

type Layer =
	| Readonly<{ kind: 'row'; row: CompactSwitcherPanelRow }>
	| Readonly<{ kind: 'folder'; folder: CompactSwitcherFolderGroup }>
	| Readonly<{ kind: 'server' }>
	| Readonly<{ kind: 'dropup'; folderId?: string }>;

const isContextMenuKey = (event: ReactKeyboardEvent) =>
	event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);

/** Opens a row's menu by a long press, a secondary click, or the keyboard. */
function useMenuGesture(open: () => void, disabled: boolean) {
	const longPress = useLongPress(open, { disabled });
	return {
		longPress,
		onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
			longPress.onContextMenu(event);
			if (event.defaultPrevented || disabled) return;
			// A secondary click opens the same menu a long press does.
			event.preventDefault();
			open();
		},
		onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
			if (disabled || !isContextMenuKey(event)) return;
			event.preventDefault();
			open();
		},
	};
}

function Badge({
	count,
	tone,
}: Readonly<{ count: number; tone: 'attention' | 'working' }>) {
	return (
		<span
			className={`compact-drawer__badge compact-drawer__badge--${tone}`}
			aria-hidden="true"
		>
			{count > 99 ? '99+' : count}
		</span>
	);
}

function ProjectSummary({
	project,
}: Readonly<{ project: CompactSwitcherProjectGroup }>) {
	const summary = formatCompactSwitcherSummary(project.summary);
	if (summary.groups.length === 0) return null;
	return (
		<span
			className="compact-drawer__summary"
			role="img"
			aria-label={summary.accessible}
			data-compact-switcher-summary={project.key}
		>
			{summary.groups.map((entry, index) => (
				<span
					key={entry.group}
					className={`compact-drawer__summary-group${
						index === 0 ? ` compact-drawer__summary-group--${entry.group}` : ''
					}`}
				>
					{index === 0 ? '' : ' · '}
					{entry.text}
				</span>
			))}
		</span>
	);
}

/* ---------------------------------------------------------------- rail */

function RailProject({
	gripProps,
	isEditing,
	isMovable,
	isSelected,
	onClose,
	onEdit,
	onSelect,
	project,
	style,
}: Readonly<{
	gripProps?: ReturnType<ReturnType<typeof useGripReorder>['gripProps']>;
	isEditing: boolean;
	isMovable: boolean;
	isSelected: boolean;
	onClose: () => void;
	onEdit: () => void;
	onSelect: () => void;
	project: CompactSwitcherProjectGroup;
	style?: CSSProperties;
}>) {
	const longPress = useLongPress(onEdit, { disabled: isEditing });
	const badge = compactRailBadge(project.summary);
	const editable = isEditing && isMovable;
	const status = formatCompactSwitcherSummary(project.summary).accessible;
	return (
		<div
			className="compact-drawer__rail-slot"
			data-grip-item="true"
			style={style}
		>
			<button
				type="button"
				className={`compact-drawer__rail-item${isSelected ? ' compact-drawer__rail-item--selected' : ''}${editable ? ' compact-drawer__rail-item--editable' : ''}`}
				style={{ '--compact-project': project.color } as CSSProperties}
				aria-label={
					status.length === 0 ? project.title : `${project.title}, ${status}`
				}
				aria-pressed={isSelected}
				title={editable ? undefined : 'Long-press to edit project'}
				data-compact-switcher-project={project.key}
				data-project-id={project.projectId}
				onPointerDown={
					editable ? gripProps?.onPointerDown : longPress.onPointerDown
				}
				onPointerMove={editable ? undefined : longPress.onPointerMove}
				onPointerUp={editable ? undefined : longPress.onPointerUp}
				onPointerCancel={editable ? undefined : longPress.onPointerCancel}
				onContextMenu={editable ? undefined : longPress.onContextMenu}
				onKeyDown={editable ? gripProps?.onKeyDown : undefined}
				onClick={longPress.bindClick(onSelect)}
			>
				<span className="compact-drawer__rail-tile" aria-hidden="true">
					<span className="compact-drawer__rail-glyph" aria-hidden="true">
						{project.emoji.length > 0
							? project.emoji
							: compactProjectInitials(project.title)}
					</span>
					{badge === undefined ? null : <Badge {...badge} />}
					{editable ? (
						<GripVertical
							className="compact-drawer__rail-grip"
							size={10}
							aria-hidden="true"
						/>
					) : null}
				</span>
				<span className="compact-drawer__rail-label" aria-hidden="true">
					{project.title}
				</span>
			</button>
			{editable ? (
				<button
					type="button"
					className="compact-drawer__rail-close"
					onClick={onClose}
					aria-label={`Close ${project.title}`}
					data-compact-switcher-close-project={project.key}
				>
					<X size={12} aria-hidden="true" />
				</button>
			) : null}
		</div>
	);
}

function RailGroup({
	connection,
	isEditing,
	isMovable,
	onAnnounce,
	onCloseProject,
	onEditProject,
	onReorder,
	onSelect,
	selected,
	showHeading,
}: Readonly<{
	connection: CompactSwitcherConnectionGroup;
	isEditing: boolean;
	isMovable: boolean;
	onAnnounce: (message: string) => void;
	onCloseProject: (project: CompactSwitcherProjectGroup) => void;
	onEditProject: (project: CompactSwitcherProjectGroup) => void;
	onReorder: (projectIds: readonly string[]) => void;
	onSelect: (key: string) => void;
	selected: string;
	showHeading: boolean;
}>) {
	const listRef = useRef<HTMLDivElement>(null);
	const projects = connection.projects;
	const reorder = useGripReorder({
		listRef,
		onCommit: (from, to) =>
			onReorder(
				moveItem(
					projects.map((project) => project.projectId),
					from,
					to,
				),
			),
		onAnnounce,
		describe: (index) => projects[index]?.title ?? 'Project',
	});
	return (
		<div className="compact-drawer__rail-group">
			{showHeading ? (
				<span
					className="compact-drawer__rail-heading"
					title={connection.serverLabel}
				>
					{connection.serverLabel}
				</span>
			) : null}
			<div ref={listRef} className="compact-drawer__rail-list">
				{projects.map((project, index) => (
					<RailProject
						key={project.key}
						gripProps={reorder.gripProps(index, projects.length)}
						isEditing={isEditing}
						isMovable={isMovable}
						isSelected={selected === project.key}
						onClose={() => onCloseProject(project)}
						onEdit={() => onEditProject(project)}
						onSelect={() => {
							if (reorder.consumeDragClick()) return;
							onSelect(project.key);
						}}
						project={project}
						{...(reorder.itemStyle(index) === undefined
							? {}
							: { style: reorder.itemStyle(index) })}
					/>
				))}
			</div>
		</div>
	);
}

/* ---------------------------------------------------------------- tree */

function PanelRow({
	gripProps,
	isActive,
	isEditing,
	onActivate,
	onClose,
	onMenu,
	panel,
	style,
}: Readonly<{
	gripProps?: ReturnType<ReturnType<typeof useGripReorder>['gripProps']>;
	isActive: boolean;
	isEditing: boolean;
	onActivate: () => void;
	onClose: () => void;
	onMenu: () => void;
	panel: CompactSwitcherPanelRow;
	style?: CSSProperties;
}>) {
	const gesture = useMenuGesture(onMenu, isEditing);
	const { longPress } = gesture;
	return (
		<div
			className={`compact-drawer__row${isActive ? ' compact-drawer__row--current' : ''}`}
			data-grip-item="true"
			style={style}
		>
			{/* The lead column sits under the folder's chevron, so status and
			    title line up under the folder's glyph and name. */}
			{isEditing && gripProps !== undefined ? (
				<button
					type="button"
					className="compact-drawer__grip"
					aria-label={`Reorder ${panel.title}`}
					data-compact-switcher-grip={panel.key}
					{...gripProps}
				>
					<GripVertical size={14} aria-hidden="true" />
				</button>
			) : (
				<span className="compact-drawer__lead" aria-hidden="true" />
			)}
			<button
				type="button"
				className="compact-drawer__row-main"
				onPointerDown={longPress.onPointerDown}
				onPointerMove={longPress.onPointerMove}
				onPointerUp={longPress.onPointerUp}
				onPointerCancel={longPress.onPointerCancel}
				onContextMenu={gesture.onContextMenu}
				onKeyDown={gesture.onKeyDown}
				onClick={longPress.bindClick(() => {
					if (!isEditing) onActivate();
				})}
				aria-current={isActive ? 'true' : undefined}
				aria-haspopup="menu"
				data-compact-switcher-panel={panel.key}
				data-compact-switcher-terminal={
					panel.panelKind === 'terminal' ? panel.key : undefined
				}
				data-project-id={panel.projectId}
			>
				<span
					className="compact-drawer__row-state"
					aria-hidden={panel.state === 'idle'}
				>
					<AgentStatusIndicator state={panel.state} size="small" showIdle />
				</span>
				<span className="compact-drawer__row-text">
					<span className="compact-drawer__row-title">
						<LiveTerminalTitle panelId={panel.panelId} fallback={panel.title} />
					</span>
					{panel.panelKind === 'terminal' ? (
						<TerminalWorkflowStep
							className="compact-drawer__row-sub"
							serverId={panel.serverId}
							sessionId={panel.sessionId}
							{...(panel.preview === undefined
								? {}
								: { fallback: panel.preview })}
						/>
					) : null}
				</span>
			</button>
			{/* The dial has its own column just before ⋯, so every dial in the
			    tree lines up; it collapses when the terminal has no workflow and
			    the title takes the room. */}
			{!isEditing && panel.panelKind === 'terminal' ? (
				<span
					className="compact-drawer__dial"
					data-compact-workflow-slot="true"
				>
					<TerminalWorkflowBadge
						serverId={panel.serverId}
						sessionId={panel.sessionId}
					/>
				</span>
			) : null}
			{/* The trailing column, shared with each folder header's ⋯. */}
			<span className="compact-drawer__wslot">
				{isEditing ? (
					<button
						type="button"
						className="compact-drawer__row-close"
						onClick={onClose}
						aria-label={`Close ${panel.title}`}
					>
						<X size={15} aria-hidden="true" />
					</button>
				) : (
					<button
						type="button"
						className="compact-drawer__row-more"
						onClick={onMenu}
						aria-label={`More for ${panel.title}`}
						aria-haspopup="menu"
						data-compact-switcher-row-menu={panel.key}
					>
						<Ellipsis size={16} aria-hidden="true" />
					</button>
				)}
			</span>
		</div>
	);
}

function FolderSection({
	activePanelKey,
	collapsed,
	folder,
	gripProps,
	isEditing,
	isOwnServer,
	onActivatePanel,
	onAnnounce,
	onClosePanel,
	onFolderMenu,
	onNewTerminal,
	onPanelMenu,
	onRemove,
	onReorderPanels,
	onToggleCollapsed,
	projectTitle,
	style,
}: Readonly<{
	activePanelKey?: string;
	collapsed: boolean;
	folder: CompactSwitcherFolderGroup;
	gripProps?: ReturnType<ReturnType<typeof useGripReorder>['gripProps']>;
	isEditing: boolean;
	isOwnServer: boolean;
	onActivatePanel: (row: CompactSwitcherPanelRow) => void;
	onAnnounce: (message: string) => void;
	onClosePanel: (row: CompactSwitcherPanelRow) => void;
	onFolderMenu: () => void;
	onNewTerminal: () => void;
	onPanelMenu: (row: CompactSwitcherPanelRow) => void;
	onRemove: () => void;
	onReorderPanels: (panelIds: readonly string[]) => void;
	onToggleCollapsed: () => void;
	projectTitle: string;
	style?: CSSProperties;
}>) {
	const listRef = useRef<HTMLDivElement>(null);
	const panels = folder.panels;
	const reorder = useGripReorder({
		listRef,
		onCommit: (from, to) =>
			onReorderPanels(
				moveItem(
					panels.map((panel) => panel.panelId),
					from,
					to,
				),
			),
		onAnnounce,
		describe: (index) => panels[index]?.title ?? 'Tab',
	});
	const shownName = displayFolderName(folder.name);
	const menuGesture = useMenuGesture(onFolderMenu, isEditing || !isOwnServer);
	return (
		<section
			className="compact-drawer__folder"
			data-grip-item="true"
			style={style}
			data-compact-switcher-folder-group={folder.key}
		>
			<div
				className={`compact-drawer__folder-head${isEditing ? ' compact-drawer__folder-head--editing' : ''}`}
			>
				{isEditing && gripProps !== undefined ? (
					<button
						type="button"
						className="compact-drawer__grip"
						aria-label={`Reorder ${folder.name}`}
						data-compact-switcher-grip={folder.key}
						{...gripProps}
					>
						<GripVertical size={14} aria-hidden="true" />
					</button>
				) : null}
				{/* The whole line is the disclosure: on a phone a tree header is
				    pressed to open or close, and the line is a far larger target
				    than a chevron. Showing the folder is in its ⋯ menu. */}
				<button
					type="button"
					className="compact-drawer__folder-name"
					data-compact-switcher-folder-toggle={folder.key}
					onClick={() => {
						if (!isEditing) onToggleCollapsed();
					}}
					onContextMenu={menuGesture.onContextMenu}
					onKeyDown={menuGesture.onKeyDown}
					aria-label={folder.name}
					{...(isEditing ? {} : { 'aria-expanded': !collapsed })}
				>
					{isEditing ? null : (
						<span className="compact-drawer__chevron" aria-hidden="true">
							{collapsed ? (
								<ChevronRight size={15} />
							) : (
								<ChevronDown size={15} />
							)}
						</span>
					)}
					<span className="compact-drawer__folder-icon" aria-hidden="true">
						{folder.isLinked ? (
							<GitBranch className="compact-drawer__folder-glyph" size={14} />
						) : (
							<Folder size={14} />
						)}
					</span>
					<span className="compact-drawer__folder-label">{shownName}</span>
					{panels.length === 0 ? null : (
						<span className="compact-drawer__folder-count" aria-hidden="true">
							{panels.length}
						</span>
					)}
				</button>
				{/* An empty folder's own entry below is its new-terminal control. */}
				{isEditing || panels.length === 0 ? null : (
					<button
						type="button"
						className="compact-drawer__folder-add"
						data-compact-switcher-folder-add={folder.key}
						onClick={onNewTerminal}
						aria-label={`New terminal in ${folder.name} of ${projectTitle}`}
						aria-haspopup="menu"
					>
						<Plus size={16} aria-hidden="true" />
					</button>
				)}
				<span className="compact-drawer__wslot">
					{isEditing ? (
						folder.isGeneral ? null : (
							<button
								type="button"
								className="compact-drawer__row-close"
								onClick={onRemove}
								aria-label={`${folder.isLinked ? 'Delete worktree' : 'Delete folder'} ${folder.name}`}
								data-compact-switcher-remove-folder={folder.key}
							>
								<X size={15} aria-hidden="true" />
							</button>
						)
					) : (
						<button
							type="button"
							className="compact-drawer__folder-more"
							onClick={onFolderMenu}
							aria-label={`More for ${folder.name}`}
							aria-haspopup="menu"
							data-compact-switcher-folder-menu={folder.key}
						>
							<Ellipsis size={16} aria-hidden="true" />
						</button>
					)}
				</span>
			</div>
			{collapsed ? null : panels.length === 0 ? (
				isEditing ? null : (
					<button
						type="button"
						className="compact-drawer__empty-folder"
						onClick={onNewTerminal}
						aria-label={`New terminal in ${folder.name} of ${projectTitle}`}
						aria-haspopup="menu"
						data-compact-switcher-empty-folder={folder.key}
					>
						<span className="compact-drawer__lead" aria-hidden="true" />
						<span className="compact-drawer__empty-icon" aria-hidden="true">
							<Plus size={14} />
						</span>
						New terminal
					</button>
				)
			) : (
				<div ref={listRef} className="compact-drawer__rows">
					{panels.map((panel, index) => (
						<PanelRow
							key={panel.key}
							{...(isOwnServer
								? { gripProps: reorder.gripProps(index, panels.length) }
								: {})}
							isActive={panel.key === activePanelKey}
							isEditing={isEditing}
							onActivate={() => {
								if (reorder.consumeDragClick()) return;
								onActivatePanel(panel);
							}}
							onClose={() => onClosePanel(panel)}
							onMenu={() => onPanelMenu(panel)}
							panel={panel}
							{...(reorder.itemStyle(index) === undefined
								? {}
								: { style: reorder.itemStyle(index) })}
						/>
					))}
				</div>
			)}
		</section>
	);
}

function FolderTree({
	activePanelKey,
	collapsedFolderIds,
	isEditing,
	isOwnServer,
	onActivatePanel,
	onAnnounce,
	onClosePanel,
	onFolderMenu,
	onNewTerminal,
	onPanelMenu,
	onRemoveFolder,
	onReorderFolders,
	onReorderPanels,
	onToggleCollapsed,
	project,
}: Readonly<{
	activePanelKey?: string;
	collapsedFolderIds: ReadonlySet<string>;
	isEditing: boolean;
	isOwnServer: boolean;
	onActivatePanel: (row: CompactSwitcherPanelRow) => void;
	onAnnounce: (message: string) => void;
	onClosePanel: (row: CompactSwitcherPanelRow) => void;
	onFolderMenu: (folder: CompactSwitcherFolderGroup) => void;
	onNewTerminal: (folder: CompactSwitcherFolderGroup) => void;
	onPanelMenu: (row: CompactSwitcherPanelRow) => void;
	onRemoveFolder: (folder: CompactSwitcherFolderGroup) => void;
	onReorderFolders: (folderIds: readonly string[]) => void;
	onReorderPanels: (
		folder: CompactSwitcherFolderGroup,
		panelIds: readonly string[],
	) => void;
	onToggleCollapsed: (folder: CompactSwitcherFolderGroup) => void;
	project: CompactSwitcherProjectGroup;
}>) {
	const listRef = useRef<HTMLDivElement>(null);
	const folders = project.folders;
	const reorder = useGripReorder({
		listRef,
		onCommit: (from, to) =>
			onReorderFolders(
				moveItem(
					folders.map((folder) => folder.folderId),
					from,
					to,
				),
			),
		onAnnounce,
		describe: (index) => folders[index]?.name ?? 'Folder',
	});
	if (folders.length === 0)
		return (
			<div className="compact-drawer__rows">
				{project.panels.map((panel) => (
					<PanelRow
						key={panel.key}
						isActive={panel.key === activePanelKey}
						isEditing={false}
						onActivate={() => onActivatePanel(panel)}
						onClose={() => onClosePanel(panel)}
						onMenu={() => onPanelMenu(panel)}
						panel={panel}
					/>
				))}
			</div>
		);
	return (
		<div ref={listRef} className="compact-drawer__folders">
			{folders.map((folder, index) => (
				<FolderSection
					key={folder.key}
					{...(activePanelKey === undefined ? {} : { activePanelKey })}
					collapsed={!isEditing && collapsedFolderIds.has(folder.folderId)}
					folder={folder}
					{...(isOwnServer
						? { gripProps: reorder.gripProps(index, folders.length) }
						: {})}
					isEditing={isEditing}
					isOwnServer={isOwnServer}
					onActivatePanel={onActivatePanel}
					onAnnounce={onAnnounce}
					onClosePanel={onClosePanel}
					onFolderMenu={() => onFolderMenu(folder)}
					onNewTerminal={() => onNewTerminal(folder)}
					onPanelMenu={onPanelMenu}
					onRemove={() => onRemoveFolder(folder)}
					onReorderPanels={(panelIds) => onReorderPanels(folder, panelIds)}
					onToggleCollapsed={() => onToggleCollapsed(folder)}
					projectTitle={project.title}
					{...(reorder.itemStyle(index) === undefined
						? {}
						: { style: reorder.itemStyle(index) })}
				/>
			))}
		</div>
	);
}

/** A filter's results: matching folders and panels, each naming its project. */
function FilterResults({
	activePanelKey,
	groups,
	namesConnections,
	onActivateFolder,
	onActivatePanel,
	onPanelMenu,
	query,
}: Readonly<{
	activePanelKey?: string;
	groups: readonly CompactSwitcherConnectionGroup[];
	namesConnections: boolean;
	onActivateFolder: (
		project: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup,
	) => void;
	onActivatePanel: (row: CompactSwitcherPanelRow) => void;
	onPanelMenu: (row: CompactSwitcherPanelRow) => void;
	query: string;
}>) {
	if (compactSwitcherIsEmpty(groups))
		return (
			<p className="compact-drawer__empty" role="status">
				Nothing matches “{query.trim()}”.
			</p>
		);
	const row = (panel: CompactSwitcherPanelRow) => (
		<PanelRow
			key={panel.key}
			isActive={panel.key === activePanelKey}
			isEditing={false}
			onActivate={() => onActivatePanel(panel)}
			onClose={() => {}}
			onMenu={() => onPanelMenu(panel)}
			panel={panel}
		/>
	);
	return (
		<div className="compact-drawer__results">
			{groups.flatMap((connection) =>
				connection.projects.map((project) => (
					<section
						key={project.key}
						className="compact-drawer__result-project"
						style={{ '--compact-project': project.color } as CSSProperties}
					>
						<h3 className="compact-drawer__result-heading">
							<span className="compact-drawer__swatch" aria-hidden="true" />
							{project.title}
							{namesConnections ? (
								<span className="compact-drawer__result-connection">
									{connection.serverLabel}
								</span>
							) : null}
						</h3>
						{project.folders.length === 0
							? project.panels.map(row)
							: project.folders.map((folder) => (
									<div key={folder.key}>
										<button
											type="button"
											className="compact-drawer__result-folder"
											data-compact-switcher-folder={folder.key}
											onClick={() => onActivateFolder(project, folder)}
											aria-label={`Folder ${folder.name} in ${project.title}`}
										>
											{folder.isLinked ? (
												<GitBranch size={13} aria-hidden="true" />
											) : null}
											{displayFolderName(folder.name)}
										</button>
										{folder.panels.map(row)}
									</div>
								))}
					</section>
				)),
			)}
		</div>
	);
}

/* ---------------------------------------------------------------- shell */

export function CompactSwitcher(props: CompactSwitcherProps) {
	const {
		activePanelKey,
		agents,
		currentServer,
		frontProjectKey,
		groups,
		isHomeSelected,
		launchers,
		onDismiss,
	} = props;
	const railGroups = useMemo(
		() => orderCompactRailConnections(groups, currentServer.id),
		[currentServer.id, groups],
	);
	const projectsByKey = useMemo(() => {
		const map = new Map<string, CompactSwitcherProjectGroup>();
		for (const connection of groups)
			for (const project of connection.projects) map.set(project.key, project);
		return map;
	}, [groups]);
	const needsYou = useMemo(() => compactNeedsYou(groups), [groups]);
	const serverLabelOf = useMemo(() => {
		const map = new Map(
			groups.map((group) => [group.serverId, group.serverLabel]),
		);
		return (serverId: string) => map.get(serverId) ?? serverId;
	}, [groups]);

	// Opening presents where the user is: Home while Home is the view, the
	// project in front otherwise. Nothing is remembered across opens.
	const [selected, setSelected] = useState<string>(() =>
		isHomeSelected || frontProjectKey === undefined ? HOME : frontProjectKey,
	);
	const [isEditing, setIsEditing] = useState(false);
	const [tab, setTab] = useState<FoldersColumnTabId>('tabs');
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [layer, setLayer] = useState<Layer | null>(null);
	const [announcement, setAnnouncement] = useState('');
	const openerRef = useRef<HTMLElement | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);

	const presented = selected === HOME ? undefined : projectsByKey.get(selected);
	// The project presented went away — closed here or elsewhere: fall back to
	// where the user is, and leave edit mode, which was about that project.
	useEffect(() => {
		if (selected === HOME || presented !== undefined) return;
		setIsEditing(false);
		setSelected(
			frontProjectKey !== undefined && projectsByKey.has(frontProjectKey)
				? frontProjectKey
				: HOME,
		);
	}, [frontProjectKey, presented, projectsByKey, selected]);

	const isOwnServer = presented?.serverId === currentServer.id;
	const showsTabs =
		presented !== undefined &&
		presented.key === frontProjectKey &&
		agents !== undefined;
	const shownTab: FoldersColumnTabId = showsTabs ? tab : 'tabs';

	const openLayer = (next: Layer) => {
		const active = document.activeElement;
		openerRef.current = active instanceof HTMLElement ? active : null;
		setLayer(next);
	};
	const closeLayer = () => {
		setLayer(null);
		const opener = openerRef.current;
		openerRef.current = null;
		// Focus goes back to what opened the layer once it has gone.
		if (opener !== null) window.requestAnimationFrame(() => opener.focus());
	};
	const closeSearch = () => {
		setIsSearchOpen(false);
		setQuery('');
	};

	useEffect(() => {
		if (isSearchOpen) searchRef.current?.focus();
	}, [isSearchOpen]);

	// The dismiss key closes the topmost layer only: a menu or the dropup, then
	// an expanded filter, and only then the drawer.
	const layerRef = useRef(layer);
	layerRef.current = layer;
	const searchOpenRef = useRef(isSearchOpen);
	searchOpenRef.current = isSearchOpen;
	// A press beside the drawer follows the same order as the dismiss key.
	const dismissTopLayer = () => {
		if (layerRef.current !== null) closeLayer();
		else if (searchOpenRef.current) closeSearch();
		else onDismiss();
	};
	const dismissTopLayerRef = useRef(dismissTopLayer);
	dismissTopLayerRef.current = dismissTopLayer;
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || gripDragState.active) return;
			event.stopPropagation();
			dismissTopLayerRef.current();
		};
		window.addEventListener('keydown', onKeyDown, { capture: true });
		return () =>
			window.removeEventListener('keydown', onKeyDown, { capture: true });
	}, [onDismiss]);

	const selectRailItem = (key: string) => {
		setIsEditing(false);
		setLayer(null);
		setTab('tabs');
		if (isSearchOpen) closeSearch();
		setSelected(key);
		bodyRef.current?.scrollTo?.({ top: 0 });
	};

	const launcherIds = launchers.map((launcher) => launcher.id);
	const lastLauncher =
		props.rememberedLauncherId !== COMPACT_SHELL_LAUNCHER &&
		launcherIds.includes(props.rememberedLauncherId)
			? props.rememberedLauncherId
			: COMPACT_SHELL_LAUNCHER;
	const launcherName = (id: string) =>
		id === COMPACT_SHELL_LAUNCHER
			? 'Terminal'
			: (launchers.find((launcher) => launcher.id === id)?.displayName ??
				'Terminal');
	const launcherIcon = (id: string) =>
		id === COMPACT_SHELL_LAUNCHER
			? 'terminal'
			: (launchers.find((launcher) => launcher.id === id)?.icon ?? 'terminal');

	const targetFolderOf = (project: CompactSwitcherProjectGroup) => {
		const selectedId = props.selectedFolderIdFor(project);
		return (
			project.folders.find((folder) => folder.folderId === selectedId) ??
			project.folders.find((folder) => folder.isGeneral) ??
			project.folders[0]
		);
	};

	const create = (
		project: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup | undefined,
		launcherId: string,
	) => {
		// Another server's launchers are not this window's to start.
		const id =
			project.serverId === currentServer.id
				? launcherId
				: COMPACT_SHELL_LAUNCHER;
		props.onCreateTerminal(project, folder, id);
	};

	const launcherItems = (
		project: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup | undefined,
		options: Readonly<{ marksLast: boolean }>,
	): CompactSheetItem[] => {
		const own = project.serverId === currentServer.id;
		const ids = [COMPACT_SHELL_LAUNCHER, ...(own ? launcherIds : [])];
		const items: CompactSheetItem[] = ids.map((id) => ({
			kind: 'action',
			key: `launch:${id}`,
			label: options.marksLast ? launcherName(id) : `New ${launcherName(id)}`,
			icon: <LauncherIcon icon={launcherIcon(id)} />,
			...(options.marksLast && own && id === lastLauncher
				? { hint: 'Last used' }
				: {}),
			onSelect: () => create(project, folder, id),
		}));
		if (!own)
			items.push({
				kind: 'note',
				key: 'launch:elsewhere',
				text: `Switch to ${serverLabelOf(project.serverId)} for its launchers.`,
			});
		return items;
	};

	const announce = (message: string) => setAnnouncement(message);

	/* ------------------------------------------------------------ layers */

	let layerElement: ReactNode = null;
	if (layer?.kind === 'row') {
		const row = layer.row;
		const project = [...projectsByKey.values()].find(
			(candidate) =>
				candidate.serverId === row.serverId &&
				candidate.projectId === row.projectId,
		);
		const own = row.serverId === currentServer.id;
		const isTerminal = row.panelKind === 'terminal';
		const otherFolders =
			project?.folders.filter((folder) => folder.folderId !== row.folderId) ??
			[];
		const items: CompactSheetItem[] = [
			{
				kind: 'action',
				key: 'open',
				label: 'Open',
				onSelect: () => {
					setLayer(null);
					props.onActivatePanel(row);
				},
			},
		];
		if (own) {
			if (isTerminal)
				items.push({
					kind: 'action',
					key: 'rename',
					label: 'Rename',
					icon: <Pencil size={14} />,
					onSelect: () => {
						setLayer(null);
						props.onRenamePanel(row);
					},
				});
			if (isTerminal && otherFolders.length > 0) {
				items.push({ kind: 'separator', key: 'move-separator' });
				items.push({
					kind: 'note',
					key: 'move-heading',
					text: 'Move to folder…',
				});
				for (const folder of otherFolders)
					items.push({
						kind: 'action',
						key: `move:${folder.folderId}`,
						label: displayFolderName(folder.name),
						icon: folder.isLinked ? <GitBranch size={14} /> : undefined,
						onSelect: () => {
							closeLayer();
							props.onMovePanelToFolder(row, folder.folderId);
						},
					});
			}
			items.push({ kind: 'separator', key: 'close-separator' });
			items.push({
				kind: 'action',
				key: 'close',
				label: 'Close',
				danger: true,
				icon: <X size={14} />,
				onSelect: () => {
					closeLayer();
					props.onClosePanel(row);
				},
			});
		}
		layerElement = (
			<CompactSheetMenu
				label={`${row.title} actions`}
				header={<div className="compact-drawer__sheet-title">{row.title}</div>}
				items={items}
				onClose={closeLayer}
			/>
		);
	} else if (layer?.kind === 'folder' && presented !== undefined) {
		const folder = layer.folder;
		const entries =
			isOwnServer && props.folderMenuFor !== undefined
				? (props.folderMenuFor(presented, folder) ?? [])
				: [];
		const items: CompactSheetItem[] = launcherItems(presented, folder, {
			marksLast: false,
		});
		items.push({
			kind: 'action',
			key: 'show-folder',
			label: 'Show folder',
			icon: <Folder size={14} />,
			onSelect: () => {
				setLayer(null);
				props.onActivateFolder(presented, folder);
			},
		});
		if (entries.length > 0) items.push({ kind: 'separator', key: 'context' });
		entries.forEach((entry, index) => {
			if (entry.separator === true) {
				items.push({ kind: 'separator', key: `separator:${index}` });
				return;
			}
			items.push({
				kind: 'action',
				key: entry.id,
				label: entry.label,
				disabled: entry.disabled,
				...(entry.danger === true ? { danger: true } : {}),
				onSelect: () => {
					setLayer(null);
					props.onFolderMenuAction(presented, folder, entry.id);
				},
			});
		});
		layerElement = (
			<CompactSheetMenu
				label={`${folder.name} actions`}
				header={
					<div className="compact-drawer__sheet-title">
						{folder.isLinked ? (
							<GitBranch size={13} aria-hidden="true" />
						) : null}
						{displayFolderName(folder.name)}
					</div>
				}
				items={items}
				onClose={closeLayer}
			/>
		);
	} else if (layer?.kind === 'server') {
		const servers = props.servers ?? [];
		const items: CompactSheetItem[] = [];
		if (servers.length > 1 && props.onSwitchServer !== undefined) {
			items.push({ kind: 'note', key: 'servers', text: 'Servers' });
			for (const server of servers)
				items.push({
					kind: 'action',
					key: `server:${server.profileId}`,
					label: server.label,
					checked: server.isCurrent,
					...(server.isSwitching ? { hint: 'Connecting…' } : {}),
					icon: <Server size={14} />,
					onSelect: () => {
						if (!server.isCurrent) props.onSwitchServer?.(server.profileId);
					},
				});
		}
		if (props.serverUpgrades)
			items.push({
				kind: 'custom',
				key: 'upgrades',
				node: (
					<div className="compact-drawer__sheet-upgrades">
						<p className="compact-drawer__sheet-note">Server updates</p>
						{props.serverUpgrades}
					</div>
				),
			});
		items.push({ kind: 'separator', key: 'add-separator' });
		items.push({
			kind: 'action',
			key: 'add-connection',
			label: 'Add connection',
			icon: <Plus size={14} />,
			onSelect: () => {
				setLayer(null);
				props.onAddConnection();
			},
		});
		layerElement = (
			<CompactSheetMenu
				label="Servers"
				header={
					<div className="compact-drawer__sheet-title">
						<Server size={13} aria-hidden="true" />
						{currentServer.label}
					</div>
				}
				items={items}
				onClose={closeLayer}
			/>
		);
	} else if (layer?.kind === 'dropup' && presented !== undefined) {
		const target =
			presented.folders.find((folder) => folder.folderId === layer.folderId) ??
			targetFolderOf(presented);
		layerElement = (
			<CompactSheetMenu
				className="compact-drawer__dropup"
				label="New terminal"
				header={
					presented.folders.length === 0 ? null : (
						<div className="compact-drawer__dropup-target">
							<span className="compact-drawer__sheet-note">Open in</span>
							<div
								className="compact-drawer__chips"
								role="radiogroup"
								aria-label="Folder"
							>
								{presented.folders.map((folder) => (
									// biome-ignore lint/a11y/useSemanticElements: a chip row; a native radio cannot carry the worktree glyph.
									<button
										key={folder.key}
										type="button"
										role="radio"
										aria-checked={folder.key === target?.key}
										aria-label={folder.name}
										className="compact-drawer__chip"
										data-compact-dropup-folder={folder.key}
										onClick={() =>
											setLayer({ kind: 'dropup', folderId: folder.folderId })
										}
									>
										{folder.isLinked ? (
											<GitBranch size={12} aria-hidden="true" />
										) : null}
										<span className="compact-drawer__chip-label">
											{displayFolderName(folder.name)}
										</span>
									</button>
								))}
							</div>
						</div>
					)
				}
				items={launcherItems(presented, target, { marksLast: true })}
				onClose={closeLayer}
			/>
		);
	}

	/* ------------------------------------------------------------ panel */

	const homeBadge = needsYou.length;
	const multipleConnections = railGroups.length > 1;
	const filtered = useMemo(
		() => filterCompactSwitcherGroups(groups, query),
		[groups, query],
	);
	const isFiltering = query.trim().length > 0;

	const activatePanel = (row: CompactSwitcherPanelRow) =>
		props.onActivatePanel(row);

	const header = (
		<div
			className={`compact-drawer__head${isSearchOpen ? ' compact-drawer__head--searching' : ''}`}
		>
			{isSearchOpen ? (
				<div className="compact-drawer__search">
					<Search size={14} aria-hidden="true" />
					{/* The input is set at the 16px iOS demands and scaled back, so
					    focusing it cannot zoom the page. */}
					<span className="compact-drawer__field">
						<input
							ref={searchRef}
							id="compact-switcher-filter"
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search terminals, folders, projects"
							aria-label="Search terminals and projects"
							autoComplete="off"
							spellCheck={false}
						/>
					</span>
					<button
						type="button"
						className="compact-drawer__icon"
						onClick={closeSearch}
						aria-label="Close search"
					>
						<X size={16} aria-hidden="true" />
					</button>
				</div>
			) : (
				<>
					<div className="compact-drawer__title">
						{presented === undefined ? (
							<span className="compact-drawer__name">Home</span>
						) : (
							<>
								<span
									className="compact-drawer__name"
									style={
										{ '--compact-project': presented.color } as CSSProperties
									}
								>
									<span className="compact-drawer__swatch" aria-hidden="true" />
									{presented.title}
								</span>
								<ProjectSummary project={presented} />
							</>
						)}
					</div>
					{shownTab !== 'tabs' || isEditing ? null : (
						<button
							type="button"
							className="compact-drawer__icon"
							onClick={() => setIsSearchOpen(true)}
							aria-label="Search terminals and projects"
							aria-expanded={false}
							title="Search"
						>
							<Search size={17} aria-hidden="true" />
						</button>
					)}
					{presented !== undefined && isOwnServer && shownTab === 'tabs' ? (
						<button
							type="button"
							className={`compact-drawer__edit${isEditing ? ' compact-drawer__edit--on' : ''}`}
							onClick={() => setIsEditing((current) => !current)}
							aria-pressed={isEditing}
							data-compact-switcher-edit="true"
						>
							{isEditing ? 'Done' : 'Edit'}
						</button>
					) : null}
					<button
						type="button"
						className="compact-drawer__icon"
						onClick={onDismiss}
						aria-label="Close switcher"
						title="Close"
						data-compact-switcher-close="true"
					>
						<X size={18} aria-hidden="true" />
					</button>
				</>
			)}
		</div>
	);

	let body: ReactNode;
	if (isFiltering) {
		body = (
			<FilterResults
				{...(activePanelKey === undefined ? {} : { activePanelKey })}
				groups={filtered}
				namesConnections={multipleConnections}
				onActivateFolder={props.onActivateFolder}
				onActivatePanel={activatePanel}
				onPanelMenu={(row) => openLayer({ kind: 'row', row })}
				query={query}
			/>
		);
	} else if (presented === undefined) {
		body = (
			<div className="compact-drawer__home" data-compact-home-panel="true">
				<ul className="compact-drawer__sections">
					{props.homeSections.map((item) => {
						const current =
							isHomeSelected && props.homeFrontSection === item.section;
						return (
							<li key={item.section}>
								<button
									type="button"
									className={`compact-drawer__section${current ? ' compact-drawer__section--current' : ''}`}
									aria-current={current ? 'page' : undefined}
									data-compact-home-section={item.section}
									onClick={() => props.onOpenHomeSection(item.section)}
								>
									<span className="compact-drawer__section-name">
										{HOME_SECTION_LABELS[item.section]}
									</span>
									<span className="compact-drawer__section-summary">
										{item.summary}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
				{needsYou.length === 0 ? null : (
					<section
						className="compact-drawer__needs"
						aria-label="Needs you"
						data-compact-needs-you="true"
					>
						<h3 className="compact-drawer__needs-heading">Needs you</h3>
						<div className="compact-drawer__rows">
							{needsYou.map((entry) => (
								<div
									key={entry.panel.key}
									className="compact-drawer__needs-item"
									style={
										{
											'--compact-project': entry.project.color,
										} as CSSProperties
									}
								>
									<span className="compact-drawer__needs-where">
										<span
											className="compact-drawer__swatch"
											aria-hidden="true"
										/>
										{entry.project.title}
										{entry.folderName === undefined
											? ''
											: ` › ${displayFolderName(entry.folderName)}`}
									</span>
									<PanelRow
										isActive={entry.panel.key === activePanelKey}
										isEditing={false}
										onActivate={() => activatePanel(entry.panel)}
										onClose={() => {}}
										onMenu={() => openLayer({ kind: 'row', row: entry.panel })}
										panel={entry.panel}
									/>
								</div>
							))}
						</div>
					</section>
				)}
			</div>
		);
	} else if (shownTab === 'agents') {
		body = agents;
	} else {
		body = (
			<FolderTree
				{...(activePanelKey === undefined ? {} : { activePanelKey })}
				collapsedFolderIds={props.collapsedFolderIdsFor(presented)}
				isEditing={isEditing}
				isOwnServer={isOwnServer}
				onActivatePanel={activatePanel}
				onAnnounce={announce}
				onClosePanel={props.onClosePanel}
				onFolderMenu={(folder) => openLayer({ kind: 'folder', folder })}
				onNewTerminal={(folder) =>
					openLayer({ kind: 'dropup', folderId: folder.folderId })
				}
				onPanelMenu={(row) => openLayer({ kind: 'row', row })}
				onRemoveFolder={(folder) => {
					const entry = props
						.folderMenuFor?.(presented, folder)
						?.find(
							(candidate) =>
								candidate.separator !== true &&
								(candidate.id === 'delete-worktree' ||
									candidate.id === 'delete-folder'),
						);
					if (entry === undefined || entry.separator === true || entry.disabled)
						return;
					props.onFolderMenuAction(presented, folder, entry.id);
				}}
				onReorderFolders={(folderIds) =>
					props.onReorderFolders(presented, folderIds)
				}
				onReorderPanels={(folder, panelIds) =>
					props.onReorderPanels(presented, folder, panelIds)
				}
				onToggleCollapsed={(folder) =>
					props.onToggleFolderCollapsed(presented, folder)
				}
				project={presented}
			/>
		);
	}

	const target =
		presented === undefined ? undefined : targetFolderOf(presented);
	const mainLauncher =
		presented !== undefined && isOwnServer
			? lastLauncher
			: COMPACT_SHELL_LAUNCHER;
	const createBar =
		isEditing || shownTab === 'agents' ? null : (
			<div className="compact-drawer__create">
				{presented === undefined ? (
					<button
						type="button"
						className="compact-drawer__create-wide"
						onClick={props.onNewProject}
					>
						<FolderPlus size={15} aria-hidden="true" />
						New project
					</button>
				) : (
					<>
						<div className="compact-drawer__split">
							<button
								type="button"
								className="compact-drawer__split-main"
								data-compact-switcher-new-terminal="true"
								data-compact-launcher={mainLauncher}
								onClick={() => create(presented, target, mainLauncher)}
								aria-label={`New ${launcherName(mainLauncher)} terminal in ${
									target === undefined
										? presented.title
										: `${target.name} of ${presented.title}`
								}`}
							>
								<LauncherIcon icon={launcherIcon(mainLauncher)} />
								<span className="compact-drawer__split-text">
									<span className="compact-drawer__split-label">
										{launcherName(mainLauncher)}
									</span>
									{target === undefined ? null : (
										<span
											className="compact-drawer__split-target"
											aria-hidden="true"
										>
											in {displayFolderName(target.name)}
										</span>
									)}
								</span>
							</button>
							<button
								type="button"
								className="compact-drawer__split-more"
								data-compact-switcher-launchers="true"
								onClick={() =>
									layer?.kind === 'dropup'
										? closeLayer()
										: openLayer({
												kind: 'dropup',
												...(target === undefined
													? {}
													: { folderId: target.folderId }),
											})
								}
								aria-label="Choose what to open"
								aria-haspopup="menu"
								aria-expanded={layer?.kind === 'dropup'}
							>
								<ChevronUp size={16} aria-hidden="true" />
							</button>
						</div>
						<button
							type="button"
							className="compact-drawer__create-icon"
							onClick={props.onNewProject}
							aria-label="New project"
							title="New project"
						>
							<FolderPlus size={16} aria-hidden="true" />
						</button>
					</>
				)}
			</div>
		);

	return (
		<div
			className="compact-drawer-scrim"
			data-compact-switcher="true"
			onPointerDown={(event) => {
				if (event.target !== event.currentTarget) return;
				// The default mousedown action would move focus to the body right
				// after it is handed back to the control that opened the switcher.
				event.preventDefault();
				dismissTopLayer();
			}}
		>
			<div
				className="compact-drawer"
				role="dialog"
				aria-modal="true"
				aria-label="Switch terminal"
				data-compact-drawer="true"
			>
				<nav className="compact-drawer__rail" aria-label="Places">
					<button
						type="button"
						className="compact-drawer__server"
						onClick={() => openLayer({ kind: 'server' })}
						aria-label={`Server ${currentServer.label}${currentServer.isReachable ? '' : ', unreachable'}`}
						aria-haspopup="menu"
						title={currentServer.label}
						data-compact-switcher-server="true"
					>
						<Server size={17} aria-hidden="true" />
						<span
							className={`compact-drawer__server-dot${currentServer.isReachable ? '' : ' compact-drawer__server-dot--unreachable'}`}
							aria-hidden="true"
						/>
					</button>
					<button
						type="button"
						className={`compact-drawer__rail-home${selected === HOME ? ' compact-drawer__rail-item--selected' : ''}`}
						onClick={() => selectRailItem(HOME)}
						aria-label={
							homeBadge === 0
								? 'Home'
								: `Home, ${homeBadge} ${homeBadge === 1 ? 'needs' : 'need'} you`
						}
						aria-pressed={selected === HOME}
						data-terminay-home-control="true"
						data-compact-switcher-home="true"
					>
						<span className="compact-drawer__rail-tile" aria-hidden="true">
							<House size={18} />
							{homeBadge === 0 ? null : (
								<Badge count={homeBadge} tone="attention" />
							)}
						</span>
						<span className="compact-drawer__rail-label" aria-hidden="true">
							Home
						</span>
					</button>
					<span className="compact-drawer__rail-divider" aria-hidden="true" />
					<div className="compact-drawer__rail-scroll">
						{railGroups.map((connection) => (
							<RailGroup
								key={connection.serverId}
								connection={connection}
								isEditing={isEditing}
								isMovable={connection.serverId === currentServer.id}
								onAnnounce={announce}
								onCloseProject={props.onCloseProject}
								onEditProject={props.onEditProject}
								onReorder={props.onReorderProjects}
								onSelect={selectRailItem}
								selected={selected}
								showHeading={multipleConnections}
							/>
						))}
					</div>
					<button
						type="button"
						className="compact-drawer__rail-add"
						onClick={props.onNewProject}
						aria-label="New project"
						title="New project"
					>
						<span className="compact-drawer__rail-tile" aria-hidden="true">
							<Plus size={18} />
						</span>
					</button>
				</nav>
				<div className="compact-drawer__panel">
					{header}
					{showsTabs ? (
						<SidebarGroupTabs
							className="compact-drawer__tabs"
							activeTab={shownTab}
							tabs={FOLDERS_COLUMN_TABS}
							idPrefix="compact-switcher"
							label="Switcher"
							showLabels
							onSelect={(tabId) => {
								// The filter and edit mode belong to Tabs.
								if (tabId !== 'tabs') {
									if (isSearchOpen) closeSearch();
									setIsEditing(false);
								}
								setTab(tabId);
							}}
						/>
					) : null}
					<div
						ref={bodyRef}
						className={`compact-drawer__body${shownTab === 'agents' ? ' compact-drawer__agents' : ''}`}
						{...(showsTabs
							? {
									id: 'compact-switcher-panel',
									role: 'tabpanel',
									'aria-labelledby': `compact-switcher-tab-${shownTab}`,
								}
							: {})}
						data-compact-editing={isEditing ? 'true' : undefined}
					>
						{body}
					</div>
					{createBar}
					{layerElement}
				</div>
				<span className="compact-drawer__live" aria-live="polite">
					{announcement}
				</span>
			</div>
		</div>
	);
}
