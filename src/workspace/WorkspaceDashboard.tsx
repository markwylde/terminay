import { FileText, Folder, TerminalSquare } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import { AgentStatusIndicator } from '../components/AgentStatusIndicator';
import {
	buildCrossServerDashboardRows,
	type DashboardServerSource,
} from './crossServerRows';
import type {
	DashboardPanelRow,
	DashboardProjectRow,
	DashboardRow,
} from './dashboardRows';
import './workspaceDashboard.css';

/**
 * The whole workspace on one screen: every project, every open tab, one line
 * each, nothing wrapped. It answers "what is running and what is waiting on
 * me?" without visiting each project in turn.
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

function ProjectRow({
	onActivate,
	row,
	serverLabel,
}: {
	onActivate: (row: DashboardRow) => void;
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
			onClick={() => onActivate(row)}
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

function PanelRow({
	onActivate,
	row,
	serverLabel,
}: {
	onActivate: (row: DashboardRow) => void;
	row: DashboardPanelRow;
	serverLabel?: string;
}) {
	const KindIcon = KIND_ICON[row.panelKind];
	return (
		<button
			className="workspace-dashboard__row workspace-dashboard__row--panel"
			data-terminay-dashboard-panel={row.panelId}
			data-terminay-dashboard-status={row.status}
			onClick={() => onActivate(row)}
			style={{ '--row-color': row.color } as CSSProperties}
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
				{row.title}
			</span>
			{serverLabel === undefined ? null : (
				<span className="workspace-dashboard__server">{serverLabel}</span>
			)}
		</button>
	);
}

/**
 * Home, over every attached server.
 *
 * Rows are aggregated, never merged: each one keeps the server that owns it,
 * and is named with that server whenever the window has more than one
 * attached. Two servers restored from one data root produce the same project
 * ids, so the row key carries the server too.
 */
export function WorkspaceDashboard({
	onActivate,
	sources,
}: {
	onActivate: (serverId: string, row: DashboardRow) => void;
	sources: readonly DashboardServerSource[];
}) {
	const rows = useMemo(
		() => buildCrossServerDashboardRows(sources),
		[sources],
	);
	const namesServers = sources.length > 1;

	return (
		<section
			aria-label="Dashboard"
			className="workspace-dashboard"
			data-terminay-dashboard="true"
		>
			<header className="workspace-dashboard__header">
				<h1 className="workspace-dashboard__heading">Dashboard</h1>
				<p className="workspace-dashboard__subheading">
					{namesServers
						? 'Every project and tab on every attached server.'
						: 'Every project and tab in this workspace.'}
				</p>
			</header>
			<div className="workspace-dashboard__list">
				{rows.length === 0 ? (
					<p className="workspace-dashboard__empty">
						No projects in this workspace yet.
					</p>
				) : (
					rows.map(({ key, row, serverId, serverLabel }) =>
						row.kind === 'project' ? (
							<ProjectRow
								key={key}
								onActivate={(activated) => onActivate(serverId, activated)}
								row={row}
								serverLabel={serverLabel}
							/>
						) : (
							<PanelRow
								key={key}
								onActivate={(activated) => onActivate(serverId, activated)}
								row={row}
								serverLabel={serverLabel}
							/>
						),
					)
				)}
			</div>
		</section>
	);
}
