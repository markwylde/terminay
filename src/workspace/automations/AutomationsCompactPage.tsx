/**
 * Home › Automations on a compact workspace: the compact section page.
 *
 * Tabs split the list by health and trigger; each row keeps its enable switch
 * working in place. The terminals automations opened are one row at the end
 * of All, which opens their list. The server selector is the only View option.
 */

import type {
	AutomationDefinition,
	AutomationRunEntry,
} from '@terminay/client-core';
import { ChevronLeft, Clock, SquareTerminal, Zap } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { CompactSectionPage } from '../compact/CompactSectionPage';
import {
	CompactChip,
	CompactEmpty,
	CompactGroupHeader,
	CompactLinkRow,
	CompactRow,
	StatusMark,
} from '../compact/CompactRow';
import { SheetSelect } from '../compact/CompactSheet';
import { countTabs, rowsForTab } from '../compact/compactSectionModel';
import {
	type AutomationTerminalGroup,
	describeRunOutcome,
	describeTrigger,
	nextRunAt,
} from './automationsModel';

export type AutomationsCompactTab =
	| 'all'
	| 'failing'
	| 'schedules'
	| 'events'
	| 'off';

type Row = Readonly<{
	automation: AutomationDefinition;
	last: AutomationRunEntry | undefined;
}>;

const failed = (row: Row) =>
	row.automation.enabled &&
	row.last !== undefined &&
	row.last.status !== 'running' &&
	(row.last.outcome === 'failed' || row.last.outcome === 'timedOut');

const TABS = [
	{ id: 'all' as AutomationsCompactTab, label: 'All' },
	{
		id: 'failing' as AutomationsCompactTab,
		label: 'Failing',
		attention: true,
		test: failed,
	},
	{
		id: 'schedules' as AutomationsCompactTab,
		label: 'Schedules',
		test: (row: Row) => row.automation.trigger.kind === 'schedule',
	},
	{
		id: 'events' as AutomationsCompactTab,
		label: 'Events',
		test: (row: Row) => row.automation.trigger.kind === 'event',
	},
	{
		id: 'off' as AutomationsCompactTab,
		label: 'Off',
		test: (row: Row) => !row.automation.enabled,
	},
];

const OUTCOME_CHIP = {
	success: 'done',
	failure: 'attention',
	running: 'working',
	neutral: undefined,
} as const;

/** "in 12m", "3h ago": a time relative to now, short. */
function relative(at: number, now: number): string {
	const minutes = Math.round((at - now) / 60_000);
	const size = Math.abs(minutes);
	const text =
		size < 1
			? 'now'
			: size < 60
				? `${size}m`
				: size < 48 * 60
					? `${Math.round(size / 60)}h`
					: `${Math.round(size / 1440)}d`;
	if (text === 'now') return text;
	return minutes > 0 ? `in ${text}` : `${text} ago`;
}

export function AutomationsCompactPage({
	automations,
	latest,
	timeZone,
	now,
	tab,
	onTab,
	onNew,
	onOpen,
	onSetEnabled,
	terminalGroups,
	automationName,
	onOpenTerminal,
	server,
	notes,
	emptyState,
}: Readonly<{
	automations: readonly AutomationDefinition[];
	latest: ReadonlyMap<string, AutomationRunEntry>;
	timeZone: string | undefined;
	now: number;
	tab: AutomationsCompactTab;
	onTab: (tab: AutomationsCompactTab) => void;
	onNew: () => void;
	onOpen: (automationId: string) => void;
	onSetEnabled: (automation: AutomationDefinition, enabled: boolean) => void;
	terminalGroups: readonly AutomationTerminalGroup[];
	automationName: (automationId: string) => string;
	onOpenTerminal: (panelId: string) => void;
	/** Present while more than one server could be chosen. */
	server?: Readonly<{
		value: string;
		choices: readonly Readonly<{ serverId: string; label: string }>[];
		onChange: (serverId: string) => void;
	}>;
	notes: ReactNode;
	emptyState: ReactNode;
}>) {
	const [terminalsOpen, setTerminalsOpen] = useState(false);
	const terminalCount = terminalGroups.reduce(
		(sum, group) => sum + group.terminals.length,
		0,
	);

	if (terminalsOpen && terminalCount > 0)
		return (
			<div className="cpage" data-compact-section="automation-terminals">
				<div className="cpage__top">
					<div className="cpage__head cdetail__head">
						<button
							type="button"
							className="cdetail__back"
							onClick={() => setTerminalsOpen(false)}
							autoFocus
						>
							<ChevronLeft size={20} aria-hidden="true" />
							Automations
						</button>
					</div>
				</div>
				<div
					className="cpage__body"
					onKeyDown={(event) => {
						if (event.key !== 'Escape') return;
						event.preventDefault();
						setTerminalsOpen(false);
					}}
					data-terminay-automation-terminals="true"
				>
					<h1 className="cdetail__title cdetail__title--padded">
						Terminals opened by automations
					</h1>
					{terminalGroups.map((group) => (
						<section
							key={group.run?.runId ?? 'unowned'}
							data-terminay-automation-terminal-group={
								group.run?.runId ?? 'other'
							}
						>
							<CompactGroupHeader
								label={
									group.run === undefined
										? 'Other'
										: automationName(group.run.automationId)
								}
								{...(group.run === undefined
									? {}
									: { count: relative(group.run.startedAt, now) })}
							/>
							{group.terminals.map((terminal) => (
								<CompactRow
									key={terminal.panelId}
									lead={<SquareTerminal size={15} aria-hidden="true" />}
									title={terminal.title}
									detail={terminal.status === 'running' ? 'Running' : 'Exited'}
									onActivate={() => onOpenTerminal(terminal.panelId)}
									rowProps={{
										'data-terminay-automation-terminal': terminal.sessionId,
									}}
								/>
							))}
						</section>
					))}
				</div>
			</div>
		);

	const rows: Row[] = automations.map((automation) => ({
		automation,
		last: latest.get(automation.id),
	}));
	const tabs = countTabs(rows, TABS);
	const shown = rowsForTab(rows, TABS, tab);

	return (
		<CompactSectionPage
			section="automations"
			title="Automations"
			{...(automations.length === 0
				? {}
				: { summary: String(automations.length) })}
			create={{ label: 'New automation', onActivate: onNew }}
			tabs={tabs}
			selectedTab={tab}
			onSelectTab={onTab}
			{...(server === undefined
				? {}
				: {
						sheet: {
							title: 'Automations',
							canReset: false,
							onReset: () => {},
							content: (
								<SheetSelect
									label="Server"
									value={server.value}
									options={server.choices.map((choice) => ({
										value: choice.serverId,
										label: choice.label,
									}))}
									onChange={server.onChange}
								/>
							),
						},
					})}
			banner={notes}
		>
			{automations.length === 0 ? (
				emptyState
			) : shown.length === 0 ? (
				<CompactEmpty
					title={
						tab === 'failing'
							? 'Nothing is failing'
							: tab === 'off'
								? 'Every automation is on'
								: 'Nothing here'
					}
				/>
			) : (
				<div data-terminay-automations-compact-list="true">
					{shown.map(({ automation, last }) => {
						const next = nextRunAt(automation, now, timeZone);
						const outcome =
							last === undefined ? undefined : describeRunOutcome(last);
						const KindIcon = automation.trigger.kind === 'event' ? Zap : Clock;
						const tone =
							outcome === undefined ? undefined : OUTCOME_CHIP[outcome.tone];
						return (
							<CompactRow
								key={automation.id}
								lead={
									failed({ automation, last }) ? (
										<StatusMark tone="attention" label="Failing" />
									) : (
										<KindIcon size={15} aria-hidden="true" />
									)
								}
								title={
									<span data-terminay-automation-name="true">
										{automation.name}
									</span>
								}
								{...(last === undefined
									? {}
									: { trailing: relative(last.startedAt, now) })}
								detail={
									<span data-terminay-automation-trigger="true">
										{describeTrigger(automation.trigger)}
										{automation.enabled && next !== undefined ? (
											<span data-terminay-automation-next-run="true">
												{` · next ${relative(next, now)}`}
											</span>
										) : null}
									</span>
								}
								chips={
									outcome === undefined ? (
										<CompactChip>Never run</CompactChip>
									) : (
										<span
											data-terminay-automation-outcome={
												last?.outcome ?? last?.status
											}
										>
											<CompactChip {...(tone === undefined ? {} : { tone })}>
												{outcome.label}
											</CompactChip>
										</span>
									)
								}
								isDimmed={!automation.enabled}
								onActivate={() => onOpen(automation.id)}
								aside={
									<label
										className="csheet__row cautomation__switch"
										title={automation.enabled ? 'Disable' : 'Enable'}
									>
										<input
											type="checkbox"
											role="switch"
											aria-checked={automation.enabled}
											className="csheet__switch"
											aria-label={`${automation.name} enabled`}
											checked={automation.enabled}
											data-terminay-automation-enabled="true"
											onChange={(event) =>
												onSetEnabled(automation, event.target.checked)
											}
										/>
									</label>
								}
								rowProps={{ 'data-terminay-automation-row': automation.id }}
							/>
						);
					})}
				</div>
			)}
			{tab === 'all' && terminalCount > 0 ? (
				<CompactLinkRow
					icon={<SquareTerminal size={17} />}
					label="Terminals opened by automations"
					detail="Not part of any project"
					count={terminalCount}
					onActivate={() => setTerminalsOpen(true)}
					dataAttr="data-terminay-automation-terminals-link"
				/>
			) : null}
		</CompactSectionPage>
	);
}
