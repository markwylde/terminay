/**
 * The one surface that answers "which panel".
 *
 * Projects, panels, and connections stopped being three menus here: they are
 * three levels of one list. A row names its panel and, when this window
 * holds that terminal's buffer, the last line it printed — which is how a user
 * recognises the terminal they meant rather than the name they half-remember.
 *
 * It overlays the workspace instead of taking height from it, so opening the
 * switcher never resizes a terminal and dismissing it never costs a relayout.
 */

import { FolderPlus, Plus, Search, Server, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { AgentStatusIndicator } from '../components/AgentStatusIndicator';
import { useLongPress } from '../hooks/useLongPress';
import type {
	CompactSwitcherConnectionGroup,
	CompactSwitcherFolderGroup,
	CompactSwitcherPanelRow,
	CompactSwitcherProjectGroup,
} from './compactSwitcherModel.ts';
import {
	compactSwitcherIsEmpty,
	formatCompactSwitcherSummary,
} from './compactSwitcherModel.ts';

export type CompactSwitcherProps = Readonly<{
	/** The row for the panel in front, so the list says where you already are. */
	activePanelKey?: string;
	/** Where the create bar's terminal will land: the project in front and the
	 * folder this device has selected in it. Passed in, not read from `groups`,
	 * because a filter can narrow the project in front out of the list. */
	front?: CompactSwitcherFront;
	groups: readonly CompactSwitcherConnectionGroup[];
	/** Choosing a folder heading shows that folder, with or without panels.
	 * At this width it is the only way to an empty one. */
	onActivateFolder?: (
		group: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup,
	) => void;
	onActivatePanel: (row: CompactSwitcherPanelRow) => void;
	onAddConnection: () => void;
	onClosePanel: (row: CompactSwitcherPanelRow) => void;
	onCloseProject: (group: CompactSwitcherProjectGroup) => void;
	onDismiss: () => void;
	/** Long-pressing a project heading edits it, the gesture the project
	 * switcher rows already carry. */
	onEditProject: (group: CompactSwitcherProjectGroup) => void;
	/** Long-pressing a panel row edits it, the gesture its hidden tab held. */
	onEditPanel: (row: CompactSwitcherPanelRow) => void;
	onNewProject: () => void;
	/** Creates in a project whose folders this window does not list. */
	onNewTerminal: (group: CompactSwitcherProjectGroup) => void;
	/** Creates in the folder whose label carried the control. */
	onNewTerminalInFolder: (
		group: CompactSwitcherProjectGroup,
		folder: CompactSwitcherFolderGroup,
	) => void;
	/** Creates in the project in front; absent when no project is active. */
	onNewTerminalHere?: () => void;
	onQueryChange: (query: string) => void;
	query: string;
	/** The servers this window could show, Local first, where the host can
	 * switch between them. At this width the header's connection menu is not
	 * drawn, so switching lives here. */
	servers?: readonly CompactSwitcherServer[];
	onSwitchServer?: (profileId: string) => void;
}>;

export type CompactSwitcherFront = Readonly<{
	color: string;
	/** Absent when this window does not know the project's folders. */
	folderName?: string;
	projectTitle: string;
}>;

export type CompactSwitcherServer = Readonly<{
	profileId: string;
	label: string;
	isCurrent: boolean;
	isSwitching: boolean;
}>;

/**
 * The panel row carries the gesture the hidden tab used to carry.
 *
 * Long-pressing a panel tab opened its editor; at this width no tab strip is
 * drawn, so the row that replaced it takes the press. The project heading above
 * already edits on a long press, which makes this the consistent reading rather
 * than a second idiom — except that a short press here still activates, because
 * activating is what a panel row is for. Close sits beside the row so it is
 * not a nested button.
 */
function CompactSwitcherPanel({
	isActive,
	onActivate,
	onClose,
	onEdit,
	panel,
}: Readonly<{
	isActive: boolean;
	onActivate: () => void;
	onClose: () => void;
	onEdit: () => void;
	panel: CompactSwitcherPanelRow;
}>) {
	const longPress = useLongPress(onEdit);
	return (
		<div className="compact-switcher__row">
			<button
				type="button"
				className="compact-switcher__terminal"
				onPointerDown={longPress.onPointerDown}
				onPointerMove={longPress.onPointerMove}
				onPointerUp={longPress.onPointerUp}
				onPointerCancel={longPress.onPointerCancel}
				onContextMenu={longPress.onContextMenu}
				onClick={longPress.bindClick(onActivate)}
				aria-current={isActive}
				data-compact-switcher-panel={panel.key}
				data-compact-switcher-terminal={
					panel.panelKind === 'terminal' ? panel.key : undefined
				}
				data-project-id={panel.projectId}
			>
				<span
					className="compact-switcher__terminal-state"
					aria-hidden={panel.state === 'idle'}
				>
					<AgentStatusIndicator state={panel.state} size="small" showIdle />
				</span>
				<span className="compact-switcher__terminal-text">
					<span className="compact-switcher__terminal-title">
						{panel.title}
					</span>
					{panel.preview === undefined ? null : (
						<span className="compact-switcher__terminal-preview">
							{panel.preview}
						</span>
					)}
				</span>
			</button>
			<button
				type="button"
				className="compact-switcher__close"
				onClick={onClose}
				aria-label={`Close ${panel.title}`}
				title={`Close ${panel.title}`}
			>
				<X size={13} aria-hidden="true" />
			</button>
		</div>
	);
}

/**
 * A project's terminals in words.
 *
 * It stands where an activity dot would: a second dot beside the colour swatch
 * read as a pair, and a count in words says more than a colour. Only the
 * leading group takes its state's colour, so the eye lands on what is most
 * urgent.
 */
function CompactSwitcherSummary({
	project,
}: Readonly<{ project: CompactSwitcherProjectGroup }>) {
	const summary = formatCompactSwitcherSummary(project.summary);
	if (summary.groups.length === 0) return null;
	return (
		<span
			className="compact-switcher__summary"
			role="img"
			aria-label={summary.accessible}
			data-compact-switcher-summary={project.key}
		>
			{summary.groups.map((entry, index) => (
				<span
					key={entry.group}
					className={`compact-switcher__summary-group${
						index === 0
							? ` compact-switcher__summary-group--${entry.group}`
							: ''
					}`}
				>
					{index === 0 ? '' : ' · '}
					{entry.text}
				</span>
			))}
		</span>
	);
}

function CompactSwitcherProjectHeading({
	onEdit,
	project,
}: Readonly<{
	onEdit: () => void;
	project: CompactSwitcherProjectGroup;
}>) {
	const longPress = useLongPress(onEdit);
	return (
		<button
			type="button"
			className="compact-switcher__project-button"
			data-compact-switcher-project={project.key}
			onPointerDown={longPress.onPointerDown}
			onPointerMove={longPress.onPointerMove}
			onPointerUp={longPress.onPointerUp}
			onPointerCancel={longPress.onPointerCancel}
			onContextMenu={longPress.onContextMenu}
			onClick={longPress.bindClick(() => {})}
			title="Long-press to edit project"
		>
			<span className="compact-switcher__project-swatch" aria-hidden="true" />
			<span className="compact-switcher__project-name">{project.title}</span>
			<CompactSwitcherSummary project={project} />
		</button>
	);
}

export function CompactSwitcher({
	activePanelKey,
	front,
	groups,
	onActivateFolder,
	onActivatePanel,
	onAddConnection,
	onClosePanel,
	onCloseProject,
	onDismiss,
	onEditProject,
	onEditPanel,
	onNewProject,
	onNewTerminal,
	onNewTerminalHere,
	onNewTerminalInFolder,
	onQueryChange,
	onSwitchServer,
	query,
	servers = [],
}: CompactSwitcherProps) {
	const searchRef = useRef<HTMLInputElement>(null);
	// The switcher opens to be read, not typed into: nearly every use is a tap
	// on a project or a panel. Nothing takes focus until a user asks for the
	// filter, so opening the sheet never raises a keyboard.
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	useEffect(() => {
		if (isSearchOpen) searchRef.current?.focus();
	}, [isSearchOpen]);
	const closeSearch = () => {
		setIsSearchOpen(false);
		onQueryChange('');
	};
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.stopPropagation();
			onDismiss();
		};
		window.addEventListener('keydown', onKeyDown, { capture: true });
		return () =>
			window.removeEventListener('keydown', onKeyDown, { capture: true });
	}, [onDismiss]);
	const isEmpty = groups.length === 0 || compactSwitcherIsEmpty(groups);
	return (
		<div
			className="compact-switcher-scrim"
			data-compact-switcher="true"
			onPointerDown={(event) => {
				if (event.target !== event.currentTarget) return;
				// The default mousedown action would move focus to the scrim's
				// nearest focusable ancestor — the body — right after we hand it
				// back to the control that opened the switcher.
				event.preventDefault();
				onDismiss();
			}}
		>
			<div
				className="compact-switcher"
				role="dialog"
				aria-modal="true"
				aria-label="Switch terminal"
			>
				<div
					className={`compact-switcher__tools${isSearchOpen ? ' compact-switcher__tools--searching' : ''}`}
				>
					<span className="compact-switcher__grab" aria-hidden="true" />
					{isSearchOpen ? (
						<div className="compact-switcher__search">
							<Search size={15} aria-hidden="true" />
							{/* The field owns the layout box; the input inside it is set at
							    the 16px iOS demands and scaled back to the sheet's type
							    size, so focusing it cannot zoom the page. */}
							<span className="compact-switcher__field">
								<input
									ref={searchRef}
									id="compact-switcher-filter"
									type="search"
									value={query}
									onChange={(event) => onQueryChange(event.target.value)}
									placeholder="Search terminals and projects"
									aria-label="Search terminals and projects"
									autoComplete="off"
									spellCheck={false}
								/>
							</span>
							<button
								type="button"
								className="compact-switcher__search-close"
								onClick={closeSearch}
								aria-label="Close search"
							>
								<X size={15} aria-hidden="true" />
							</button>
						</div>
					) : (
						<button
							type="button"
							className="compact-switcher__search-open"
							onClick={() => setIsSearchOpen(true)}
							aria-label="Search terminals and projects"
							aria-expanded={false}
							title="Search terminals and projects"
						>
							<Search size={15} aria-hidden="true" />
						</button>
					)}
				</div>
				<div className="compact-switcher__body">
					{isEmpty ? (
						<p className="compact-switcher__empty" role="status">
							Nothing matches “{query.trim()}”.
						</p>
					) : (
						groups.map((connection) => (
							<section
								className="compact-switcher__connection"
								key={connection.serverId}
							>
								<h2 className="compact-switcher__connection-name">
									<span
										className="compact-switcher__connection-dot"
										aria-hidden="true"
									/>
									{connection.serverLabel}
									<span
										className="compact-switcher__connection-rule"
										aria-hidden="true"
									/>
								</h2>
								{connection.projects.map((project) => {
									const rows = (panels: readonly CompactSwitcherPanelRow[]) =>
										panels.map((panel) => (
											<CompactSwitcherPanel
												key={panel.key}
												isActive={panel.key === activePanelKey}
												onActivate={() => onActivatePanel(panel)}
												onClose={() => onClosePanel(panel)}
												onEdit={() => onEditPanel(panel)}
												panel={panel}
											/>
										));
									return (
										// The card is what says "these belong to this project":
										// its border and header take the project's colour, and
										// nothing inside it is indented.
										<div
											className="compact-switcher__card"
											key={project.key}
											data-compact-switcher-card={project.key}
											style={
												{
													'--compact-switcher-project': project.color,
												} as CSSProperties
											}
										>
											<div className="compact-switcher__project">
												<CompactSwitcherProjectHeading
													onEdit={() => onEditProject(project)}
													project={project}
												/>
												<button
													type="button"
													className="compact-switcher__close"
													onClick={() => onCloseProject(project)}
													aria-label={`Close ${project.title}`}
													title={`Close ${project.title}`}
												>
													<X size={13} aria-hidden="true" />
												</button>
												{/* A folder's own control says where a terminal lands.
												    Only a project whose folders are not listed needs
												    one on its header. */}
												{project.folders.length === 0 ? (
													<button
														type="button"
														className="compact-switcher__add"
														onClick={() => onNewTerminal(project)}
														aria-label={`New terminal in ${project.title}`}
														title={`New terminal in ${project.title}`}
													>
														<Plus size={13} aria-hidden="true" />
													</button>
												) : null}
											</div>
											{project.folders.length === 0
												? rows(project.panels)
												: project.folders.map((folder) => (
														<div
															className="compact-switcher__folder-group"
															key={folder.key}
														>
															<div className="compact-switcher__folder-line">
																<button
																	type="button"
																	className="compact-switcher__folder"
																	data-compact-switcher-folder={folder.key}
																	onClick={() =>
																		onActivateFolder?.(project, folder)
																	}
																	aria-label={`Folder ${folder.name} in ${project.title}`}
																>
																	<span className="compact-switcher__folder-name">
																		{folder.name}
																	</span>
																	<span
																		className="compact-switcher__folder-rule"
																		aria-hidden="true"
																	/>
																</button>
																<button
																	type="button"
																	className="compact-switcher__add"
																	data-compact-switcher-folder-add={folder.key}
																	onClick={() =>
																		onNewTerminalInFolder(project, folder)
																	}
																	aria-label={`New terminal in ${folder.name} of ${project.title}`}
																	title={`New terminal in ${folder.name}`}
																>
																	<Plus size={13} aria-hidden="true" />
																</button>
															</div>
															{rows(folder.panels)}
														</div>
													))}
										</div>
									);
								})}
							</section>
						))
					)}
				</div>
				{servers.length > 1 && onSwitchServer !== undefined ? (
					<div
						className="compact-switcher__servers"
						role="radiogroup"
						aria-label="Servers"
					>
						<div className="compact-switcher__servers-label">Servers</div>
						{servers.map((server) => (
							// biome-ignore lint/a11y/useSemanticElements: a row of a touch list; a native radio cannot carry the trailing status.
							<button
								key={server.profileId}
								type="button"
								role="radio"
								aria-checked={server.isCurrent}
								aria-label={server.label}
								className="compact-switcher__server"
								onClick={() => {
									if (!server.isCurrent) onSwitchServer(server.profileId);
								}}
							>
								<span>{server.label}</span>
								{server.isSwitching ? (
									<span className="compact-switcher__server-meta">
										Connecting…
									</span>
								) : null}
							</button>
						))}
					</div>
				) : null}
				{/* One wide control that says where it creates, because "new
				    terminal" is what this bar is nearly always pressed for. */}
				<div className="compact-switcher__create">
					{onNewTerminalHere === undefined ? (
						<button
							type="button"
							className="compact-switcher__create-main"
							onClick={onNewProject}
						>
							<Plus size={14} aria-hidden="true" />
							<span className="compact-switcher__create-label">
								New project
							</span>
						</button>
					) : (
						<>
							<button
								type="button"
								className="compact-switcher__create-main compact-switcher__create-main--terminal"
								data-compact-switcher-new-terminal="true"
								onClick={onNewTerminalHere}
								aria-label={
									front === undefined
										? 'New terminal'
										: front.folderName === undefined
											? `New terminal in ${front.projectTitle}`
											: `New terminal in ${front.folderName} of ${front.projectTitle}`
								}
								style={
									front === undefined
										? undefined
										: ({
												'--compact-switcher-project': front.color,
											} as CSSProperties)
								}
							>
								<Plus size={14} aria-hidden="true" />
								<span className="compact-switcher__create-label">
									{front === undefined ? 'New terminal' : 'Terminal'}
									{front === undefined ? null : (
										<span className="compact-switcher__create-where">
											{` in ${front.projectTitle}`}
											{front.folderName === undefined
												? ''
												: ` › ${front.folderName}`}
										</span>
									)}
								</span>
							</button>
							<button
								type="button"
								className="compact-switcher__create-icon"
								onClick={onNewProject}
								aria-label="New project"
								title="New project"
							>
								<FolderPlus size={16} aria-hidden="true" />
							</button>
						</>
					)}
					<button
						type="button"
						className="compact-switcher__create-icon"
						onClick={onAddConnection}
						aria-label="Add connection"
						title="Add connection"
					>
						<Server size={16} aria-hidden="true" />
					</button>
				</div>
			</div>
		</div>
	);
}
