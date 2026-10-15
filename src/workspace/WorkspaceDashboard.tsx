import {
	ChevronDown,
	ChevronRight,
	Columns3,
	FileText,
	Folder,
	LayoutGrid,
	List,
	Search,
	TerminalSquare,
	X,
} from 'lucide-react';
import { LiveTerminalTitle } from '../shared/useWorkspaceProjection';
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { AgentStatusIndicator } from '../components/AgentStatusIndicator';
import {
	buildCrossServerDashboardGroups,
	type DashboardServerSource,
	flattenCrossServerDashboardGroups,
	type ServerScopedRow,
} from './crossServerRows';
import { filterDashboardGroups } from './dashboardFilter';
import type {
	DashboardAgent,
	DashboardPanelRow,
	DashboardProjectGroup,
	DashboardProjectRow,
	DashboardRow,
} from './dashboardRows';
import { summarizeDashboard } from './dashboardRows';
import {
	type DashboardBoardColumn,
	DASHBOARD_BOARD_COLUMN_EMPTY,
	DASHBOARD_BOARD_COLUMN_LABELS,
	DASHBOARD_BOARD_COLUMNS,
	DASHBOARD_VIEW_MODE_LABELS,
	DASHBOARD_VIEW_MODES,
	type DashboardBoardItem,
	type DashboardBoardLane,
	type DashboardViewMode,
	buildDashboardBoardItems,
	buildDashboardBoardLanes,
	groupBoardItemsByColumn,
} from './dashboardViewMode';
import {
	recallDashboardBoardGrouped,
	recallDashboardBoardUntrackedCollapsed,
	recallDashboardViewMode,
	rememberDashboardBoardGrouped,
	rememberDashboardBoardUntrackedCollapsed,
	rememberDashboardViewMode,
} from './localViewState';
import './workspaceDashboard.css';

/**
 * The whole workspace on one screen.
 *
 * It answers "what is running and what is waiting on me?" without visiting each
 * project in turn — and it answers it with everything a project's own Agents
 * pane knows, because it reads the same agent projection that pane does.
 *
 * Three views, one model. List inventories the workspace one unwrapped line at
 * a time. Board sorts by what each thing needs from you. Projects groups by
 * where the work lives. The arrangement changes; the facts never do.
 */

const KIND_ICON = {
	file: FileText,
	folder: Folder,
	terminal: TerminalSquare,
} as const;

const KIND_LABEL = {
	file: 'File',
	folder: 'Folder',
	terminal: 'Terminal',
} as const;

const VIEW_MODE_ICON = {
	board: Columns3,
	list: List,
	projects: LayoutGrid,
} as const;

/** How often the "waiting for 4m" labels move on. Cheap, and never per row. */
const ELAPSED_TICK_MS = 15_000;

export type DashboardActivateRow = (
	serverId: string,
	row: DashboardRow,
) => void;

export type DashboardActivateAgent = (
	serverId: string,
	projectId: string,
	agent: DashboardAgent,
) => void;

/** Coarse on purpose: a whole zero unit is noise, not precision. */
function formatElapsed(startedAt: number, now: number): string | undefined {
	const seconds = Math.floor((now - startedAt) / 1000);
	if (!Number.isFinite(seconds) || seconds < 60) return undefined;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24)
		return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
	const days = Math.floor(hours / 24);
	return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}

/** A clock that only ticks while the dashboard is mounted. */
function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = globalThis.setInterval(
			() => setNow(Date.now()),
			ELAPSED_TICK_MS,
		);
		return () => globalThis.clearInterval(timer);
	}, []);
	return now;
}

function CountChip({
	count,
	label,
	tone,
}: {
	count: number;
	label: string;
	tone: 'attention' | 'done' | 'working';
}) {
	if (count <= 0) return null;
	return (
		<span
			className={`workspace-dashboard__count workspace-dashboard__count--${tone}`}
		>
			{count} {label}
		</span>
	);
}

/** Project identity, small enough to sit inside a card that has left its list. */
function ProjectChip({
	project,
	serverLabel,
}: {
	project: DashboardProjectRow;
	serverLabel?: string;
}) {
	return (
		<span
			className="workspace-dashboard__project-chip"
			style={{ '--row-color': project.color } as CSSProperties}
		>
			<span className="workspace-dashboard__swatch" aria-hidden="true" />
			<span className="workspace-dashboard__project-chip-name">
				{project.emoji ? `${project.emoji} ` : ''}
				{project.title}
			</span>
			{serverLabel === undefined ? null : (
				<span className="workspace-dashboard__server">{serverLabel}</span>
			)}
		</span>
	);
}

/**
 * What an agent is doing, in the words the agent itself supplied: the tool it
 * is running, or why it stopped. Shown only when it says more than the state
 * dot beside it already does.
 */
function agentActivityNote(agent: DashboardAgent): string | undefined {
	if (agent.state === 'waiting' || agent.state === 'blocked')
		return agent.waitingReason;
	if (agent.state === 'working') return agent.activeToolName;
	return undefined;
}

function AgentDetail({
	agent,
	now,
}: {
	agent: DashboardAgent;
	now: number;
}) {
	// An untracked agent's state is not shown, so nothing derived from it is.
	const note = agent.untracked ? undefined : agentActivityNote(agent);
	const elapsed = agent.untracked
		? undefined
		: formatElapsed(agent.stateStartedAt, now);
	return (
		<>
			{agent.metadata ? (
				<span className="workspace-dashboard__meta">{agent.metadata}</span>
			) : null}
			{agent.prompt ? (
				<span className="workspace-dashboard__prompt">{agent.prompt}</span>
			) : null}
			<span className="workspace-dashboard__footnotes">
				<span className="workspace-dashboard__state">
					{agent.untracked ? 'untracked' : agent.state}
				</span>
				{elapsed ? (
					<span className="workspace-dashboard__elapsed">for {elapsed}</span>
				) : null}
				{agent.subagentCount > 0 ? (
					<span className="workspace-dashboard__subagents">
						{agent.subagentCount} subagent
						{agent.subagentCount === 1 ? '' : 's'}
					</span>
				) : null}
				{note ? (
					<span className="workspace-dashboard__note">{note}</span>
				) : null}
			</span>
		</>
	);
}

/* -------------------------------------------------------------------------- */
/* List view                                                                  */
/* -------------------------------------------------------------------------- */

function ProjectRow({
	onActivate,
	row,
	serverLabel,
}: {
	onActivate: () => void;
	row: DashboardProjectRow;
	/** Present only when the window has more than one server attached. */
	serverLabel?: string;
}) {
	const { counts } = row;
	const quiet =
		counts.attention === 0 && counts.working === 0 && counts.done === 0;
	return (
		<button
			className="workspace-dashboard__row workspace-dashboard__row--project"
			data-terminay-dashboard-project={row.projectId}
			onClick={onActivate}
			style={{ '--row-color': row.color } as CSSProperties}
			type="button"
		>
			<span className="workspace-dashboard__swatch" aria-hidden="true" />
			<span className="workspace-dashboard__title">
				{row.emoji ? `${row.emoji} ` : ''}
				{row.title}
			</span>
			{serverLabel === undefined ? null : (
				<span className="workspace-dashboard__server">{serverLabel}</span>
			)}
			<span className="workspace-dashboard__counts">
				<CountChip count={counts.attention} label="waiting" tone="attention" />
				<CountChip count={counts.working} label="working" tone="working" />
				<CountChip count={counts.done} label="done" tone="done" />
				{quiet ? (
					<span className="workspace-dashboard__count workspace-dashboard__count--quiet">
						{counts.panels === 0
							? 'no tabs'
							: `${counts.panels} ${counts.panels === 1 ? 'tab' : 'tabs'}`}
					</span>
				) : null}
			</span>
		</button>
	);
}

/**
 * A panel's one line. When an agent owns it, the line is the agent's: its name
 * replaces a terminal title that would only have said `Terminal 1`, and the
 * panel title moves into the trailing detail beside the provider and model.
 */
function PanelRow({
	now,
	onActivate,
	row,
	serverLabel,
}: {
	now: number;
	onActivate: () => void;
	row: DashboardPanelRow;
	serverLabel?: string;
}) {
	const KindIcon = KIND_ICON[row.panelKind];
	const agent = row.agents[0];
	const extraAgents = row.agents.length - 1;
	const elapsed =
		agent === undefined
			? undefined
			: formatElapsed(agent.stateStartedAt, now);
	// The agent's metadata already carries the terminal's title when it differs
	// from the agent's name, so the panel title is not repeated beside it.
	const detail = agent
		? [
				agent.metadata,
				agent.subagentCount > 0
					? `${agent.subagentCount} subagent${agent.subagentCount === 1 ? '' : 's'}`
					: undefined,
				extraAgents > 0 ? `+${extraAgents} more` : undefined,
				elapsed ? `for ${elapsed}` : undefined,
			]
				.filter(Boolean)
				.join(' · ')
		: undefined;
	return (
		<button
			className="workspace-dashboard__row workspace-dashboard__row--panel"
			data-terminay-dashboard-agent={agent?.entryId}
			data-terminay-dashboard-panel={row.panelId}
			data-terminay-dashboard-status={row.status}
			onClick={onActivate}
			style={{ '--row-color': row.color } as CSSProperties}
			title={[agent?.name ?? row.title, detail, agent?.prompt]
				.filter(Boolean)
				.join('\n')}
			type="button"
		>
			<AgentStatusIndicator
				showIdle
				state={row.status}
				{...(row.isAgentStatus
					? {}
					: { label: `${KIND_LABEL[row.panelKind]} ${row.status}` })}
			/>
			<span className="workspace-dashboard__swatch" aria-hidden="true" />
			<KindIcon
				aria-hidden="true"
				className="workspace-dashboard__kind"
				size={13}
			/>
			<span className="workspace-dashboard__title">
				{row.emoji ? `${row.emoji} ` : ''}
				{agent?.name ?? <PanelRowTitle row={row} />}
				{agent?.unread ? (
					<span
						aria-label="Unread result"
						className="workspace-dashboard__unread"
						role="img"
						title="Unread result"
					/>
				) : null}
			</span>
			{detail ? (
				<span className="workspace-dashboard__row-detail">{detail}</span>
			) : null}
			{serverLabel === undefined ? null : (
				<span className="workspace-dashboard__server">{serverLabel}</span>
			)}
		</button>
	);
}

/* -------------------------------------------------------------------------- */
/* Card views                                                                 */
/* -------------------------------------------------------------------------- */

function AgentCard({
	agent,
	now,
	onActivate,
	project,
	serverLabel,
	showProject,
}: {
	agent: DashboardAgent;
	now: number;
	onActivate: () => void;
	project: DashboardProjectRow;
	serverLabel?: string;
	showProject: boolean;
}) {
	return (
		<button
			className={`workspace-dashboard__card${agent.unread && !agent.external ? ' workspace-dashboard__card--unread' : ''}`}
			aria-disabled={agent.external ? true : undefined}
			data-terminay-dashboard-agent={agent.entryId}
			data-terminay-dashboard-status={agent.state}
			onClick={onActivate}
			style={{ '--row-color': project.color } as CSSProperties}
			type="button"
		>
			<span className="workspace-dashboard__card-head">
				{agent.untracked ? null : (
					<AgentStatusIndicator showIdle size="medium" state={agent.state} />
				)}
				<span className="workspace-dashboard__card-name">{agent.name}</span>
				{agent.external ? (
					<span
						className="workspace-dashboard__external"
						title="Running outside Terminay"
					>
						External
					</span>
				) : null}
				{agent.unread && !agent.external ? (
					<span
						aria-label="Unread result"
						className="workspace-dashboard__unread"
						role="img"
						title="Unread result"
					/>
				) : null}
			</span>
			{showProject ? (
				<ProjectChip project={project} serverLabel={serverLabel} />
			) : null}
			<AgentDetail agent={agent} now={now} />
		</button>
	);
}

function PanelCard({
	onActivate,
	project,
	row,
	serverLabel,
	showProject,
}: {
	onActivate: () => void;
	project: DashboardProjectRow;
	row: DashboardPanelRow;
	serverLabel?: string;
	showProject: boolean;
}) {
	const KindIcon = KIND_ICON[row.panelKind];
	return (
		<button
			className="workspace-dashboard__card"
			data-terminay-dashboard-panel={row.panelId}
			data-terminay-dashboard-status={row.status}
			onClick={onActivate}
			style={{ '--row-color': row.color } as CSSProperties}
			type="button"
		>
			<span className="workspace-dashboard__card-head">
				{row.untracked ? null : (
					<AgentStatusIndicator
						showIdle
						size="medium"
						state={row.status}
						label={`${KIND_LABEL[row.panelKind]} ${row.status}`}
					/>
				)}
				<KindIcon
					aria-hidden="true"
					className="workspace-dashboard__kind"
					size={13}
				/>
				<span className="workspace-dashboard__card-name">
					{row.emoji ? `${row.emoji} ` : ''}
					<PanelRowTitle row={row} />
				</span>
			</span>
			{showProject ? (
				<ProjectChip project={project} serverLabel={serverLabel} />
			) : null}
			<span className="workspace-dashboard__footnotes">
				<span className="workspace-dashboard__state">
					{KIND_LABEL[row.panelKind]} ·{' '}
					{row.untracked ? 'untracked' : row.status}
				</span>
			</span>
		</button>
	);
}

/** A board item is an agent, or the agent-free panel that stood in for one. */
function BoardCard({
	item,
	now,
	onActivateAgent,
	onActivateRow,
	showProject = true,
}: {
	item: DashboardBoardItem;
	now: number;
	onActivateAgent: DashboardActivateAgent;
	onActivateRow: DashboardActivateRow;
	/** False inside a lane, which has already named the project. */
	showProject?: boolean;
}) {
	const { agent, panel, project, serverId } = item;
	const serverLabel = showProject ? item.serverLabel : undefined;
	if (agent !== undefined) {
		return (
			<AgentCard
				agent={agent}
				now={now}
				onActivate={() =>
					onActivateAgent(serverId, project.projectId, agent)
				}
				project={project}
				serverLabel={serverLabel}
				showProject={showProject}
			/>
		);
	}
	if (panel === undefined) return null;
	return (
		<PanelCard
			onActivate={() => onActivateRow(serverId, panel)}
			project={project}
			row={panel}
			serverLabel={serverLabel}
			showProject={showProject}
		/>
	);
}

/**
 * The control that opens and closes the Untracked column. It names the column
 * and how much is in it whether open or not, so a closed column still says
 * what it holds.
 */
function UntrackedToggle({
	className,
	collapsed,
	count,
	onToggle,
}: {
	className?: string;
	collapsed: boolean;
	count: number;
	onToggle: () => void;
}) {
	const Chevron = collapsed ? ChevronRight : ChevronDown;
	return (
		<button
			aria-expanded={!collapsed}
			aria-label={`${DASHBOARD_BOARD_COLUMN_LABELS.untracked}, ${count} tab${count === 1 ? '' : 's'}. ${collapsed ? 'Expand' : 'Collapse'}`}
			className={`workspace-dashboard__untracked-toggle${className ? ` ${className}` : ''}`}
			data-terminay-dashboard-untracked-toggle="true"
			onClick={onToggle}
			title={collapsed ? 'Show untracked tabs' : 'Hide untracked tabs'}
			type="button"
		>
			<Chevron aria-hidden="true" size={13} />
			<span className="workspace-dashboard__column-name">
				{DASHBOARD_BOARD_COLUMN_LABELS.untracked}
			</span>
			<span className="workspace-dashboard__column-count">{count}</span>
		</button>
	);
}

/** How the Board's Untracked column is shown, and how to change it. */
type UntrackedColumnState = Readonly<{
	collapsed: boolean;
	onToggle: () => void;
}>;

function BoardColumn({
	column,
	items,
	now,
	onActivateAgent,
	onActivateRow,
	untracked,
}: {
	column: DashboardBoardColumn;
	items: readonly DashboardBoardItem[];
	now: number;
	onActivateAgent: DashboardActivateAgent;
	onActivateRow: DashboardActivateRow;
	untracked: UntrackedColumnState;
}) {
	const collapsible = column === 'untracked';
	const collapsed = collapsible && untracked.collapsed;
	return (
		<section
			aria-label={DASHBOARD_BOARD_COLUMN_LABELS[column]}
			className={`workspace-dashboard__column workspace-dashboard__column--${column}${collapsed ? ' workspace-dashboard__column--collapsed' : ''}`}
			data-terminay-dashboard-column={column}
			data-terminay-dashboard-column-collapsed={
				collapsible ? String(collapsed) : undefined
			}
		>
			{collapsible ? (
				<header className="workspace-dashboard__column-head">
					<UntrackedToggle
						collapsed={collapsed}
						count={items.length}
						onToggle={untracked.onToggle}
					/>
				</header>
			) : (
				<header className="workspace-dashboard__column-head">
					<span className="workspace-dashboard__column-name">
						{DASHBOARD_BOARD_COLUMN_LABELS[column]}
					</span>
					<span className="workspace-dashboard__column-count">
						{items.length}
					</span>
				</header>
			)}
			{collapsed ? null : (
				<div className="workspace-dashboard__column-body">
					{items.length === 0 ? (
						<p className="workspace-dashboard__column-empty">
							{DASHBOARD_BOARD_COLUMN_EMPTY[column]}
						</p>
					) : (
						items.map((item) => (
							<BoardCard
								item={item}
								key={item.key}
								now={now}
								onActivateAgent={onActivateAgent}
								onActivateRow={onActivateRow}
							/>
						))
					)}
				</div>
			)}
		</section>
	);
}

/**
 * The grouped Board: the same five columns, banded by project. The Untracked
 * column opens and closes in every lane at once.
 *
 * The column names are stated once, above every lane, so a lane is read across
 * rather than re-learned. A narrow window cannot hold four cells side by side,
 * so there each cell names its own column and an empty cell steps aside.
 */
function BoardLanes({
	lanes,
	now,
	onActivateAgent,
	onActivateRow,
	untracked,
}: {
	lanes: readonly DashboardBoardLane[];
	now: number;
	onActivateAgent: DashboardActivateAgent;
	onActivateRow: DashboardActivateRow;
	untracked: UntrackedColumnState;
}) {
	const untrackedCount = lanes.reduce(
		(total, lane) => total + lane.columns.untracked.length,
		0,
	);
	return (
		<div
			className={`workspace-dashboard__lanes${untracked.collapsed ? ' workspace-dashboard__lanes--untracked-collapsed' : ''}`}
			data-terminay-dashboard-board-grouped="true"
		>
			<div className="workspace-dashboard__lanes-head">
				{DASHBOARD_BOARD_COLUMNS.map((column) =>
					column === 'untracked' ? (
						<span
							className="workspace-dashboard__column-head workspace-dashboard__column--untracked"
							key={column}
						>
							<UntrackedToggle
								collapsed={untracked.collapsed}
								count={untrackedCount}
								onToggle={untracked.onToggle}
							/>
						</span>
					) : (
					<span
						className={`workspace-dashboard__column-head workspace-dashboard__column--${column}`}
						key={column}
					>
						<span className="workspace-dashboard__column-name">
							{DASHBOARD_BOARD_COLUMN_LABELS[column]}
						</span>
						<span className="workspace-dashboard__column-count">
							{lanes.reduce(
								(total, lane) => total + lane.columns[column].length,
								0,
							)}
						</span>
					</span>
					),
				)}
			</div>
			{lanes.length === 0 ? (
				<p className="workspace-dashboard__column-empty">
					Nothing is open in any project
				</p>
			) : null}
			{lanes.map((lane) => (
				<section
					aria-label={lane.project.title}
					className="workspace-dashboard__lane"
					data-terminay-dashboard-lane={lane.project.projectId}
					key={lane.key}
					style={{ '--row-color': lane.project.color } as CSSProperties}
				>
					<button
						className="workspace-dashboard__lane-head"
						data-terminay-dashboard-project={lane.project.projectId}
						onClick={() => onActivateRow(lane.serverId, lane.project)}
						type="button"
					>
						<span className="workspace-dashboard__swatch" aria-hidden="true" />
						<span className="workspace-dashboard__title">
							{lane.project.emoji ? `${lane.project.emoji} ` : ''}
							{lane.project.title}
						</span>
						{lane.serverLabel === undefined ? null : (
							<span className="workspace-dashboard__server">
								{lane.serverLabel}
							</span>
						)}
						<span className="workspace-dashboard__column-count">
							{lane.total}
						</span>
					</button>
					<div className="workspace-dashboard__lane-cells">
						{DASHBOARD_BOARD_COLUMNS.map((column) => {
							const items = lane.columns[column];
							if (column === 'untracked') {
								return (
									<div
										className={`workspace-dashboard__lane-cell workspace-dashboard__column--untracked${items.length === 0 ? ' workspace-dashboard__lane-cell--empty' : ''}`}
										data-terminay-dashboard-column={column}
										data-terminay-dashboard-column-collapsed={String(
											untracked.collapsed,
										)}
										key={column}
									>
										{/* Narrow windows drop the shared head, so each lane
										    carries the control for its own cell. */}
										<UntrackedToggle
											className="workspace-dashboard__lane-cell-label"
											collapsed={untracked.collapsed}
											count={items.length}
											onToggle={untracked.onToggle}
										/>
										{untracked.collapsed
											? null
											: items.map((item) => (
													<BoardCard
														item={item}
														key={item.key}
														now={now}
														onActivateAgent={onActivateAgent}
														onActivateRow={onActivateRow}
														showProject={false}
													/>
												))}
									</div>
								);
							}
							return (
								<div
									className={`workspace-dashboard__lane-cell workspace-dashboard__column--${column}${items.length === 0 ? ' workspace-dashboard__lane-cell--empty' : ''}`}
									data-terminay-dashboard-column={column}
									key={column}
								>
									<span className="workspace-dashboard__lane-cell-label workspace-dashboard__column-name">
										{DASHBOARD_BOARD_COLUMN_LABELS[column]}
									</span>
									{items.map((item) => (
										<BoardCard
											item={item}
											key={item.key}
											now={now}
											onActivateAgent={onActivateAgent}
											onActivateRow={onActivateRow}
											showProject={false}
										/>
									))}
								</div>
							);
						})}
					</div>
				</section>
			))}
		</div>
	);
}

function ProjectCard({
	group,
	now,
	onActivateAgent,
	onActivateRow,
	serverId,
	serverLabel,
}: {
	group: DashboardProjectGroup;
	now: number;
	onActivateAgent: DashboardActivateAgent;
	onActivateRow: DashboardActivateRow;
	serverId: string;
	serverLabel?: string;
}) {
	const { counts } = group.project;
	const quiet =
		counts.attention === 0 && counts.working === 0 && counts.done === 0;
	return (
		<section
			className="workspace-dashboard__project-card"
			data-terminay-dashboard-project-card={group.project.projectId}
			style={{ '--row-color': group.project.color } as CSSProperties}
		>
			<button
				className="workspace-dashboard__project-card-head"
				data-terminay-dashboard-project={group.project.projectId}
				onClick={() => onActivateRow(serverId, group.project)}
				type="button"
			>
				<span className="workspace-dashboard__swatch" aria-hidden="true" />
				<span className="workspace-dashboard__title">
					{group.project.emoji ? `${group.project.emoji} ` : ''}
					{group.project.title}
				</span>
				{serverLabel === undefined ? null : (
					<span className="workspace-dashboard__server">{serverLabel}</span>
				)}
				<span className="workspace-dashboard__counts">
					<CountChip
						count={counts.attention}
						label="waiting"
						tone="attention"
					/>
					<CountChip count={counts.working} label="working" tone="working" />
					<CountChip count={counts.done} label="done" tone="done" />
					{quiet ? (
						<span className="workspace-dashboard__count workspace-dashboard__count--quiet">
							{counts.panels === 0
								? 'no tabs'
								: `${counts.panels} ${counts.panels === 1 ? 'tab' : 'tabs'}`}
						</span>
					) : null}
				</span>
			</button>
			<div className="workspace-dashboard__project-card-body">
				{group.panels.length === 0 && group.detachedAgents.length === 0 ? (
					<p className="workspace-dashboard__column-empty">
						Nothing open in this project
					</p>
				) : null}
				{group.panels.map((panel) =>
					panel.agents.length === 0 ? (
						<PanelCard
							key={panel.panelId}
							onActivate={() => onActivateRow(serverId, panel)}
							project={group.project}
							row={panel}
							showProject={false}
						/>
					) : (
						panel.agents.map((agent) => (
							<AgentCard
								agent={agent}
								key={agent.entryId}
								now={now}
								onActivate={() =>
									onActivateAgent(serverId, group.project.projectId, agent)
								}
								project={group.project}
								showProject={false}
							/>
						))
					),
				)}
				{group.detachedAgents.map((agent) => (
					<AgentCard
						agent={agent}
						key={agent.entryId}
						now={now}
						onActivate={() =>
							onActivateAgent(serverId, group.project.projectId, agent)
						}
						project={group.project}
						showProject={false}
					/>
				))}
			</div>
		</section>
	);
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

function SummaryChip({
	count,
	label,
	tone,
}: {
	count: number;
	label: string;
	tone: 'attention' | 'done' | 'idle' | 'untracked' | 'working';
}) {
	return (
		<span
			className={`workspace-dashboard__summary-chip workspace-dashboard__summary-chip--${tone}`}
			data-terminay-dashboard-summary={tone}
		>
			<span className="workspace-dashboard__summary-count">{count}</span>
			<span className="workspace-dashboard__summary-label">{label}</span>
		</span>
	);
}

function ViewModeSwitcher({
	mode,
	onChange,
}: {
	mode: DashboardViewMode;
	onChange: (next: DashboardViewMode) => void;
}) {
	return (
		<div className="workspace-dashboard__modes">
			{DASHBOARD_VIEW_MODES.map((candidate) => {
				const Icon = VIEW_MODE_ICON[candidate];
				const selected = candidate === mode;
				return (
					<button
						aria-label={`${DASHBOARD_VIEW_MODE_LABELS[candidate]} view`}
						aria-pressed={selected}
						className={`workspace-dashboard__mode${selected ? ' workspace-dashboard__mode--selected' : ''}`}
						data-terminay-dashboard-mode={candidate}
						key={candidate}
						onClick={() => onChange(candidate)}
						type="button"
					>
						<Icon aria-hidden="true" size={13} />
						<span>{DASHBOARD_VIEW_MODE_LABELS[candidate]}</span>
					</button>
				);
			})}
		</div>
	);
}

/* -------------------------------------------------------------------------- */

/**
 * Home, over every attached server.
 *
 * Groups are aggregated, never merged: each one keeps the server that owns it,
 * and is named with that server whenever the window has more than one
 * attached. Two servers restored from one data root produce the same project
 * ids, so every key carries the server too.
 */
export function WorkspaceDashboard({
	onActivate,
	onActivateAgent,
	sources,
}: {
	onActivate: DashboardActivateRow;
	onActivateAgent: DashboardActivateAgent;
	sources: readonly DashboardServerSource[];
}) {
	const [mode, setMode] = useState<DashboardViewMode>(recallDashboardViewMode);
	// Transient by design: a filter is what you are doing right now, not a
	// setting. It is never persisted and never leaves this device.
	const [filter, setFilter] = useState('');
	const [boardGrouped, setBoardGrouped] = useState(
		recallDashboardBoardGrouped,
	);
	const [untrackedCollapsed, setUntrackedCollapsed] = useState(
		recallDashboardBoardUntrackedCollapsed,
	);
	const untracked = useMemo<UntrackedColumnState>(
		() => ({
			collapsed: untrackedCollapsed,
			onToggle: () => {
				const next = !untrackedCollapsed;
				setUntrackedCollapsed(next);
				rememberDashboardBoardUntrackedCollapsed(next);
			},
		}),
		[untrackedCollapsed],
	);
	const now = useNow();

	const allGroups = useMemo(
		() => buildCrossServerDashboardGroups(sources),
		[sources],
	);
	const groups = useMemo(
		() => filterDashboardGroups(allGroups, filter),
		[allGroups, filter],
	);
	const summary = useMemo(
		() => summarizeDashboard(allGroups.map((scoped) => scoped.row)),
		[allGroups],
	);
	const namesServers = sources.length > 1;
	const filtering = filter.trim().length > 0;

	const selectMode = (next: DashboardViewMode) => {
		setMode(next);
		rememberDashboardViewMode(next);
	};
	const selectBoardGrouped = (next: boolean) => {
		setBoardGrouped(next);
		rememberDashboardBoardGrouped(next);
	};

	return (
		<section
			aria-label="Dashboard"
			className="workspace-dashboard"
			data-terminay-dashboard="true"
			data-terminay-dashboard-view={mode}
		>
			<header className="workspace-dashboard__header">
				<div className="workspace-dashboard__header-top">
					<div className="workspace-dashboard__heading-box">
						<h1 className="workspace-dashboard__heading">Dashboard</h1>
						<p className="workspace-dashboard__subheading">
							{namesServers
								? 'Every project, tab, and agent on every attached server.'
								: 'Every project, tab, and agent in this workspace.'}
						</p>
					</div>
					<div className="workspace-dashboard__controls">
						<label className="workspace-dashboard__filter">
							<Search aria-hidden="true" size={13} />
							<input
								aria-label="Filter the dashboard"
								className="workspace-dashboard__filter-input"
								data-terminay-dashboard-filter="true"
								onChange={(event) => setFilter(event.target.value)}
								placeholder="Filter projects, tabs, agents…"
								type="search"
								value={filter}
							/>
						</label>
						{mode === 'board' ? (
							<label className="workspace-dashboard__toggle">
								<input
									checked={boardGrouped}
									data-terminay-dashboard-group-by-project="true"
									onChange={(event) => selectBoardGrouped(event.target.checked)}
									type="checkbox"
								/>
								Group by project
							</label>
						) : null}
						<ViewModeSwitcher mode={mode} onChange={selectMode} />
					</div>
				</div>
				<div className="workspace-dashboard__summary">
					<SummaryChip
						count={summary.attention}
						label="need you"
						tone="attention"
					/>
					<SummaryChip count={summary.working} label="working" tone="working" />
					<SummaryChip count={summary.done} label="done" tone="done" />
					<SummaryChip count={summary.idle} label="idle" tone="idle" />
					{summary.untracked > 0 ? (
						<SummaryChip
							count={summary.untracked}
							label="untracked"
							tone="untracked"
						/>
					) : null}
					<span className="workspace-dashboard__summary-projects">
						{summary.projects} project{summary.projects === 1 ? '' : 's'}
					</span>
					{filtering ? (
						<button
							className="workspace-dashboard__clear-filter"
							data-terminay-dashboard-clear-filter="true"
							onClick={() => setFilter('')}
							type="button"
						>
							<X aria-hidden="true" size={12} />
							Filtered by “{filter.trim()}” — clear
						</button>
					) : null}
				</div>
			</header>
			<DashboardBody
				boardGrouped={boardGrouped}
				emptyLabel={
					filtering
						? 'Nothing matches this filter. The workspace is not empty — clear the filter to see it.'
						: 'No projects in this workspace yet.'
				}
				groups={groups}
				mode={mode}
				now={now}
				onActivate={onActivate}
				onActivateAgent={onActivateAgent}
				untracked={untracked}
			/>
		</section>
	);
}

function DashboardBody({
	boardGrouped,
	emptyLabel,
	groups,
	mode,
	now,
	onActivate,
	onActivateAgent,
	untracked,
}: {
	boardGrouped: boolean;
	emptyLabel: string;
	groups: readonly ServerScopedRow<DashboardProjectGroup>[];
	mode: DashboardViewMode;
	now: number;
	onActivate: DashboardActivateRow;
	onActivateAgent: DashboardActivateAgent;
	untracked: UntrackedColumnState;
}): ReactNode {
	const boardColumns = useMemo(
		() =>
			mode === 'board' && !boardGrouped
				? groupBoardItemsByColumn(buildDashboardBoardItems(groups))
				: undefined,
		[boardGrouped, groups, mode],
	);
	const boardLanes = useMemo(
		() =>
			mode === 'board' && boardGrouped
				? buildDashboardBoardLanes(groups)
				: undefined,
		[boardGrouped, groups, mode],
	);
	const rows = useMemo(
		() => (mode === 'list' ? flattenCrossServerDashboardGroups(groups) : []),
		[groups, mode],
	);

	// The Board always shows its columns: an empty column is a true statement
	// about the workspace, and hiding it would make an empty board look broken.
	if (groups.length === 0 && mode !== 'board') {
		return (
			<div className="workspace-dashboard__list">
				<p className="workspace-dashboard__empty">{emptyLabel}</p>
			</div>
		);
	}

	if (boardLanes !== undefined) {
		return (
			<BoardLanes
				lanes={boardLanes}
				now={now}
				onActivateAgent={onActivateAgent}
				onActivateRow={onActivate}
				untracked={untracked}
			/>
		);
	}

	if (mode === 'board' && boardColumns !== undefined) {
		return (
			<div
				className={`workspace-dashboard__board${untracked.collapsed ? ' workspace-dashboard__board--untracked-collapsed' : ''}`}
			>
				{DASHBOARD_BOARD_COLUMNS.map((column) => (
					<BoardColumn
						column={column}
						items={boardColumns[column]}
						key={column}
						now={now}
						onActivateAgent={onActivateAgent}
						onActivateRow={onActivate}
						untracked={untracked}
					/>
				))}
			</div>
		);
	}

	if (mode === 'projects') {
		return (
			<div className="workspace-dashboard__projects">
				{groups.map((scoped) => (
					<ProjectCard
						group={scoped.row}
						key={scoped.key}
						now={now}
						onActivateAgent={onActivateAgent}
						onActivateRow={onActivate}
						serverId={scoped.serverId}
						serverLabel={scoped.serverLabel}
					/>
				))}
			</div>
		);
	}

	return (
		<div className="workspace-dashboard__list">
			{rows.map(({ key, row, serverId, serverLabel }) =>
				row.kind === 'project' ? (
					<ProjectRow
						key={key}
						onActivate={() => onActivate(serverId, row)}
						row={row}
						serverLabel={serverLabel}
					/>
				) : (
					<PanelRow
						key={key}
						now={now}
						onActivate={() => onActivate(serverId, row)}
						row={row}
						serverLabel={serverLabel}
					/>
				),
			)}
		</div>
	);
}

/** A panel row's name. A terminal's follows the terminal's title. */
function PanelRowTitle({ row }: { row: DashboardPanelRow }) {
	return row.panelKind === 'terminal' ? (
		<LiveTerminalTitle panelId={row.panelId} fallback={row.title} />
	) : (
		row.title
	);
}
