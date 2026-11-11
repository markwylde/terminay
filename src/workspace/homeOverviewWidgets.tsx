/**
 * The Home overview's widgets, one component each.
 *
 * Renderers only: every number and every order comes from `homeOverviewModel`
 * and `homeOverviewItems`. A widget decides how an item reads and which
 * callback activating it calls; where that leads is the caller's business.
 */

import type { RecordingListItem } from '@terminay/client-core';
import {
	AlarmClock,
	Bot,
	CalendarClock,
	CirclePlay,
	Command,
	FolderPlus,
	GitPullRequest,
	GitPullRequestDraft,
	Settings,
	Smartphone,
	Workflow,
	X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { TerminalActivityOverviewItem } from './activityStates';
import { terminalOverviewStateToAgentState } from './activityStates';
import { BotAvatar } from './bots/BotAvatar';
import type { DashboardAgent } from './dashboardRows';
import type { HomeAttentionItem, HomeWorkflowItem } from './homeOverviewItems';
import {
	HOME_OVERVIEW_AGENT_GROUP_LABELS,
	HOME_OVERVIEW_AGENT_GROUPS,
	type HomeOverview,
	type HomeOverviewRunOutcome,
} from './homeOverviewModel';
import { notificationHeadline } from './notificationText';
import { formatDuration } from './workflows/workflowPanelModel';

/** What activating an automation widget asks the Automations section to show. */
export type HomeOverviewAutomationTarget =
	| Readonly<{ kind: 'list' }>
	| Readonly<{ kind: 'create' }>
	| Readonly<{ kind: 'automation'; serverId: string; automationId: string }>
	| Readonly<{
			kind: 'run';
			serverId: string;
			automationId: string;
			runId: string;
	  }>;

export type HomeQuickActions = Readonly<{
	onNewProject: () => void;
	onNewBot: () => void;
	onNewAutomation: () => void;
	onOpenCommandBar: () => void;
	onOpenSettings: () => void;
	shortcuts?: Readonly<{
		newProject?: string;
		commandBar?: string;
		settings?: string;
	}>;
}>;

export type HomeRecordingsState =
	| Readonly<{ state: 'loading' }>
	| Readonly<{ state: 'unsupported'; serverLabel?: string }>
	| Readonly<{ state: 'error' }>
	| Readonly<{ state: 'ready'; items: readonly RecordingListItem[] }>;

/** Every callback a widget may call. */
export type HomeWidgetActions = Readonly<{
	onOpenTabs: () => void;
	onOpenAutomations: (target: HomeOverviewAutomationTarget) => void;
	onActivatePanel: (
		serverId: string,
		projectId: string,
		panelId: string,
		sessionId?: string,
	) => void;
	onActivateAgent: (
		serverId: string,
		projectId: string,
		agent: DashboardAgent,
	) => void;
	onOpenBot: (serverId: string, botId: string) => void;
	onActivateNotification: (item: TerminalActivityOverviewItem) => void;
	onDismissNotification: (item: TerminalActivityOverviewItem) => void;
	onDismissAllNotifications: () => void;
	onOpenRecording: (recordingId: string) => void;
	quickActions: HomeQuickActions;
}>;

export type HomeWidgetProps = Readonly<{
	overview: HomeOverview;
	actions: HomeWidgetActions;
	recordings: HomeRecordingsState;
	now: number;
}>;

export const OUTCOME_LABELS: Record<HomeOverviewRunOutcome, string> = {
	cancelled: 'Cancelled',
	failure: 'Failed',
	running: 'Running',
	skipped: 'Skipped',
	success: 'Succeeded',
	'timed-out': 'Timed out',
};

export function plural(
	count: number,
	singular: string,
	pluralForm = `${singular}s`,
) {
	return count === 1 ? singular : pluralForm;
}

export function formatTime(at: number, now: number): string {
	const date = new Date(at);
	const sameDay = new Date(now).toDateString() === date.toDateString();
	const time = date.toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit',
	});
	return sameDay
		? time
		: `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function serverSuffix(item: { serverLabel?: string }): string {
	return item.serverLabel === undefined ? '' : ` · ${item.serverLabel}`;
}

/** One activatable row. */
function Row({
	children,
	onActivate,
	className = '',
	...data
}: Readonly<{
	children: ReactNode;
	onActivate?: () => void;
	className?: string;
	[key: `data-${string}`]: string | undefined;
}>) {
	return onActivate === undefined ? (
		<div className={`home-widget__row ${className}`} {...data}>
			{children}
		</div>
	) : (
		<button
			type="button"
			className={`home-widget__row home-widget__row--action ${className}`}
			onClick={onActivate}
			{...data}
		>
			{children}
		</button>
	);
}

function Text({ title, sub }: Readonly<{ title: ReactNode; sub?: ReactNode }>) {
	return (
		<span className="home-widget__row-text">
			<span className="home-widget__row-title">{title}</span>
			{sub === undefined ? null : (
				<span className="home-widget__row-sub">{sub}</span>
			)}
		</span>
	);
}

function Empty({ children }: Readonly<{ children: ReactNode }>) {
	return <p className="home-widget__empty">{children}</p>;
}

// --- Dials and bars ---------------------------------------------------------

const DIAL_TONE_COLOUR = {
	alert: 'var(--home-needs)',
	done: 'var(--home-done)',
	idle: 'var(--home-idle)',
	running: 'var(--home-working)',
} as const;

export function WorkflowRing({
	workflow,
	size = 30,
}: Readonly<{ workflow: HomeWorkflowItem; size?: number }>) {
	const stroke = Math.max(3, Math.round(size / 8));
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const filled =
		Math.min(1, Math.max(0, workflow.summary.fraction)) * circumference;
	return (
		<svg
			className="home-workflow__ring"
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			role="img"
			aria-label={workflow.summary.label}
		>
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="var(--home-track)"
				strokeWidth={stroke}
			/>
			{filled > 0 ? (
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke={DIAL_TONE_COLOUR[workflow.summary.tone]}
					strokeWidth={stroke}
					strokeLinecap="round"
					strokeDasharray={`${filled} ${circumference}`}
					transform={`rotate(-90 ${size / 2} ${size / 2})`}
				/>
			) : null}
		</svg>
	);
}

function StepBar({ workflow }: Readonly<{ workflow: HomeWorkflowItem }>) {
	if (workflow.steps.length === 0) return null;
	return (
		<span className="home-workflow__steps" aria-hidden="true">
			{workflow.steps.map((status, index) => (
				<i
					// Steps have no stable id here; their order is their identity.
					key={index}
					className={`home-workflow__step home-workflow__step--${status}`}
				/>
			))}
		</span>
	);
}

function workflowMeta(workflow: HomeWorkflowItem, now: number): string {
	const parts: string[] = [];
	if (workflow.summary.total > 0)
		parts.push(`${workflow.summary.done} of ${workflow.summary.total}`);
	if (workflow.currentStartedAt !== undefined)
		parts.push(formatDuration(Math.max(0, now - workflow.currentStartedAt)));
	else if (workflow.finishedAt !== undefined)
		parts.push(formatTime(workflow.finishedAt, now));
	return parts.join(' · ');
}

function workflowHeadline(workflow: HomeWorkflowItem): ReactNode {
	if (workflow.name === undefined) return 'Workflow could not be restored';
	if (workflow.rank === 'finished')
		return <b>All {workflow.summary.total} steps done</b>;
	const current = workflow.current;
	if (current === undefined) return <b>{workflow.name}</b>;
	const verb =
		current.status === 'needs_input'
			? ' needs you'
			: current.status === 'failed'
				? ' failed'
				: current.status === 'not_started'
					? ' is next'
					: '';
	return (
		<>
			<b>{current.title}</b>
			{verb}
		</>
	);
}

// --- Widgets ----------------------------------------------------------------

export function QuickActionsWidget({ actions }: HomeWidgetProps) {
	const quick = actions.quickActions;
	const items: readonly [
		string,
		ReactNode,
		string,
		() => void,
		string | undefined,
	][] = [
		[
			'new-project',
			<FolderPlus key="i" size={16} />,
			'New project',
			quick.onNewProject,
			quick.shortcuts?.newProject,
		],
		[
			'new-bot',
			<Bot key="i" size={16} />,
			'New bot',
			quick.onNewBot,
			undefined,
		],
		[
			'new-automation',
			<Workflow key="i" size={16} />,
			'New automation',
			quick.onNewAutomation,
			undefined,
		],
		[
			'command-bar',
			<Command key="i" size={16} />,
			'Command Bar',
			quick.onOpenCommandBar,
			quick.shortcuts?.commandBar,
		],
		[
			'settings',
			<Settings key="i" size={16} />,
			'Settings',
			quick.onOpenSettings,
			quick.shortcuts?.settings,
		],
	];
	return (
		<div className="home-quick">
			{items.map(([id, icon, label, onSelect, shortcut]) => (
				<button
					key={id}
					type="button"
					className="home-quick__action"
					data-terminay-home-quick-action={id}
					onClick={onSelect}
				>
					<span className="home-quick__icon" aria-hidden="true">
						{icon}
					</span>
					<span className="home-quick__label">{label}</span>
					{shortcut ? <kbd className="home-quick__kbd">{shortcut}</kbd> : null}
				</button>
			))}
		</div>
	);
}

const ATTENTION_KIND_LABEL: Record<HomeAttentionItem['kind'], string> = {
	agent: 'Agent',
	bot: 'Bot',
	workflow: 'Workflow',
};

export function NeedsYouWidget({ overview, actions, now }: HomeWidgetProps) {
	const items = overview.attention.items;
	if (items.length === 0) return <Empty>Nothing needs you right now.</Empty>;
	return (
		<ul className="home-widget__list home-attention">
			{items.map((item) => (
				<li key={item.key}>
					<Row
						className="home-attention__item"
						data-terminay-home-attention={item.kind}
						onActivate={() => {
							if (item.kind === 'agent')
								actions.onActivateAgent(
									item.serverId,
									item.projectId,
									item.agent,
								);
							else if (item.kind === 'bot')
								actions.onOpenBot(item.serverId, item.bot.id);
							else
								actions.onActivatePanel(
									item.serverId,
									item.workflow.projectId,
									item.workflow.panelId,
									item.workflow.sessionId,
								);
						}}
					>
						<span className="home-attention__kind">
							{ATTENTION_KIND_LABEL[item.kind]}
						</span>
						{item.kind === 'bot' ? (
							<BotAvatar bot={item.bot} size="sm" />
						) : item.kind === 'workflow' ? (
							<WorkflowRing workflow={item.workflow} size={20} />
						) : (
							<span className="home-dot home-dot--needs" aria-hidden="true" />
						)}
						{item.kind === 'agent' ? (
							<Text
								title={
									<>
										<b>{item.agent.name}</b>{' '}
										{item.agent.waitingReason ?? 'is waiting for you'}
									</>
								}
								sub={`${item.projectTitle}${serverSuffix(item)}`}
							/>
						) : item.kind === 'bot' ? (
							<Text
								title={
									<>
										<b>{item.bot.name}</b> · {item.summary}
									</>
								}
								sub={`Bot session${serverSuffix(item)}`}
							/>
						) : (
							<Text
								title={workflowHeadline(item.workflow)}
								sub={`${item.workflow.projectTitle} › ${item.workflow.terminalTitle}`}
							/>
						)}
						<span className="home-widget__row-meta">
							{formatDuration(Math.max(0, now - item.since))}
						</span>
					</Row>
				</li>
			))}
		</ul>
	);
}

export function AgentsWidget({ overview, actions }: HomeWidgetProps) {
	const { agents } = overview;
	const size = 88;
	const stroke = 10;
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const gap = agents.total > 1 ? 3 : 0;
	let offset = 0;
	const segments = HOME_OVERVIEW_AGENT_GROUPS.filter(
		(group) => agents[group] > 0,
	).map((group) => {
		const length = (agents[group] / agents.total) * circumference;
		const segment = (
			<circle
				key={group}
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				className={`home-agents__segment home-agents__segment--${group}`}
				strokeWidth={stroke}
				strokeDasharray={`${Math.max(0, length - gap)} ${circumference}`}
				strokeDashoffset={-offset}
				transform={`rotate(-90 ${size / 2} ${size / 2})`}
			/>
		);
		offset += length;
		return segment;
	});
	return (
		<button
			type="button"
			className="home-agents"
			onClick={actions.onOpenTabs}
			aria-label={`Agents: ${HOME_OVERVIEW_AGENT_GROUPS.map((group) => `${agents[group]} ${HOME_OVERVIEW_AGENT_GROUP_LABELS[group]}`).join(', ')}`}
		>
			<svg
				width={size}
				height={size}
				viewBox={`0 0 ${size} ${size}`}
				aria-hidden="true"
			>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke="var(--home-track)"
					strokeWidth={stroke}
				/>
				{segments}
				<text
					x={size / 2}
					y={size / 2 - 1}
					textAnchor="middle"
					className="home-agents__total"
				>
					{agents.total}
				</text>
				<text
					x={size / 2}
					y={size / 2 + 14}
					textAnchor="middle"
					className="home-agents__caption"
				>
					{plural(agents.total, 'agent')}
				</text>
			</svg>
			<span className="home-agents__legend">
				{HOME_OVERVIEW_AGENT_GROUPS.map((group) => (
					<span
						key={group}
						className={`home-agents__group home-widget__count--${group}`}
						data-terminay-home-agent-group={group}
					>
						<span
							className={`home-dot home-dot--${group}`}
							aria-hidden="true"
						/>
						<span className="home-widget__unit">
							{HOME_OVERVIEW_AGENT_GROUP_LABELS[group]}
						</span>
						<span className="home-widget__number">{agents[group]}</span>
					</span>
				))}
			</span>
		</button>
	);
}

export function WorkflowsWidget({ overview, actions, now }: HomeWidgetProps) {
	const items = overview.workflows.items;
	if (items.length === 0) return <Empty>No terminal has a workflow.</Empty>;
	return (
		<ul className="home-widget__list">
			{items.map((workflow) => (
				<li key={workflow.key}>
					<Row
						className="home-workflow"
						data-terminay-home-workflow={workflow.sessionId}
						data-terminay-home-workflow-rank={workflow.rank}
						onActivate={() =>
							actions.onActivatePanel(
								workflow.serverId,
								workflow.projectId,
								workflow.panelId,
								workflow.sessionId,
							)
						}
					>
						<WorkflowRing workflow={workflow} />
						<span className="home-widget__row-text">
							<span className="home-widget__row-title">
								{workflowHeadline(workflow)}
								<span className="home-widget__row-sub-inline">
									{' '}
									· {workflow.name ?? workflow.terminalTitle}
								</span>
							</span>
							<StepBar workflow={workflow} />
						</span>
						<span className="home-widget__row-meta">
							{workflowMeta(workflow, now)}
						</span>
					</Row>
				</li>
			))}
		</ul>
	);
}

const BOT_ACTIVITY_LABEL = {
	idle: 'Idle',
	'needs-you': 'Needs you',
	queued: 'Queued',
	stopped: 'Stopped',
	working: 'Working',
} as const;

const BOT_ENVIRONMENT_LABEL = {
	'not-created': 'Not created',
	building: 'Building image',
	starting: 'Starting',
	running: 'Running',
	stopping: 'Stopping',
	stopped: 'Stopped',
	failed: 'Failed',
	unknown: 'Unknown',
} as const;

export function BotsWidget({ overview, actions, now }: HomeWidgetProps) {
	const { items, nextTrigger } = overview.bots;
	if (items.length === 0)
		return (
			<div className="home-widget__stack">
				<Empty>No bots yet.</Empty>
				<button
					type="button"
					className="home-widget__link"
					onClick={actions.quickActions.onNewBot}
				>
					Create a bot
				</button>
			</div>
		);
	return (
		<div className="home-widget__stack">
			<ul className="home-widget__list home-bots">
				{items.map((item) => (
					<li key={item.key}>
						<Row
							data-terminay-home-bot={item.bot.id}
							onActivate={() => actions.onOpenBot(item.serverId, item.bot.id)}
						>
							<span className="home-bots__avatar">
								<BotAvatar bot={item.bot} activity={item.activity} />
							</span>
							<Text
								title={<b>{item.bot.name}</b>}
								sub={`${BOT_ACTIVITY_LABEL[item.activity]} · ${BOT_ENVIRONMENT_LABEL[item.environment]}${serverSuffix(item)}`}
							/>
							{item.needsYou > 0 ? (
								<span
									className="home-pill home-pill--needs"
									title={`${item.needsYou} waiting on you`}
								>
									{item.needsYou}
									<span className="home-sr-only"> waiting on you</span>
								</span>
							) : null}
						</Row>
					</li>
				))}
			</ul>
			{nextTrigger === undefined ? null : (
				<Row
					className="home-widget__footer-row"
					onActivate={() =>
						actions.onOpenBot(nextTrigger.serverId, nextTrigger.bot.id)
					}
				>
					<AlarmClock
						size={13}
						aria-hidden="true"
						className="home-widget__icon"
					/>
					<Text
						title={
							<>
								Next: <b>{nextTrigger.nextTrigger.name}</b> ·{' '}
								{nextTrigger.bot.name}
							</>
						}
					/>
					<span className="home-widget__row-meta">
						{formatTime(nextTrigger.nextTrigger.at, now)}
					</span>
				</Row>
			)}
		</div>
	);
}

const SESSION_TONE: Record<string, string> = {
	completed: 'done',
	failed: 'failed',
	'timed-out': 'failed',
	interrupted: 'failed',
	running: 'working',
	queued: 'idle',
	suspended: 'idle',
	stopped: 'idle',
	'needs-you': 'needs',
};

const SESSION_LABEL: Record<string, string> = {
	completed: 'Done',
	failed: 'Failed',
	'timed-out': 'Timed out',
	interrupted: 'Interrupted',
	running: 'Running',
	queued: 'Queued',
	suspended: 'Suspended',
	stopped: 'Stopped',
	'needs-you': 'Needs you',
};

export function BotSessionsWidget({ overview, actions, now }: HomeWidgetProps) {
	const items = overview.botSessions;
	if (items.length === 0) return <Empty>No bot sessions yet.</Empty>;
	return (
		<ul className="home-widget__list">
			{items.map((item) => (
				<li key={item.key}>
					<Row
						data-terminay-home-bot-session={item.sessionId}
						onActivate={() => actions.onOpenBot(item.serverId, item.botId)}
					>
						<span
							className={`home-pill home-pill--${item.needsYou ? 'needs' : (SESSION_TONE[item.state] ?? 'idle')}`}
						>
							{item.needsYou
								? 'Needs you'
								: (SESSION_LABEL[item.state] ?? item.state)}
						</span>
						<Text
							title={item.title}
							sub={`${item.botName}${serverSuffix(item)}`}
						/>
						<span className="home-widget__row-meta">
							{formatTime(item.startedAt, now)}
						</span>
					</Row>
				</li>
			))}
		</ul>
	);
}

export function AutomationsWidget({ overview, actions, now }: HomeWidgetProps) {
	const { automations } = overview;
	if (automations.isEmpty)
		return (
			<span className="home-widget__stack">
				<Empty>No automations yet.</Empty>
				<button
					type="button"
					className="home-widget__link"
					data-terminay-home-create-automation="true"
					onClick={() => actions.onOpenAutomations({ kind: 'create' })}
				>
					Create an automation
				</button>
			</span>
		);
	return (
		<div className="home-widget__stack">
			<button
				type="button"
				className="home-widget__headline"
				onClick={() => actions.onOpenAutomations({ kind: 'list' })}
			>
				<span className="home-widget__number">{automations.active.length}</span>
				<span className="home-widget__unit">active</span>
			</button>
			{automations.active.length === 0 ? (
				<Empty>No automation is enabled.</Empty>
			) : (
				<ul className="home-widget__list">
					{automations.active.slice(0, 3).map((automation, index) => (
						<li key={`${automation.serverId}:${automation.automationId}`}>
							<Row
								{...(index === 0 &&
								automations.nextRun?.automationId === automation.automationId
									? { 'data-terminay-home-next-run': 'true' }
									: {})}
								onActivate={() =>
									actions.onOpenAutomations({
										kind: 'automation',
										serverId: automation.serverId,
										automationId: automation.automationId,
									})
								}
							>
								<CalendarClock
									size={13}
									aria-hidden="true"
									className="home-widget__icon"
								/>
								<Text
									title={
										index === 0 && automation.nextRunAt !== undefined ? (
											<>
												Next: <b>{automation.name}</b>
												{serverSuffix(automation)}
											</>
										) : (
											`${automation.name}${serverSuffix(automation)}`
										)
									}
								/>
								<span className="home-widget__row-meta">
									{automation.nextRunAt === undefined
										? 'On event'
										: formatTime(automation.nextRunAt, now)}
								</span>
							</Row>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

const OUTCOME_TONE: Record<HomeOverviewRunOutcome, string> = {
	cancelled: 'idle',
	failure: 'failed',
	running: 'working',
	skipped: 'idle',
	success: 'done',
	'timed-out': 'failed',
};

export function RunHistoryWidget({ overview, actions, now }: HomeWidgetProps) {
	const { history, recentRuns } = overview.automations;
	if (history.runs.length === 0) return <Empty>No runs yet.</Empty>;
	const open = (run: (typeof recentRuns)[number]) =>
		actions.onOpenAutomations({
			kind: 'run',
			serverId: run.serverId,
			automationId: run.automationId,
			runId: run.runId,
		});
	// Oldest on the left, so the strip reads like a timeline.
	const strip = [...history.runs].reverse();
	const others = [
		history.failed > 0 ? `${history.failed} failed` : undefined,
		history.skipped > 0 ? `${history.skipped} skipped` : undefined,
		history.cancelled > 0 ? `${history.cancelled} cancelled` : undefined,
		history.running > 0 ? `${history.running} running` : undefined,
	].filter((part) => part !== undefined);
	return (
		<div className="home-widget__stack">
			<div className="home-runs__kpis">
				{history.successRate === undefined ? null : (
					<span className="home-widget__headline" data-terminay-home-run-rate>
						<span className="home-widget__number home-widget__number--big">
							{Math.round(history.successRate * 100)}%
						</span>
						<span className="home-widget__unit">succeeded</span>
					</span>
				)}
				{others.length === 0 ? null : (
					<span className="home-widget__note">{others.join(' · ')}</span>
				)}
			</div>
			<ul className="home-runs__strip" aria-label="Recent runs">
				{strip.map((run) => (
					<li key={`${run.serverId}:${run.runId}`}>
						<button
							type="button"
							className={`home-runs__mark home-runs__mark--${OUTCOME_TONE[run.outcome]}`}
							title={`${run.automationName} · ${OUTCOME_LABELS[run.outcome]} · ${formatTime(run.startedAt, now)}`}
							aria-label={`${run.automationName}, ${OUTCOME_LABELS[run.outcome]}, ${formatTime(run.startedAt, now)}`}
							onClick={() => open(run)}
						/>
					</li>
				))}
			</ul>
			<ul className="home-widget__list">
				{recentRuns.slice(0, 3).map((run) => (
					<li key={`${run.serverId}:${run.runId}`}>
						<Row
							data-terminay-home-run={run.runId}
							data-terminay-home-run-outcome={run.outcome}
							onActivate={() => open(run)}
						>
							<span
								className={`home-pill home-pill--${OUTCOME_TONE[run.outcome]}`}
							>
								{OUTCOME_LABELS[run.outcome]}
							</span>
							<Text title={`${run.automationName}${serverSuffix(run)}`} />
							<span className="home-widget__row-meta">
								{formatTime(run.startedAt, now)}
							</span>
						</Row>
					</li>
				))}
			</ul>
		</div>
	);
}

export function PullRequestsWidget({ overview, actions }: HomeWidgetProps) {
	const items = overview.pullRequests.items;
	if (items.length === 0) return <Empty>No open pull requests.</Empty>;
	return (
		<ul className="home-widget__list">
			{items.map((item) => {
				const checks = item.checks;
				const failing = (checks?.failed ?? 0) > 0;
				const Icon = item.draft ? GitPullRequestDraft : GitPullRequest;
				return (
					<li key={item.key}>
						<Row
							data-terminay-home-pull-request={String(item.number)}
							onActivate={() =>
								actions.onActivatePanel(
									item.serverId,
									item.projectId,
									item.panelId,
								)
							}
						>
							<Icon
								size={14}
								aria-hidden="true"
								className={`home-pr__icon home-pr__icon--${failing ? 'failed' : item.draft ? 'draft' : 'open'}`}
							/>
							<Text
								title={
									<>
										<b>#{item.number}</b> {item.title}
										{item.draft ? (
											<span className="home-pill home-pill--idle">Draft</span>
										) : null}
									</>
								}
								sub={`${item.projectTitle} › ${item.panelTitle}${serverSuffix(item)}`}
							/>
							{checks === undefined ? (
								<span className="home-widget__row-meta">No checks</span>
							) : (
								<>
									<span
										className="home-pr__checks"
										aria-hidden="true"
										title={`${checks.passed} passed · ${checks.failed} failed · ${checks.pending} pending`}
									>
										{checks.passed > 0 ? (
											<i
												className="home-pr__check--done"
												style={{ flex: checks.passed }}
											/>
										) : null}
										{checks.failed > 0 ? (
											<i
												className="home-pr__check--failed"
												style={{ flex: checks.failed }}
											/>
										) : null}
										{checks.pending > 0 ? (
											<i
												className="home-pr__check--working"
												style={{ flex: checks.pending }}
											/>
										) : null}
										{checks.skipped > 0 ? (
											<i
												className="home-pr__check--idle"
												style={{ flex: checks.skipped }}
											/>
										) : null}
									</span>
									<span
										className={`home-widget__row-meta${failing ? ' home-widget__row-meta--failed' : ''}`}
									>
										{failing
											? `${checks.failed} failed`
											: checks.pending > 0
												? `${checks.passed}/${checks.total} · ${checks.pending} pending`
												: `${checks.passed}/${checks.total} passed`}
									</span>
								</>
							)}
						</Row>
					</li>
				);
			})}
		</ul>
	);
}

export function NotificationsWidget({
	overview,
	actions,
	now,
}: HomeWidgetProps) {
	const items = overview.notifications;
	if (items.length === 0) return <Empty>No notifications.</Empty>;
	return (
		<div className="home-widget__stack">
			<ul className="home-widget__list">
				{items.slice(0, 5).map((item) => {
					const state = terminalOverviewStateToAgentState(item.state);
					const tone =
						state === 'blocked' || state === 'waiting'
							? 'needs'
							: state === 'working'
								? 'working'
								: 'done';
					const headline =
						item.sent?.title ??
						item.sent?.body ??
						// The list holds no working terminal; a stale one reads as finished.
						notificationHeadline(
							state === 'working' ? 'done' : state,
							item.isAgentStatus,
						);
					return (
						<li
							key={`${item.projectId}:${item.panelId}:${item.notificationId ?? ''}`}
							className="home-notification"
						>
							<Row
								data-terminay-home-notification={item.panelId}
								onActivate={() => actions.onActivateNotification(item)}
							>
								<span
									className={`home-dot home-dot--${tone}`}
									aria-hidden="true"
								/>
								<Text
									title={headline}
									sub={`${item.serverUpgrade === undefined ? `${item.projectTitle} › ${item.title}` : item.title}${item.since === undefined ? '' : ` · ${formatTime(item.since, now)}`}`}
								/>
							</Row>
							<button
								type="button"
								className="home-widget__icon-button"
								aria-label={`Dismiss ${headline}`}
								data-terminay-home-dismiss-notification={item.panelId}
								onClick={() => actions.onDismissNotification(item)}
							>
								<X size={13} aria-hidden="true" />
							</button>
						</li>
					);
				})}
			</ul>
			<button
				type="button"
				className="home-widget__link home-widget__footer-link"
				onClick={actions.onDismissAllNotifications}
			>
				Clear all
			</button>
		</div>
	);
}

export function ProjectsWidget({ overview, actions }: HomeWidgetProps) {
	const { projects, projectItems } = overview;
	return (
		<div className="home-widget__stack">
			<button
				type="button"
				className="home-widget__headline"
				onClick={actions.onOpenTabs}
			>
				<span
					className="home-widget__number"
					data-terminay-home-count={plural(projects.value, 'project')}
				>
					{projects.value}
				</span>
				<span className="home-widget__unit">
					{plural(projects.value, 'project')}
				</span>
			</button>
			<ul className="home-widget__list">
				{projectItems.slice(0, 6).map((item) => (
					<li key={item.key}>
						<Row onActivate={actions.onOpenTabs}>
							<span
								className="home-project__chip"
								style={{ ['--home-project-colour' as string]: item.color }}
								aria-hidden="true"
							>
								{item.emoji || item.title.slice(0, 1).toUpperCase()}
							</span>
							<Text
								title={<b>{item.title}</b>}
								sub={
									item.tabs === undefined
										? (item.serverLabel ?? 'Tabs not counted here')
										: `${item.tabs} ${plural(item.tabs, 'tab')} · ${item.terminals} ${plural(item.terminals ?? 0, 'terminal')}${serverSuffix(item)}`
								}
							/>
							<span className="home-project__counts">
								{item.counts.attention > 0 ? (
									<span title={`${item.counts.attention} need you`}>
										<span
											className="home-dot home-dot--needs"
											aria-hidden="true"
										/>
										{item.counts.attention}
										<span className="home-sr-only"> need you</span>
									</span>
								) : null}
								{item.counts.working > 0 ? (
									<span title={`${item.counts.working} working`}>
										<span
											className="home-dot home-dot--working"
											aria-hidden="true"
										/>
										{item.counts.working}
										<span className="home-sr-only"> working</span>
									</span>
								) : null}
								{item.counts.done > 0 ? (
									<span title={`${item.counts.done} done`}>
										<span
											className="home-dot home-dot--done"
											aria-hidden="true"
										/>
										{item.counts.done}
										<span className="home-sr-only"> done</span>
									</span>
								) : null}
							</span>
						</Row>
					</li>
				))}
			</ul>
		</div>
	);
}

export function TabsWidget({ overview, actions }: HomeWidgetProps) {
	const { tabs, terminals } = overview;
	return (
		<button
			type="button"
			className="home-widget__headline home-widget__headline--pair"
			onClick={actions.onOpenTabs}
		>
			<span className="home-widget__count">
				<span
					className="home-widget__number home-widget__number--big"
					data-terminay-home-count={plural(tabs.value, 'tab')}
				>
					{tabs.value}
				</span>
				<span className="home-widget__unit">{plural(tabs.value, 'tab')}</span>
			</span>
			<span className="home-widget__count">
				<span
					className="home-widget__number home-widget__number--big"
					data-terminay-home-count={plural(terminals.value, 'terminal')}
				>
					{terminals.value}
				</span>
				<span className="home-widget__unit">
					{plural(terminals.value, 'terminal')}
				</span>
			</span>
		</button>
	);
}

export function ConnectionsWidget({ overview }: HomeWidgetProps) {
	const { connections } = overview;
	const devices = connections.devices;
	return (
		<div className="home-widget__stack">
			<span className="home-widget__headline">
				<span className="home-widget__number">{connections.available}</span>
				<span className="home-widget__unit">
					of {connections.attached} {plural(connections.attached, 'server')}{' '}
					connected
				</span>
			</span>
			<Row>
				<Smartphone
					size={13}
					aria-hidden="true"
					className="home-widget__icon"
				/>
				<Text
					title={
						devices.state === 'on'
							? `${devices.connected} of ${devices.paired} paired ${plural(devices.paired, 'device')} connected`
							: devices.state === 'off'
								? 'Remote access is off'
								: 'Remote access status unavailable'
					}
				/>
			</Row>
		</div>
	);
}

export function RecordingsWidget({ recordings, actions }: HomeWidgetProps) {
	if (recordings.state === 'loading') return <Empty>Loading recordings…</Empty>;
	if (recordings.state === 'unsupported')
		return (
			<Empty>
				Recordings are unavailable
				{recordings.serverLabel === undefined
					? ''
					: ` on ${recordings.serverLabel}`}
				.
			</Empty>
		);
	if (recordings.state === 'error')
		return <Empty>Recordings could not be read.</Empty>;
	if (recordings.items.length === 0) return <Empty>No recordings yet.</Empty>;
	const now = Date.now();
	return (
		<ul className="home-widget__list">
			{recordings.items.map((item) => (
				<li key={item.recordingId}>
					<Row
						data-terminay-home-recording={item.recordingId}
						onActivate={() => actions.onOpenRecording(item.recordingId)}
					>
						<CirclePlay
							size={14}
							aria-hidden="true"
							className="home-widget__icon"
						/>
						<Text
							title={item.title || 'Untitled recording'}
							sub={[
								item.projectName,
								item.durationMs === null
									? undefined
									: formatDuration(item.durationMs),
							]
								.filter((part) => part !== null && part !== undefined)
								.join(' · ')}
						/>
						<span className="home-widget__row-meta">
							{formatTime(Date.parse(item.startedAt), now)}
						</span>
					</Row>
				</li>
			))}
		</ul>
	);
}
