/**
 * The one surface that answers "which terminal".
 *
 * Projects, terminals, and connections stopped being three menus here: they are
 * three levels of one list. A row names its terminal and, when this window
 * holds that terminal's buffer, the last line it printed — which is how a user
 * recognises the terminal they meant rather than the name they half-remember.
 *
 * It overlays the workspace instead of taking height from it, so opening the
 * switcher never resizes a terminal and dismissing it never costs a relayout.
 */

import { Plus, Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AgentStatusIndicator } from '../components/AgentStatusIndicator';
import { useLongPress } from '../hooks/useLongPress';
import type {
	CompactSwitcherConnectionGroup,
	CompactSwitcherProjectGroup,
	CompactSwitcherTerminalRow,
} from './compactSwitcherModel.ts';
import { compactSwitcherIsEmpty } from './compactSwitcherModel.ts';
import { ProjectTabActivityBadge } from './ProjectTabActivityBadge';

export type CompactSwitcherProps = Readonly<{
	/** The row for the terminal in front, so the list says where you already are. */
	activeTerminalKey?: string;
	groups: readonly CompactSwitcherConnectionGroup[];
	onActivateTerminal: (row: CompactSwitcherTerminalRow) => void;
	onAddConnection: () => void;
	onDismiss: () => void;
	/** Long-pressing a project heading edits it, the gesture the project
	 * switcher rows already carry. */
	onEditProject: (group: CompactSwitcherProjectGroup) => void;
	onNewProject: () => void;
	onNewTerminal: (group: CompactSwitcherProjectGroup) => void;
	onQueryChange: (query: string) => void;
	query: string;
}>;

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
	activeTerminalKey,
	groups,
	onActivateTerminal,
	onAddConnection,
	onDismiss,
	onEditProject,
	onNewProject,
	onNewTerminal,
	onQueryChange,
	query,
}: CompactSwitcherProps) {
	const searchRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		searchRef.current?.focus();
	}, []);
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
				onKeyDown={(event) => {
					if (event.key !== 'Escape') return;
					event.stopPropagation();
					onDismiss();
				}}
			>
				<span className="compact-switcher__grab" aria-hidden="true" />
				<div className="compact-switcher__search">
					<Search size={15} aria-hidden="true" />
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
												className="compact-switcher__add"
												onClick={() => onNewTerminal(project)}
												aria-label={`New terminal in ${project.title}`}
												title={`New terminal in ${project.title}`}
											>
												<Plus size={14} aria-hidden="true" />
											</button>
										</div>
										{project.terminals.length === 0 ? (
											<p className="compact-switcher__none">No terminals</p>
										) : (
											project.terminals.map((terminal) => (
												<button
													type="button"
													className="compact-switcher__terminal"
													key={terminal.key}
													onClick={() => onActivateTerminal(terminal)}
													aria-current={terminal.key === activeTerminalKey}
													style={{ borderLeftColor: project.color }}
													data-compact-switcher-terminal={terminal.key}
													data-project-id={terminal.projectId}
												>
													<span
														className="compact-switcher__terminal-state"
														aria-hidden={terminal.state === 'idle'}
													>
														<AgentStatusIndicator
															state={terminal.state}
															size="small"
														/>
													</span>
													<span className="compact-switcher__terminal-text">
														<span className="compact-switcher__terminal-title">
															{terminal.title}
														</span>
														{terminal.preview === undefined ? null : (
															<span className="compact-switcher__terminal-preview">
																{terminal.preview}
															</span>
														)}
													</span>
												</button>
											))
										)}
									</div>
								))}
							</section>
						))
					)}
				</div>
				<div className="compact-switcher__actions">
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
