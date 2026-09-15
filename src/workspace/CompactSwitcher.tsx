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

import { Plus, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AgentStatusIndicator } from '../components/AgentStatusIndicator';
import { useLongPress } from '../hooks/useLongPress';
import type {
	CompactSwitcherConnectionGroup,
	CompactSwitcherPanelRow,
	CompactSwitcherProjectGroup,
} from './compactSwitcherModel.ts';
import { compactSwitcherIsEmpty } from './compactSwitcherModel.ts';
import { ProjectTabActivityBadge } from './ProjectTabActivityBadge';

export type CompactSwitcherProps = Readonly<{
	/** The row for the panel in front, so the list says where you already are. */
	activePanelKey?: string;
	groups: readonly CompactSwitcherConnectionGroup[];
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
	onNewTerminal: (group: CompactSwitcherProjectGroup) => void;
	/** Creates in the project in front; absent when no project is active. */
	onNewTerminalHere?: () => void;
	onQueryChange: (query: string) => void;
	query: string;
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
	projectColor,
	panel,
}: Readonly<{
	isActive: boolean;
	onActivate: () => void;
	onClose: () => void;
	onEdit: () => void;
	projectColor: string;
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
				style={{ borderLeftColor: projectColor }}
				data-compact-switcher-panel={panel.key}
				data-compact-switcher-terminal={
					panel.panelKind === 'terminal' ? panel.key : undefined
				}
				data-project-id={panel.projectId}
				title="Long-press to edit tab"
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
				<X size={14} aria-hidden="true" />
			</button>
		</div>
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
			<span
				className="compact-switcher__project-swatch"
				style={{ background: project.color }}
				aria-hidden="true"
			/>
			<span className="compact-switcher__project-name">{project.title}</span>
			<ProjectTabActivityBadge badge={project.badge} />
		</button>
	);
}

export function CompactSwitcher({
	activePanelKey,
	groups,
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
	onQueryChange,
	query,
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
								{connection.projects.map((project) => (
									<div className="compact-switcher__group" key={project.key}>
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
												<X size={14} aria-hidden="true" />
											</button>
											<button
												type="button"
												className="compact-switcher__add"
												onClick={() => onNewTerminal(project)}
												aria-label={`New terminal in ${project.title}`}
												title={`New terminal in ${project.title}`}
											>
												<Plus size={14} aria-hidden="true" />
											</button>
										</div>
										{project.panels.length === 0 ? (
											<p className="compact-switcher__none">No panels</p>
										) : (
											project.panels.map((panel) => (
												<CompactSwitcherPanel
													key={panel.key}
													isActive={panel.key === activePanelKey}
													onActivate={() => onActivatePanel(panel)}
													onClose={() => onClosePanel(panel)}
													onEdit={() => onEditPanel(panel)}
													projectColor={project.color}
													panel={panel}
												/>
											))
										)}
									</div>
								))}
							</section>
						))
					)}
				</div>
				<div className="compact-switcher__actions">
					{onNewTerminalHere === undefined ? null : (
						<button type="button" onClick={onNewTerminalHere}>
							New terminal
						</button>
					)}
					<button type="button" onClick={onNewProject}>
						New project
					</button>
					<button type="button" onClick={onAddConnection}>
						Add connection
					</button>
				</div>
			</div>
		</div>
	);
}
