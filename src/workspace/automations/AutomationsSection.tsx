/**
 * Home's Automations section.
 *
 * Automations are server-owned, workspace-wide trigger → action rules. The
 * section shows one server's at a time — the one the window works in unless a
 * person picks another — and never merges two servers' lists. From here a
 * person creates, edits, duplicates, enables, disables, deletes, and runs
 * automations, reads each one's run history, and works with the terminals the
 * automation space holds.
 *
 * It is laid out the way the Tabs section is: a full-width list of one-line
 * rows under a header. Opening an automation, editing one, or opening one of
 * the automation space's terminals replaces the list with that page, and a
 * back link returns to it.
 */

import type {
	AutomationDefinition,
	AutomationDraft,
	AutomationRunEntry,
} from '@terminay/client-core';
import {
	BellRing,
	ChevronLeft,
	ChevronRight,
	Clock,
	Play,
	Plus,
	SquareTerminal,
	Workflow,
	Zap,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceConnectionContext } from '../../shared/connections/connectionRegistry';
import {
	isReservedWorkspaceProject,
	type ServerWorkspaceSnapshot,
} from '../../shared/serverWorkspaceReconciliation';
import type { HomeOverviewAutomationTarget } from '../HomeOverview';
import { AutomationEditor } from './AutomationEditor';
import { AutomationTerminalView } from './AutomationTerminalView';
import { ExitedAutomationTerminalView } from './ExitedAutomationTerminalView';
import {
	ACTION_LABELS,
	type AutomationForm,
	type AutomationServerCandidate,
	type AutomationSpaceTerminal,
	describeRunOutcome,
	describeTrigger,
	emptyAutomationForm,
	formatDuration,
	formFromAutomation,
	groupSpaceTerminals,
	hasTerminalSubject,
	latestRuns,
	nextRunAt,
	refusalMessage,
	selectAutomationServer,
} from './automationsModel';
import type { ServerAutomations } from './useServerAutomations';
import '../workspaceDashboard.css';
import './automations.css';

/** One attached connection, with the context the section talks through. */
export type AutomationsSectionServer = AutomationServerCandidate &
	Readonly<{ context?: WorkspaceConnectionContext }>;

/** A request from elsewhere (the overview) to show something here. */
export type AutomationsFocusRequest = Readonly<{
	target: HomeOverviewAutomationTarget;
	nonce: number;
}>;

export type AutomationsSectionProps = Readonly<{
	servers: readonly AutomationsSectionServer[];
	automations: ReadonlyMap<string, ServerAutomations>;
	/** The server the window is working in; the default choice. */
	workingServerId?: string;
	focus?: AutomationsFocusRequest;
	now: number;
}>;

const AUTOMATION_SPACE_KIND = 'automations';

type Page =
	| Readonly<{ kind: 'list' }>
	| Readonly<{ kind: 'automation'; automationId: string; runId?: string }>
	| Readonly<{ kind: 'edit'; form: AutomationForm }>
	| Readonly<{ kind: 'terminal'; panelId: string }>;

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

/** The automation space and its terminals on one connection, kept live. */
function useAutomationSpace(context: WorkspaceConnectionContext | undefined) {
	const store = context?.workspaceSnapshotStore;
	const [snapshot, setSnapshot] = useState<ServerWorkspaceSnapshot | null>(
		store?.snapshot ?? null,
	);
	useEffect(() => {
		if (store === undefined) {
			setSnapshot(null);
			return;
		}
		return store.subscribe(setSnapshot);
	}, [store]);
	return useMemo(() => {
		if (snapshot === null) return { subjects: [] };
		const space = Object.values(snapshot.projects).find(
			(project) => project.kind === AUTOMATION_SPACE_KIND,
		);
		const terminals: AutomationSpaceTerminal[] = [];
		for (const panelId of space?.panelIds ?? []) {
			const panel = snapshot.panels[panelId];
			if (panel?.type !== 'terminal' || panel.sessionId === undefined) continue;
			terminals.push({
				panelId: panel.id,
				sessionId: panel.sessionId,
				title: panel.title ?? 'Automation terminal',
				status: snapshot.terminalSessions[panel.sessionId]?.status ?? 'running',
			});
		}
		// Terminals a subject action can be run on by hand: every terminal in
		// the server's own projects.
		const subjects = Object.values(snapshot.projects)
			.filter((project) => !isReservedWorkspaceProject(project))
			.flatMap((project) =>
				project.panelIds.flatMap((panelId) => {
					const panel = snapshot.panels[panelId];
					if (panel?.type !== 'terminal' || panel.sessionId === undefined)
						return [];
					return [
						{
							projectId: project.id,
							sessionId: panel.sessionId,
							label: `${project.name} · ${panel.title ?? 'Terminal'}`,
						},
					];
				}),
			);
		return {
			subjects,
			...(space === undefined
				? {}
				: {
						space: {
							projectId: space.id,
							root: space.root,
							terminals,
						},
					}),
		};
	}, [snapshot]);
}

function OutcomeBadge({ run }: Readonly<{ run: AutomationRunEntry }>) {
	const outcome = describeRunOutcome(run);
	return (
		<span
			className={`automations-outcome automations-outcome--${outcome.tone}`}
			data-terminay-automation-outcome={run.outcome ?? run.status}
			title={outcome.label}
		>
			{outcome.label}
		</span>
	);
}

/** The header every page of the section shares, styled as the Tabs header. */
function PageHeader({
	children,
	onBack,
	subtitle,
	title,
}: Readonly<{
	title: string;
	subtitle?: ReactNode;
	onBack?: () => void;
	children?: ReactNode;
}>) {
	return (
		<header className="workspace-dashboard__header automations-header">
			<div className="workspace-dashboard__header-top">
				<div className="workspace-dashboard__heading-box automations-header__heading-box">
					{onBack === undefined ? null : (
						<button
							type="button"
							className="automations-crumb"
							onClick={onBack}
							data-terminay-automations-back="true"
						>
							<ChevronLeft size={13} aria-hidden="true" />
							Automations
						</button>
					)}
					<h2 className="workspace-dashboard__heading automations-header__title">
						{title}
					</h2>
					{subtitle === undefined ? null : (
						<p className="workspace-dashboard__subheading automations-header__subtitle">
							{subtitle}
						</p>
					)}
				</div>
				{children === undefined ? null : (
					<div className="workspace-dashboard__controls">{children}</div>
				)}
			</div>
		</header>
	);
}

function RunDetail({
	context,
	onOpenTerminal,
	onStop,
	run,
	terminals,
}: Readonly<{
	context?: WorkspaceConnectionContext;
	run: AutomationRunEntry;
	terminals: readonly AutomationSpaceTerminal[];
	onStop: (runId: string) => void;
	onOpenTerminal: (panelId: string) => void;
}>) {
	const [revealError, setRevealError] = useState<string>();
	return (
		<section
			className="automations-run-detail"
			data-terminay-automation-run-detail={run.runId}
			aria-label="Run detail"
		>
			<dl className="automations-facts">
				<dt>Outcome</dt>
				<dd>
					<OutcomeBadge run={run} />
				</dd>
				<dt>Exit code</dt>
				<dd data-terminay-automation-run-exit-code="true">
					{run.exitCode ?? '—'}
				</dd>
				{run.subject === undefined ? null : (
					<>
						<dt>Subject</dt>
						<dd>
							{run.subject.kind === 'terminal'
								? [run.subject.projectTitle, run.subject.title]
										.filter(Boolean)
										.join(' · ') || 'A terminal'
								: run.subject.kind === 'project'
									? (run.subject.title ?? 'A project')
									: (run.subject.name ?? 'A device')}
						</dd>
					</>
				)}
				{run.suppressedEvents > 0 ? (
					<>
						<dt>Cooldown</dt>
						<dd>
							{run.suppressedEvents} repeated{' '}
							{run.suppressedEvents === 1 ? 'event' : 'events'} during the
							cooldown
						</dd>
					</>
				) : null}
				{run.reason === undefined ? null : (
					<>
						<dt>Note</dt>
						<dd>{run.reason}</dd>
					</>
				)}
			</dl>
			{run.status === 'running' || run.recordingId !== undefined ? (
				<div className="automations-run-detail__actions">
					{run.status === 'running' ? (
						<button
							type="button"
							className="automations-button"
							onClick={() => onStop(run.runId)}
						>
							Stop run
						</button>
					) : null}
					{run.recordingId === undefined ? null : (
						<button
							type="button"
							className="automations-button"
							data-terminay-automation-run-recording={run.recordingId}
							onClick={() => {
								const recordingId = run.recordingId;
								if (recordingId === undefined) return;
								setRevealError(undefined);
								void context?.recordingsClient
									?.reveal(recordingId)
									.catch((error: unknown) =>
										setRevealError(refusalMessage(error)),
									);
							}}
						>
							Show recording
						</button>
					)}
				</div>
			) : null}
			{revealError === undefined ? null : (
				<p className="automations-error" role="alert">
					{revealError}
				</p>
			)}
			{terminals.length === 0 ? null : (
				<div className="automations-run-detail__terminals">
					{terminals.map((terminal) => (
						<TerminalRow
							key={terminal.panelId}
							terminal={terminal}
							onOpen={onOpenTerminal}
						/>
					))}
				</div>
			)}
			{run.outputTail === undefined || run.outputTail.length === 0 ? (
				<p className="automations-muted automations-run-detail__no-output">
					{run.status === 'running'
						? 'The output is kept when the run ends.'
						: 'No output was kept for this run.'}
				</p>
			) : (
				<pre
					className="automations-run-detail__tail"
					data-terminay-automation-run-tail="true"
				>
					{run.outputTail}
				</pre>
			)}
		</section>
	);
}

function TerminalRow({
	detail,
	onOpen,
	terminal,
}: Readonly<{
	terminal: AutomationSpaceTerminal;
	detail?: string;
	onOpen: (panelId: string) => void;
}>) {
	const running = terminal.status === 'running';
	return (
		<button
			type="button"
			className="workspace-dashboard__row automations-terminal-row"
			data-terminay-automation-terminal={terminal.sessionId}
			onClick={() => onOpen(terminal.panelId)}
		>
			<span
				className={`automations-dot${running ? ' automations-dot--running' : ''}`}
				aria-hidden="true"
			/>
			<SquareTerminal
				size={13}
				className="workspace-dashboard__kind"
				aria-hidden="true"
			/>
			<span className="workspace-dashboard__title">{terminal.title}</span>
			<span className="workspace-dashboard__row-detail">
				{[running ? 'Running' : 'Exited', detail].filter(Boolean).join(' · ')}
			</span>
		</button>
	);
}

/** One-click starting points for an empty list: the editor, pre-filled. */
const STARTING_POINTS = [
	{
		id: 'agent-needs-input',
		icon: BellRing,
		title: 'Tell me when an agent needs me',
		detail: 'When an agent needs input · run a command',
		form: {
			name: 'Tell me when an agent needs me',
			triggerKind: 'event',
			event: 'agent.needsInput',
			command: 'echo "$TERMINAY_TERMINAL_TITLE needs you"',
		},
	},
	{
		id: 'agent-finished',
		icon: Zap,
		title: 'Count finished agents',
		detail: 'When an agent finishes · run a command',
		form: {
			name: 'Count finished agents',
			triggerKind: 'event',
			event: 'agent.finished',
			command: 'echo 1 >> ~/agent-stats.txt',
		},
	},
	{
		id: 'hourly-script',
		icon: Clock,
		title: 'Run a script every hour',
		detail: 'Every hour, on the hour · run a command',
		form: {
			name: 'Hourly script',
			triggerKind: 'schedule',
			cron: '0 * * * *',
			command: '~/bin/hourly.sh',
		},
	},
] as const satisfies readonly Readonly<{
	id: string;
	icon: typeof Clock;
	title: string;
	detail: string;
	form: Partial<AutomationForm>;
}>[];

export function AutomationsSection({
	automations,
	focus,
	now,
	servers,
	workingServerId,
}: AutomationsSectionProps) {
	const [requestedServer, setRequestedServer] = useState<string>();
	const selection = useMemo(
		() => selectAutomationServer(servers, requestedServer, workingServerId),
		[requestedServer, servers, workingServerId],
	);
	const serverId = selection.selected?.serverId;
	const server = servers.find((candidate) => candidate.serverId === serverId);
	const context = server?.context;
	const data = serverId === undefined ? undefined : automations.get(serverId);
	const { space, subjects } = useAutomationSpace(context);
	const [page, setPage] = useState<Page>({ kind: 'list' });
	const [actionError, setActionError] = useState<string>();
	const [confirmingDelete, setConfirmingDelete] = useState<string>();
	const [choosingSubject, setChoosingSubject] = useState<string>();
	const [subjectSessionId, setSubjectSessionId] = useState('');

	const go = useCallback((next: Page) => {
		setActionError(undefined);
		setConfirmingDelete(undefined);
		setChoosingSubject(undefined);
		setPage(next);
	}, []);

	// A request from the overview picks the server, then what to show on it.
	useEffect(() => {
		if (focus === undefined) return;
		const { target } = focus;
		switch (target.kind) {
			case 'list':
				go({ kind: 'list' });
				return;
			case 'create':
				go({ kind: 'edit', form: emptyAutomationForm() });
				return;
			case 'automation':
				setRequestedServer(target.serverId);
				go({ kind: 'automation', automationId: target.automationId });
				return;
			case 'run':
				setRequestedServer(target.serverId);
				go({
					kind: 'automation',
					automationId: target.automationId,
					runId: target.runId,
				});
				return;
		}
	}, [focus, go]);

	const selectServer = (next: string) => {
		setRequestedServer(next);
		go({ kind: 'list' });
	};

	const list = data?.automations ?? [];
	const runs = data?.runs ?? [];
	const latest = useMemo(() => latestRuns(runs), [runs]);
	const groups = useMemo(
		() => groupSpaceTerminals(space?.terminals ?? [], runs),
		[runs, space?.terminals],
	);
	const automationName = useCallback(
		(automationId: string) =>
			list.find((automation) => automation.id === automationId)?.name ??
			'Deleted automation',
		[list],
	);

	const perform = async (work: () => Promise<unknown>) => {
		setActionError(undefined);
		try {
			await work();
		} catch (error) {
			setActionError(refusalMessage(error));
		}
	};

	const save = async (draft: AutomationDraft) => {
		if (data === undefined) throw new Error('This server is not available.');
		const state = await data.client.upsert(draft, {
			expectedRevision: data.revision,
		});
		const saved =
			draft.id === undefined
				? state.automations.find(
						(automation) =>
							!list.some((existing) => existing.id === automation.id),
					)
				: state.automations.find((automation) => automation.id === draft.id);
		data.refresh();
		go(
			saved === undefined
				? { kind: 'list' }
				: { kind: 'automation', automationId: saved.id },
		);
	};

	const setEnabled = (automation: AutomationDefinition, enabled: boolean) =>
		void perform(async () => {
			if (data === undefined) return;
			await data.client.setEnabled(automation.id, enabled, {
				expectedRevision: data.revision,
			});
			data.refresh();
		});

	const runNow = (automation: AutomationDefinition, sessionId?: string) =>
		perform(async () => {
			if (data === undefined || serverId === undefined) return;
			const subject =
				sessionId === undefined
					? undefined
					: subjects.find((candidate) => candidate.sessionId === sessionId);
			const run = await data.client.run(
				automation.id,
				subject === undefined
					? undefined
					: {
							serverId,
							projectId: subject.projectId,
							sessionId: subject.sessionId,
						},
			);
			setChoosingSubject(undefined);
			data.refresh();
			setPage({
				kind: 'automation',
				automationId: automation.id,
				runId: run.runId,
			});
		});

	const closeTerminal = (panelId: string) =>
		void perform(async () => {
			await context?.workspaceSnapshotStore?.closePanel(panelId);
			setPage((current) =>
				current.kind === 'terminal' && current.panelId === panelId
					? { kind: 'list' }
					: current,
			);
		});

	const errorBanner =
		actionError === undefined ? null : (
			<p
				className="automations-banner automations-banner--error"
				role="alert"
				data-terminay-automation-action-error="true"
			>
				{actionError}
			</p>
		);

	const serverSelector = selection.showsSelector ? (
		<label className="automations-server">
			<span className="automations-server__label">Server</span>
			<select
				className="automation-editor__input automations-server__select"
				value={serverId ?? ''}
				onChange={(event) => selectServer(event.target.value)}
				data-terminay-automations-server-selector="true"
			>
				{selection.choices.map((choice) => (
					<option key={choice.serverId} value={choice.serverId}>
						{choice.label}
					</option>
				))}
			</select>
		</label>
	) : null;

	const newButton = (
		<button
			type="button"
			className="automations-button automations-button--primary"
			data-terminay-automation-new="true"
			onClick={() => go({ kind: 'edit', form: emptyAutomationForm() })}
		>
			<Plus size={13} aria-hidden="true" />
			New automation
		</button>
	);

	const listSubtitle =
		'Commands, Macros, and text that run on a schedule or when something happens.';

	// --- Pages that do not need the server's list -----------------------------

	if (selection.selected === undefined)
		return (
			<div className="home-section home-automations" data-terminay-automations>
				<PageHeader title="Automations" subtitle={listSubtitle} />
				<p
					className="workspace-dashboard__empty automations-empty"
					data-terminay-automations-unsupported="true"
				>
					{selection.unsupported.length === 0
						? 'Automations appear here once a server is connected.'
						: `${selection.unsupported.map((choice) => choice.label).join(', ')} ${selection.unsupported.length === 1 ? 'does' : 'do'} not support automations. Update Terminay Server there to use them.`}
				</p>
			</div>
		);

	if (data === undefined || data.status !== 'ready')
		return (
			<div className="home-section home-automations" data-terminay-automations>
				<PageHeader title="Automations" subtitle={listSubtitle}>
					{serverSelector}
				</PageHeader>
				{data?.status === 'error' ? (
					<div className="workspace-dashboard__empty automations-empty" role="alert">
						<p>{data.error ?? 'This server’s automations are unavailable.'}</p>
						<button
							type="button"
							className="automations-button"
							onClick={data.refresh}
						>
							Try again
						</button>
					</div>
				) : (
					<p className="workspace-dashboard__empty automations-empty" role="status">
						Loading automations…
					</p>
				)}
			</div>
		);

	// --- Editor ------------------------------------------------------------------

	if (page.kind === 'edit') {
		const back = () =>
			go(
				page.form.id === undefined
					? { kind: 'list' }
					: { kind: 'automation', automationId: page.form.id },
			);
		return (
			<div className="home-section home-automations" data-terminay-automations>
				<AutomationEditor
					key={page.form.id ?? 'new'}
					initial={page.form}
					now={now}
					{...(data.timeZone === undefined ? {} : { timeZone: data.timeZone })}
					onCancel={back}
					onSave={save}
					renderHeader={(controls) => (
						<PageHeader
							title={
								page.form.id === undefined
									? 'New automation'
									: `Edit ${page.form.name || 'automation'}`
							}
							onBack={back}
						>
							{controls}
						</PageHeader>
					)}
					{...(context?.applicationClient === undefined
						? {}
						: { applicationClient: context.applicationClient })}
				/>
			</div>
		);
	}

	// --- One automation space terminal --------------------------------------------

	if (page.kind === 'terminal' && space !== undefined) {
		const terminal = space.terminals.find(
			(candidate) => candidate.panelId === page.panelId,
		);
		if (terminal !== undefined && context !== undefined && serverId !== undefined) {
			const group = groups.find((candidate) =>
				candidate.terminals.some((item) => item.panelId === terminal.panelId),
			);
			const running = space.terminals.filter(
				(candidate) => candidate.status === 'running',
			);
			return (
				<div
					className="home-section home-automations home-automations--terminal"
					data-terminay-automations
				>
					<PageHeader
						title={terminal.title}
						subtitle={
							group?.run === undefined
								? 'Automation terminal'
								: `${automationName(group.run.automationId)} · ${formatTime(group.run.startedAt, now)}`
						}
						onBack={() => go({ kind: 'list' })}
					>
						<button
							type="button"
							className="automations-button"
							aria-label={`Close ${terminal.title}`}
							onClick={() => closeTerminal(terminal.panelId)}
						>
							Close terminal
						</button>
					</PageHeader>
					{errorBanner}
					<div className="automations-terminal-page">
						{terminal.status === 'running' ? (
							<AutomationTerminalView
								context={context}
								serverId={serverId}
								projectId={space.projectId}
								projectRoot={space.root}
								terminals={running}
								selectedPanelId={terminal.panelId}
								onSelect={(panelId) => setPage({ kind: 'terminal', panelId })}
								onClose={closeTerminal}
							/>
						) : (
							<ExitedAutomationTerminalView
								key={terminal.panelId}
								context={context}
								serverId={serverId}
								projectId={space.projectId}
								terminal={terminal}
								onClose={closeTerminal}
							/>
						)}
					</div>
				</div>
			);
		}
	}

	// --- One automation ---------------------------------------------------------

	const selectedAutomation =
		page.kind === 'automation'
			? list.find((automation) => automation.id === page.automationId)
			: undefined;

	if (page.kind === 'automation' && selectedAutomation !== undefined) {
		const automation = selectedAutomation;
		const history = runs.filter((run) => run.automationId === automation.id);
		const next = nextRunAt(automation, now, data.timeZone);
		const needsSubject =
			hasTerminalSubject(automation.trigger) &&
			automation.action.kind !== 'runCommand';
		const runTerminals = (run: AutomationRunEntry) =>
			groups.find((group) => group.run?.runId === run.runId)?.terminals ?? [];
		return (
			<div
				className="home-section home-automations"
				data-terminay-automations
				data-terminay-automation-detail={automation.id}
			>
				<PageHeader
					title={automation.name}
					onBack={() => go({ kind: 'list' })}
					subtitle={
						<>
							{describeTrigger(automation.trigger)} ·{' '}
							{ACTION_LABELS[automation.action.kind]}
							{automation.action.kind === 'runCommand' ? (
								<>
									{' '}
									<code className="automations-code">
										{automation.action.command}
									</code>
								</>
							) : null}
						</>
					}
				>
					<label
						className="automations-switch automations-switch--labelled"
						title={automation.enabled ? 'Disable' : 'Enable'}
					>
						<input
							type="checkbox"
							role="switch"
							aria-checked={automation.enabled}
							aria-label={`${automation.name} enabled`}
							checked={automation.enabled}
							onChange={(event) => setEnabled(automation, event.target.checked)}
						/>
						<span aria-hidden="true" className="automations-switch__track" />
						<span className="automations-switch__text">
							{automation.enabled ? 'Enabled' : 'Disabled'}
						</span>
					</label>
					<button
						type="button"
						className="automations-button automations-button--primary"
						data-terminay-automation-run-now="true"
						onClick={() => {
							if (needsSubject) {
								setChoosingSubject(automation.id);
								setSubjectSessionId(subjects[0]?.sessionId ?? '');
								return;
							}
							void runNow(automation);
						}}
					>
						<Play size={12} aria-hidden="true" />
						Run now
					</button>
					<button
						type="button"
						className="automations-button"
						onClick={() =>
							go({ kind: 'edit', form: formFromAutomation(automation) })
						}
					>
						Edit
					</button>
					<button
						type="button"
						className="automations-button"
						onClick={() =>
							go({ kind: 'edit', form: formFromAutomation(automation, true) })
						}
					>
						Duplicate
					</button>
					<button
						type="button"
						className="automations-button automations-button--danger"
						onClick={() => setConfirmingDelete(automation.id)}
					>
						Delete
					</button>
				</PageHeader>
				{errorBanner}
				{confirmingDelete === automation.id ? (
					<div
						className="automations-banner"
						role="alertdialog"
						aria-label="Delete automation"
					>
						<span>
							Delete “{automation.name}”? Runs already in progress keep going.
						</span>
						<button
							type="button"
							className="automations-button automations-button--danger"
							data-terminay-automation-confirm-delete="true"
							onClick={() =>
								void perform(async () => {
									await data.client.remove(automation.id, {
										expectedRevision: data.revision,
									});
									data.refresh();
									go({ kind: 'list' });
								})
							}
						>
							Delete
						</button>
						<button
							type="button"
							className="automations-button"
							onClick={() => setConfirmingDelete(undefined)}
						>
							Cancel
						</button>
					</div>
				) : null}
				{choosingSubject === automation.id ? (
					<div className="automations-banner" data-terminay-automation-subject-chooser>
						{subjects.length === 0 ? (
							<span>This automation acts on a terminal, and none is open.</span>
						) : (
							<>
								<label className="automations-banner__field">
									<span>Run on</span>
									<select
										className="automation-editor__input"
										value={subjectSessionId}
										onChange={(event) => setSubjectSessionId(event.target.value)}
									>
										{subjects.map((subject) => (
											<option key={subject.sessionId} value={subject.sessionId}>
												{subject.label}
											</option>
										))}
									</select>
								</label>
								<button
									type="button"
									className="automations-button automations-button--primary"
									disabled={subjectSessionId === ''}
									onClick={() => void runNow(automation, subjectSessionId)}
								>
									Run
								</button>
							</>
						)}
						<button
							type="button"
							className="automations-button"
							onClick={() => setChoosingSubject(undefined)}
						>
							Cancel
						</button>
					</div>
				) : null}
				<div className="workspace-dashboard__list automations-body">
					<div className="automations-group-head">
						<span>Runs</span>
						<span className="automations-group-head__meta">
							{automation.enabled
								? next === undefined
									? ''
									: `Next run ${formatTime(next, now)}`
								: 'Disabled — runs only when you run it'}
						</span>
					</div>
					{history.length === 0 ? (
						<p className="workspace-dashboard__empty">No runs yet.</p>
					) : (
						<ul className="automations-runs" aria-label="Run history">
							{history.map((run) => {
								const open = run.runId === page.runId;
								return (
									<li key={run.runId}>
										<button
											type="button"
											className={`workspace-dashboard__row automations-run-row${open ? ' automations-run-row--open' : ''}`}
											aria-expanded={open}
											data-terminay-automation-run={run.runId}
											onClick={() =>
												setPage({
													kind: 'automation',
													automationId: automation.id,
													...(open ? {} : { runId: run.runId }),
												})
											}
										>
											<ChevronRight
												size={12}
												className="automations-run-row__chevron"
												aria-hidden="true"
											/>
											<OutcomeBadge run={run} />
											<span className="workspace-dashboard__title">
												{formatTime(run.startedAt, now)}
											</span>
											<span className="workspace-dashboard__row-detail">
												{run.startedBy === 'user' ? 'Run by you' : 'Triggered'}
												{run.durationMs === undefined
													? ''
													: ` · ${formatDuration(run.durationMs)}`}
											</span>
										</button>
										{open ? (
											<RunDetail
												run={run}
												terminals={runTerminals(run)}
												onOpenTerminal={(panelId) =>
													go({ kind: 'terminal', panelId })
												}
												onStop={(runId) =>
													void perform(() => data.client.stop(runId))
												}
												{...(context === undefined ? {} : { context })}
											/>
										) : null}
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</div>
		);
	}

	// --- The list -------------------------------------------------------------

	return (
		<div className="home-section home-automations" data-terminay-automations>
			<PageHeader title="Automations" subtitle={listSubtitle}>
				{serverSelector}
				{list.length === 0 ? null : newButton}
			</PageHeader>
			{selection.unsupported.length > 0 ? (
				<p className="automations-banner" data-terminay-automations-unsupported-note>
					{selection.unsupported.map((choice) => choice.label).join(', ')}{' '}
					{selection.unsupported.length === 1 ? 'does' : 'do'} not support
					automations.
				</p>
			) : null}
			{errorBanner}
			<div className="workspace-dashboard__list automations-body">
				{list.length === 0 ? (
					<div className="automations-empty-state">
						<div className="automations-empty-state__icon" aria-hidden="true">
							<Workflow size={20} />
						</div>
						<h3 className="automations-empty-state__title">No automations yet</h3>
						<p className="automations-empty-state__text">
							Run a command, a Macro, or some text on a schedule, or when
							something happens in your workspace.
						</p>
						<button
							type="button"
							className="automations-button automations-button--primary"
							data-terminay-automation-new="true"
							onClick={() => go({ kind: 'edit', form: emptyAutomationForm() })}
						>
							<Plus size={13} aria-hidden="true" />
							New automation
						</button>
						<div className="automations-starts">
							<span className="automations-starts__label">Or start from</span>
							{STARTING_POINTS.map((start) => (
								<button
									key={start.id}
									type="button"
									className="automations-start"
									data-terminay-automation-start={start.id}
									onClick={() =>
										go({
											kind: 'edit',
											form: { ...emptyAutomationForm(), ...start.form },
										})
									}
								>
									<start.icon
										size={14}
										className="automations-start__icon"
										aria-hidden="true"
									/>
									<span className="automations-start__text">
										<span className="automations-start__title">
											{start.title}
										</span>
										<span className="automations-start__detail">
											{start.detail}
										</span>
									</span>
									<ChevronRight
										size={13}
										className="automations-start__chevron"
										aria-hidden="true"
									/>
								</button>
							))}
						</div>
					</div>
				) : (
					<ul className="automations-list" aria-label="Automations">
						{list.map((automation) => {
							const next = nextRunAt(automation, now, data.timeZone);
							const last = latest.get(automation.id);
							return (
								<li
									key={automation.id}
									className={`automations-row${automation.enabled ? '' : ' automations-row--disabled'}`}
									data-terminay-automation-row={automation.id}
								>
									<label
										className="automations-switch"
										title={automation.enabled ? 'Disable' : 'Enable'}
									>
										<input
											type="checkbox"
											role="switch"
											aria-checked={automation.enabled}
											aria-label={`${automation.name} enabled`}
											checked={automation.enabled}
											data-terminay-automation-enabled="true"
											onChange={(event) =>
												setEnabled(automation, event.target.checked)
											}
										/>
										<span aria-hidden="true" className="automations-switch__track" />
									</label>
									<button
										type="button"
										className="workspace-dashboard__row automations-row__main"
										onClick={() =>
											go({ kind: 'automation', automationId: automation.id })
										}
									>
										<span
											className="workspace-dashboard__title automations-row__name"
											data-terminay-automation-name="true"
										>
											{automation.name}
										</span>
										<span
											className="workspace-dashboard__row-detail"
											data-terminay-automation-trigger="true"
										>
											{describeTrigger(automation.trigger)}
										</span>
										<span className="automations-row__next">
											{automation.enabled && next !== undefined ? (
												<span data-terminay-automation-next-run="true">
													Next {formatTime(next, now)}
												</span>
											) : null}
										</span>
										<span className="automations-row__last">
											{last === undefined ? (
												<span className="automations-muted">Never run</span>
											) : (
												<OutcomeBadge run={last} />
											)}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}

				{space === undefined || space.terminals.length === 0 ? null : (
					<section
						className="automations-terminals"
						aria-label="Automation terminals"
						data-terminay-automation-terminals="true"
					>
						<div className="automations-group-head">
							<span>Terminals</span>
							<span className="automations-group-head__meta">
								Opened by automations · not part of any project
							</span>
						</div>
						{groups.map((group) => (
							<div
								key={group.run?.runId ?? 'unowned'}
								data-terminay-automation-terminal-group={group.run?.runId ?? 'other'}
							>
								{group.terminals.map((terminal) => (
									<TerminalRow
										key={terminal.panelId}
										terminal={terminal}
										detail={
											group.run === undefined
												? undefined
												: `${automationName(group.run.automationId)} · ${formatTime(group.run.startedAt, now)}`
										}
										onOpen={(panelId) => go({ kind: 'terminal', panelId })}
									/>
								))}
							</div>
						))}
					</section>
				)}
			</div>
		</div>
	);
}
