/**
 * Home's overview section: the workspace in a handful of widgets.
 *
 * A renderer over `homeOverviewModel`. Every number comes from there, so this
 * file decides only how a count reads and where activating a widget goes: the
 * project and agent widgets to Tabs, which holds their detail, and the
 * automation widgets to Automations.
 */

import {
	CalendarClock,
	FolderKanban,
	History,
	PanelsTopLeft,
	Radio,
	Sparkles,
	Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
	HOME_OVERVIEW_AGENT_GROUP_LABELS,
	HOME_OVERVIEW_AGENT_GROUPS,
	type HomeOverview as HomeOverviewModel,
	type HomeOverviewCount,
	type HomeOverviewRunOutcome,
	type HomeOverviewServerRef,
} from './homeOverviewModel.ts';

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

export type HomeOverviewProps = Readonly<{
	overview: HomeOverviewModel;
	onOpenTabs: () => void;
	onOpenAutomations: (target: HomeOverviewAutomationTarget) => void;
	/** Epoch ms used to phrase times relative to now. */
	now?: number;
}>;

const OUTCOME_LABELS: Record<HomeOverviewRunOutcome, string> = {
	cancelled: 'Cancelled',
	failure: 'Failed',
	running: 'Running',
	skipped: 'Skipped',
	success: 'Succeeded',
	'timed-out': 'Timed out',
};

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
	return count === 1 ? singular : pluralForm;
}

function describeUnavailable(
	unavailable: readonly HomeOverviewServerRef[],
): string | undefined {
	if (unavailable.length === 0) return undefined;
	const offline = unavailable.filter((item) => item.reason === 'offline');
	const notHeld = unavailable.filter((item) => item.reason === 'not-held');
	const parts: string[] = [];
	if (offline.length > 0)
		parts.push(
			`${offline.map((item) => item.serverLabel).join(', ')} unavailable`,
		);
	if (notHeld.length > 0)
		parts.push(
			`${notHeld.map((item) => item.serverLabel).join(', ')} not counted until opened`,
		);
	return parts.join(' · ');
}

function formatTime(at: number, now: number): string {
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

function Widget({
	children,
	icon,
	id,
	onActivate,
	title,
	unavailable,
}: Readonly<{
	children: ReactNode;
	icon: ReactNode;
	id: string;
	onActivate?: () => void;
	title: string;
	unavailable?: readonly HomeOverviewServerRef[];
}>) {
	const note = describeUnavailable(unavailable ?? []);
	const body = (
		<>
			<span className="home-widget__title">
				{icon}
				{title}
			</span>
			<span className="home-widget__body">{children}</span>
			{note === undefined ? null : (
				<span
					className="home-widget__unavailable"
					data-terminay-home-widget-unavailable="true"
				>
					{note}
				</span>
			)}
		</>
	);
	return onActivate === undefined ? (
		<section className="home-widget" data-terminay-home-widget={id}>
			{body}
		</section>
	) : (
		<button
			type="button"
			className="home-widget home-widget--action"
			data-terminay-home-widget={id}
			onClick={onActivate}
		>
			{body}
		</button>
	);
}

function Count({
	count,
	label,
}: Readonly<{ count: HomeOverviewCount | number; label: string }>) {
	const value = typeof count === 'number' ? count : count.value;
	return (
		<span className="home-widget__count">
			<span className="home-widget__number" data-terminay-home-count={label}>
				{value}
			</span>
			<span className="home-widget__unit">{label}</span>
		</span>
	);
}

export function HomeOverview({
	now = Date.now(),
	onOpenAutomations,
	onOpenTabs,
	overview,
}: HomeOverviewProps) {
	const { agents, automations, connections, projects, tabs, terminals } =
		overview;
	const devices = connections.devices;

	return (
		<div className="home-section home-overview" data-terminay-home-overview>
			<header className="home-section__header">
				<h2 className="home-section__heading">Home</h2>
				<p className="home-section__subheading">Your workspace at a glance.</p>
			</header>
			<div className="home-overview__grid">
				<Widget
					icon={<FolderKanban size={14} aria-hidden="true" />}
					id="projects"
					onActivate={onOpenTabs}
					title="Projects"
					unavailable={projects.unavailable}
				>
					<Count count={projects} label={plural(projects.value, 'project')} />
				</Widget>
				<Widget
					icon={<PanelsTopLeft size={14} aria-hidden="true" />}
					id="tabs"
					onActivate={onOpenTabs}
					title="Tabs"
					unavailable={tabs.unavailable}
				>
					<Count count={tabs} label={plural(tabs.value, 'tab')} />
					<Count
						count={terminals}
						label={plural(terminals.value, 'terminal')}
					/>
				</Widget>
				<Widget
					icon={<Sparkles size={14} aria-hidden="true" />}
					id="agents"
					onActivate={onOpenTabs}
					title="Agents"
					unavailable={agents.unavailable}
				>
					{HOME_OVERVIEW_AGENT_GROUPS.map((group) => (
						<span
							key={group}
							className={`home-widget__count home-widget__count--${group}`}
							data-terminay-home-agent-group={group}
						>
							<span className="home-widget__number">{agents[group]}</span>
							<span className="home-widget__unit">
								{HOME_OVERVIEW_AGENT_GROUP_LABELS[group]}
							</span>
						</span>
					))}
				</Widget>
				<Widget
					icon={<Radio size={14} aria-hidden="true" />}
					id="connections"
					title="Connections"
					unavailable={connections.unavailable}
				>
					<Count
						count={connections.available}
						label={`of ${connections.attached} ${plural(connections.attached, 'server')} connected`}
					/>
					{devices.state === 'on' ? (
						<Count
							count={devices.connected}
							label={`remote ${plural(devices.connected, 'device')} connected`}
						/>
					) : (
						<span className="home-widget__note">
							{devices.state === 'off'
								? 'Remote access is off'
								: 'Remote access status unavailable'}
						</span>
					)}
				</Widget>
				<Widget
					icon={<Workflow size={14} aria-hidden="true" />}
					id="automations"
					title="Automations"
					unavailable={automations.unavailable}
				>
					{automations.isEmpty ? (
						<span className="home-widget__empty">
							<span className="home-widget__note">No automations yet.</span>
							<button
								type="button"
								className="home-widget__link"
								data-terminay-home-create-automation="true"
								onClick={() => onOpenAutomations({ kind: 'create' })}
							>
								Create an automation
							</button>
						</span>
					) : (
						<>
							<button
								type="button"
								className="home-widget__link home-widget__count"
								onClick={() => onOpenAutomations({ kind: 'list' })}
							>
								<span className="home-widget__number">
									{automations.active.length}
								</span>
								<span className="home-widget__unit">active</span>
							</button>
							{automations.nextRun === undefined ? (
								<span className="home-widget__note">No scheduled run</span>
							) : (
								<button
									type="button"
									className="home-widget__link home-widget__row"
									data-terminay-home-next-run="true"
									onClick={() => {
										const next = automations.nextRun;
										if (next === undefined) return;
										onOpenAutomations({
											kind: 'automation',
											serverId: next.serverId,
											automationId: next.automationId,
										});
									}}
								>
									<CalendarClock size={13} aria-hidden="true" />
									<span className="home-widget__row-text">
										Next: {automations.nextRun.name}
										{automations.nextRun.serverLabel === undefined
											? ''
											: ` · ${automations.nextRun.serverLabel}`}
									</span>
									<span className="home-widget__row-meta">
										{automations.nextRun.nextRunAt === undefined
											? ''
											: formatTime(automations.nextRun.nextRunAt, now)}
									</span>
								</button>
							)}
						</>
					)}
				</Widget>
				<Widget
					icon={<History size={14} aria-hidden="true" />}
					id="recent-runs"
					title="Recent runs"
				>
					{automations.recentRuns.length === 0 ? (
						<span className="home-widget__note">No runs yet.</span>
					) : (
						<ul className="home-widget__list">
							{automations.recentRuns.map((run) => (
								<li key={`${run.serverId}:${run.runId}`}>
									<button
										type="button"
										className="home-widget__link home-widget__row"
										data-terminay-home-run={run.runId}
										data-terminay-home-run-outcome={run.outcome}
										onClick={() =>
											onOpenAutomations({
												kind: 'run',
												serverId: run.serverId,
												automationId: run.automationId,
												runId: run.runId,
											})
										}
									>
										<span
											className={`home-widget__outcome home-widget__outcome--${run.outcome}`}
										>
											{OUTCOME_LABELS[run.outcome]}
										</span>
										<span className="home-widget__row-text">
											{run.automationName}
											{run.serverLabel === undefined
												? ''
												: ` · ${run.serverLabel}`}
										</span>
										<span className="home-widget__row-meta">
											{formatTime(run.startedAt, now)}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</Widget>
			</div>
		</div>
	);
}
