/**
 * Home's automation tabs.
 *
 * Automations are server-owned, workspace-wide trigger → action rules. The
 * Automations section is a list of one server's — the one the window works in
 * unless a person picks another — and never merges two servers' lists.
 * Everything a person opens from it is a Home tab of its own: an automation
 * with its run history, an editor, a new automation, one run, one automation
 * terminal. So the list stays where it was, and several of these can be open,
 * side by side, at once.
 *
 * Each panel here is the content of one such tab. A panel is bound to the
 * server its tab names and talks to its tab through `AutomationTabHost`; it
 * knows nothing else about how Home arranges tabs.
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
	Trash2,
	Workflow,
	Zap,
} from 'lucide-react';
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { WorkspaceConnectionContext } from '../../shared/connections/connectionRegistry';
import {
	isReservedWorkspaceProject,
	type ServerWorkspaceSnapshot,
} from '../../shared/serverWorkspaceReconciliation';
import { AutomationEditor } from './AutomationEditor';
import { AutomationTerminalView } from './AutomationTerminalView';
import { ExitedAutomationTerminalView } from './ExitedAutomationTerminalView';
import {
	ACTION_LABELS,
	type AutomationForm,
	type AutomationServerCandidate,
	type AutomationSpaceTerminal,
	DEFAULT_PRUNE_DAYS,
	describeRunOutcome,
	describeTrigger,
	emptyAutomationForm,
	formatDuration,
	formFromAutomation,
	groupSpaceTerminals,
	hasTerminalSubject,
	launchesRunTerminal,
	latestRuns,
	nextRunAt,
	prunableRuns,
	pruneDays,
	refusalMessage,
	selectAutomationServer,
	supportsAutomations,
} from './automationsModel';
import type { ServerAutomations } from './useServerAutomations';
import '../workspaceDashboard.css';
import './automations.css';

/** One attached connection, with the context the panels talk through. */
export type AutomationsSectionServer = AutomationServerCandidate &
	Readonly<{ context?: WorkspaceConnectionContext }>;

/** What every automation tab reads: one projection, so none can disagree. */
export type AutomationsData = Readonly<{
	servers: readonly AutomationsSectionServer[];
	automations: ReadonlyMap<string, ServerAutomations>;
	/** The server the window is working in; the list's default choice. */
	workingServerId?: string;
	now: number;
}>;

/** A tab an automation panel can ask for. */
export type AutomationTabTarget =
	| Readonly<{ kind: 'list' }>
	| Readonly<{ kind: 'automation'; serverId: string; automationId: string }>
	| Readonly<{ kind: 'edit'; serverId: string; automationId: string }>
	| Readonly<{
			kind: 'new';
			serverId: string;
			form?: Partial<AutomationForm>;
	  }>
	| Readonly<{
			kind: 'run';
			serverId: string;
			automationId: string;
			runId: string;
	  }>
	| Readonly<{ kind: 'terminal'; serverId: string; panelId: string }>;

/** A panel's own tab, and the way to open others. */
export type AutomationTabHost = Readonly<{
	/** Open a tab, or bring it to the front if it is already open. */
	open: (target: AutomationTabTarget) => void;
	/**
	 * Close this tab without asking. `why` says what took it away, and is told
	 * to the person when unsaved edits went with it.
	 */
	close: (why?: string) => void;
	/** Close this tab as a person would: unsaved edits are asked about. */
	requestClose: () => void;
	setTitle: (title: string) => void;
	setDirty: (dirty: boolean) => void;
	/** No tab strip is drawn, so the panel draws its own way out. */
	compact: boolean;
}>;

const AUTOMATION_SPACE_KIND = 'automations';

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
		if (snapshot === null) return { loaded: false, subjects: [] };
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
			loaded: true,
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

/**
 * The header every automation tab shares, styled as the Tabs header. `onBack`
 * is drawn only where no tab strip is: it closes the tab, which returns to the
 * tab it was opened from.
 */
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

// --- What a panel is bound to ------------------------------------------------

type Binding =
	| Readonly<{ state: 'waiting' | 'unsupported' | 'loading' }>
	| Readonly<{ state: 'error'; data: ServerAutomations }>
	| Readonly<{
			state: 'ready';
			data: ServerAutomations;
			server: AutomationsSectionServer;
			context?: WorkspaceConnectionContext;
	  }>;

/**
 * The server a tab is bound to, as it stands now.
 *
 * A tab names its server, so it does not move when the list's server selector
 * does. A server that was attached and no longer is closes the tab; one that
 * has not attached yet — a tab restored before its connection — is waited for.
 */
function useBinding(
	{ automations, servers }: AutomationsData,
	serverId: string,
	host: AutomationTabHost,
): Binding {
	const server = servers.find((candidate) => candidate.serverId === serverId);
	const seenRef = useRef(false);
	const closeRef = useRef(host.close);
	closeRef.current = host.close;
	const attached = server !== undefined;
	useEffect(() => {
		if (attached) {
			seenRef.current = true;
			return;
		}
		if (seenRef.current)
			closeRef.current('its server is no longer connected');
	}, [attached]);
	const data = automations.get(serverId);
	if (server === undefined) return { state: 'waiting' };
	if (data === undefined)
		return {
			state:
				server.usable && !supportsAutomations(server.capabilities)
					? 'unsupported'
					: 'loading',
		};
	if (data.status === 'error') return { state: 'error', data };
	if (data.status !== 'ready') return { state: 'loading' };
	return {
		state: 'ready',
		data,
		server,
		...(server.context === undefined ? {} : { context: server.context }),
	};
}

/** What a bound tab shows while its server cannot be read. */
function BindingPlaceholder({
	binding,
	host,
	title,
}: Readonly<{
	binding: Binding;
	host: AutomationTabHost;
	title: string;
}>) {
	if (binding.state === 'ready') return null;
	return (
		<div className="home-section home-automations" data-terminay-automations>
			<PageHeader
				title={title}
				{...(host.compact ? { onBack: host.requestClose } : {})}
			/>
			{binding.state === 'error' ? (
				<div
					className="workspace-dashboard__empty automations-empty"
					role="alert"
				>
					<p>
						{binding.data.error ?? 'This server’s automations are unavailable.'}
					</p>
					<button
						type="button"
						className="automations-button"
						onClick={binding.data.refresh}
					>
						Try again
					</button>
				</div>
			) : (
				<p
					className="workspace-dashboard__empty automations-empty"
					role="status"
					data-terminay-automation-waiting={binding.state}
				>
					{binding.state === 'waiting'
						? 'Waiting for this tab’s server to connect…'
						: binding.state === 'unsupported'
							? 'This server does not support automations.'
							: 'Loading automations…'}
				</p>
			)}
		</div>
	);
}

/** Names the owning server on a tab when more than one is attached. */
function serverNote(
	data: AutomationsData,
	serverId: string,
): string | undefined {
	const named = data.servers.filter(
		(candidate) => candidate.serverId !== undefined,
	);
	if (named.length < 2) return undefined;
	return named.find((candidate) => candidate.serverId === serverId)?.label;
}

function useActionError() {
	const [actionError, setActionError] = useState<string>();
	const perform = useCallback(async (work: () => Promise<unknown>) => {
		setActionError(undefined);
		try {
			await work();
		} catch (error) {
			setActionError(refusalMessage(error));
		}
	}, []);
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
	return { errorBanner, perform };
}

/** Sets a tab's title to follow what it shows. */
function useTabTitle(host: AutomationTabHost, title: string | undefined) {
	const setTitleRef = useRef(host.setTitle);
	setTitleRef.current = host.setTitle;
	useEffect(() => {
		if (title !== undefined) setTitleRef.current(title);
	}, [title]);
}

/**
 * Closes a tab once what it shows is gone.
 *
 * Missing is not yet gone: a tab can open a moment before the list that names
 * its automation or run has caught up — one just saved, a run just started —
 * and a restored tab may name something deleted while the device was closed.
 * So the first time the thing is found missing the server is asked again, and
 * it is gone only if it was here before, or is still missing from an answer
 * newer than the one the tab first saw. `version` is the list it is looked for
 * in, which is replaced on every answer.
 */
function useCloseWhenGone(
	host: AutomationTabHost,
	state: Readonly<{
		/** The server has answered at least once. */
		ready: boolean;
		present: boolean;
		version: unknown;
		refresh?: () => void;
	}>,
	why: string,
) {
	const { present, ready, version } = state;
	const closeRef = useRef(host.close);
	closeRef.current = host.close;
	const refreshRef = useRef(state.refresh);
	refreshRef.current = state.refresh;
	const seenRef = useRef(false);
	if (present) seenRef.current = true;
	const firstVersionRef = useRef<unknown>(undefined);
	if (ready && firstVersionRef.current === undefined)
		firstVersionRef.current = version;
	const missing = ready && !present;
	useEffect(() => {
		if (missing) refreshRef.current?.();
	}, [missing]);
	const gone =
		missing && (seenRef.current || version !== firstVersionRef.current);
	useEffect(() => {
		if (gone) closeRef.current(why);
	}, [gone, why]);
}

type PanelProps = Readonly<{ data: AutomationsData; host: AutomationTabHost }>;

// --- The list ----------------------------------------------------------------

export function AutomationsListPanel({ data: shared, host }: PanelProps) {
	const { automations, now, servers, workingServerId } = shared;
	const [requestedServer, setRequestedServer] = useState<string>();
	const selection = useMemo(
		() => selectAutomationServer(servers, requestedServer, workingServerId),
		[requestedServer, servers, workingServerId],
	);
	const serverId = selection.selected?.serverId;
	const server = servers.find((candidate) => candidate.serverId === serverId);
	const context = server?.context;
	const data = serverId === undefined ? undefined : automations.get(serverId);
	const { space } = useAutomationSpace(context);
	const { errorBanner, perform } = useActionError();

	const list = data?.automations ?? [];
	const runs = data?.runs ?? [];
	const latest = useMemo(() => latestRuns(runs), [runs]);
	const groups = useMemo(
		() => groupSpaceTerminals(space?.terminals ?? [], runs),
		[runs, space?.terminals],
	);
	const automationName = (automationId: string) =>
		list.find((automation) => automation.id === automationId)?.name ??
		'Deleted automation';

	const listSubtitle =
		'Commands, Macros, and text that run on a schedule or when something happens.';

	const serverSelector = selection.showsSelector ? (
		<label className="automations-server">
			<span className="automations-server__label">Server</span>
			<select
				className="automation-editor__input automations-server__select"
				value={serverId ?? ''}
				onChange={(event) => setRequestedServer(event.target.value)}
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

	if (selection.selected === undefined || serverId === undefined)
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
					<div
						className="workspace-dashboard__empty automations-empty"
						role="alert"
					>
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
					<p
						className="workspace-dashboard__empty automations-empty"
						role="status"
					>
						Loading automations…
					</p>
				)}
			</div>
		);

	const openNew = (form?: Partial<AutomationForm>) =>
		host.open({
			kind: 'new',
			serverId,
			...(form === undefined ? {} : { form }),
		});

	const setEnabled = (automation: AutomationDefinition, enabled: boolean) =>
		void perform(async () => {
			await data.client.setEnabled(automation.id, enabled, {
				expectedRevision: data.revision,
			});
			data.refresh();
		});

	return (
		<div
			className="home-section home-automations"
			data-terminay-automations
			data-terminay-automations-list="true"
		>
			<PageHeader title="Automations" subtitle={listSubtitle}>
				{serverSelector}
				{list.length === 0 ? null : (
					<button
						type="button"
						className="automations-button automations-button--primary"
						data-terminay-automation-new="true"
						onClick={() => openNew()}
					>
						<Plus size={13} aria-hidden="true" />
						New automation
					</button>
				)}
			</PageHeader>
			{selection.unsupported.length > 0 ? (
				<p
					className="automations-banner"
					data-terminay-automations-unsupported-note
				>
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
						<h3 className="automations-empty-state__title">
							No automations yet
						</h3>
						<p className="automations-empty-state__text">
							Run a command, a Macro, or some text on a schedule, or when
							something happens in your workspace.
						</p>
						<button
							type="button"
							className="automations-button automations-button--primary"
							data-terminay-automation-new="true"
							onClick={() => openNew()}
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
									onClick={() => openNew(start.form)}
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
										<span
											aria-hidden="true"
											className="automations-switch__track"
										/>
									</label>
									<button
										type="button"
										className="workspace-dashboard__row automations-row__main"
										onClick={() =>
											host.open({
												kind: 'automation',
												serverId,
												automationId: automation.id,
											})
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
								data-terminay-automation-terminal-group={
									group.run?.runId ?? 'other'
								}
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
										onOpen={(panelId) =>
											host.open({ kind: 'terminal', serverId, panelId })
										}
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

// --- One automation ----------------------------------------------------------

export function AutomationDetailPanel({
	automationId,
	data: shared,
	host,
	serverId,
}: PanelProps & Readonly<{ serverId: string; automationId: string }>) {
	const { now } = shared;
	const binding = useBinding(shared, serverId, host);
	const ready = binding.state === 'ready' ? binding : undefined;
	const { subjects } = useAutomationSpace(ready?.context);
	const { errorBanner, perform } = useActionError();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [choosingSubject, setChoosingSubject] = useState(false);
	const [subjectSessionId, setSubjectSessionId] = useState('');
	/** The open Prune form's days, as typed. */
	const [pruning, setPruning] = useState<string>();

	const automation = ready?.data.automations.find(
		(candidate) => candidate.id === automationId,
	);
	useTabTitle(host, automation?.name);
	useCloseWhenGone(
		host,
		{
			ready: ready !== undefined,
			present: automation !== undefined,
			version: ready?.data.automations,
			...(ready === undefined ? {} : { refresh: ready.data.refresh }),
		},
		'the automation was deleted',
	);

	if (ready === undefined)
		return (
			<BindingPlaceholder binding={binding} host={host} title="Automation" />
		);
	if (automation === undefined)
		return (
			<div className="home-section home-automations" data-terminay-automations>
				<PageHeader
					title="Automation"
					{...(host.compact ? { onBack: host.requestClose } : {})}
				/>
				<p
					className="workspace-dashboard__empty automations-empty"
					role="status"
				>
					Loading this automation…
				</p>
			</div>
		);

	const { data } = ready;
	const history = data.runs.filter((run) => run.automationId === automation.id);
	const next = nextRunAt(automation, now, data.timeZone);
	const needsSubject =
		hasTerminalSubject(automation.trigger) &&
		!launchesRunTerminal(automation.action.kind);
	const server = serverNote(shared, serverId);

	const setEnabled = (enabled: boolean) =>
		void perform(async () => {
			await data.client.setEnabled(automation.id, enabled, {
				expectedRevision: data.revision,
			});
			data.refresh();
		});

	const runNow = (sessionId?: string) =>
		perform(async () => {
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
			setChoosingSubject(false);
			data.refresh();
			host.open({
				kind: 'run',
				serverId,
				automationId: automation.id,
				runId: run.runId,
			});
		});

	/** Open the Prune form, pre-filled with the days this automation was
	 * last pruned with on any client. */
	const openPrune = () =>
		perform(async () => {
			const snapshot = await data.client.runs(automation.id);
			setPruning(
				String(snapshot.pruneChoice?.olderThanDays ?? DEFAULT_PRUNE_DAYS),
			);
		});

	return (
		<div
			className="home-section home-automations"
			data-terminay-automations
			data-terminay-automation-detail={automation.id}
		>
			<PageHeader
				title={automation.name}
				{...(host.compact ? { onBack: host.requestClose } : {})}
				subtitle={
					<>
						{describeTrigger(automation.trigger)} ·{' '}
						{ACTION_LABELS[automation.action.kind]}
						{automation.action.kind === 'runCommand' ||
						automation.action.kind === 'promptAgent' ? (
							<>
								{' '}
								<code className="automations-code">
									{automation.action.command}
								</code>
							</>
						) : null}
						{server === undefined ? null : ` · ${server}`}
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
						onChange={(event) => setEnabled(event.target.checked)}
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
							setChoosingSubject(true);
							setSubjectSessionId(subjects[0]?.sessionId ?? '');
							return;
						}
						void runNow();
					}}
				>
					<Play size={12} aria-hidden="true" />
					Run now
				</button>
				<button
					type="button"
					className="automations-button"
					data-terminay-automation-edit="true"
					onClick={() =>
						host.open({ kind: 'edit', serverId, automationId: automation.id })
					}
				>
					Edit
				</button>
				<button
					type="button"
					className="automations-button"
					onClick={() =>
						host.open({
							kind: 'new',
							serverId,
							form: formFromAutomation(automation, true),
						})
					}
				>
					Duplicate
				</button>
				<button
					type="button"
					className="automations-button automations-button--danger"
					onClick={() => setConfirmingDelete(true)}
				>
					Delete
				</button>
			</PageHeader>
			{errorBanner}
			{automation.action.kind === 'promptAgent' ? (
				<pre
					className="automations-prompt"
					data-terminay-automation-prompt="true"
				>
					{automation.action.prompt}
				</pre>
			) : null}
			{confirmingDelete ? (
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
								host.close();
							})
						}
					>
						Delete
					</button>
					<button
						type="button"
						className="automations-button"
						onClick={() => setConfirmingDelete(false)}
					>
						Cancel
					</button>
				</div>
			) : null}
			{choosingSubject ? (
				<div
					className="automations-banner"
					data-terminay-automation-subject-chooser
				>
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
								onClick={() => void runNow(subjectSessionId)}
							>
								Run
							</button>
						</>
					)}
					<button
						type="button"
						className="automations-button"
						onClick={() => setChoosingSubject(false)}
					>
						Cancel
					</button>
				</div>
			) : null}
			{pruning === undefined
				? null
				: (() => {
						const days = pruneDays(pruning);
						const count =
							days === undefined
								? 0
								: prunableRuns(history, days, Math.max(now, Date.now())).length;
						return (
							<div
								className="automations-banner"
								role="alertdialog"
								aria-label="Prune runs"
								data-terminay-automation-prune-form="true"
							>
								<label className="automations-banner__field">
									<span>Remove finished runs older than</span>
									<input
										type="number"
										min={0}
										max={3650}
										className="automation-editor__input automation-editor__input--number"
										value={pruning}
										onChange={(event) => setPruning(event.target.value)}
										data-terminay-automation-prune-days="true"
									/>
									<span>days</span>
								</label>
								<span
									className="automations-banner__meta"
									data-terminay-automation-prune-count={count}
								>
									{days === undefined
										? 'Enter a whole number of days; 0 removes every finished run.'
										: count === 0
											? 'No finished runs are that old.'
											: `${count} ${count === 1 ? 'run' : 'runs'} will be removed.`}
								</span>
								<button
									type="button"
									className="automations-button automations-button--danger"
									disabled={days === undefined || count === 0}
									data-terminay-automation-confirm-prune="true"
									onClick={() =>
										days === undefined
											? undefined
											: void perform(async () => {
													await data.client.pruneRuns(automation.id, days);
													setPruning(undefined);
													data.refresh();
												})
									}
								>
									Prune
								</button>
								<button
									type="button"
									className="automations-button"
									onClick={() => setPruning(undefined)}
								>
									Cancel
								</button>
							</div>
						);
					})()}
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
					{history.length === 0 ? null : (
						<button
							type="button"
							className="automations-group-head__action"
							data-terminay-automation-prune="true"
							onClick={() => void openPrune()}
						>
							Prune…
						</button>
					)}
				</div>
				{history.length === 0 ? (
					<p className="workspace-dashboard__empty">No runs yet.</p>
				) : (
					<ul className="automations-runs" aria-label="Run history">
						{history.map((run) => (
							<li key={run.runId}>
								<div className="automations-run-line">
									<button
										type="button"
										className="workspace-dashboard__row automations-run-row"
										data-terminay-automation-run={run.runId}
										onClick={() =>
											host.open({
												kind: 'run',
												serverId,
												automationId: automation.id,
												runId: run.runId,
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
											{describeStartedBy(run)}
											{run.durationMs === undefined
												? ''
												: ` · ${formatDuration(run.durationMs)}`}
										</span>
									</button>
									{run.status === 'running' ? null : (
										<button
											type="button"
											className="automations-run-line__delete"
											aria-label={`Delete run from ${formatTime(run.startedAt, now)}`}
											title="Delete run"
											data-terminay-automation-delete-run={run.runId}
											onClick={() =>
												void perform(async () => {
													await data.client.removeRun(run.runId);
													data.refresh();
												})
											}
										>
											<Trash2 size={12} aria-hidden="true" />
										</button>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function describeStartedBy(run: AutomationRunEntry): string {
	return run.startedBy === 'user'
		? 'Run by you'
		: run.startedBy === 'mcp'
			? 'Run by an agent'
			: 'Triggered';
}

// --- One run -----------------------------------------------------------------

export function AutomationRunPanel({
	automationId,
	data: shared,
	host,
	runId,
	serverId,
}: PanelProps &
	Readonly<{ serverId: string; automationId: string; runId: string }>) {
	const { now } = shared;
	const binding = useBinding(shared, serverId, host);
	const ready = binding.state === 'ready' ? binding : undefined;
	const { space } = useAutomationSpace(ready?.context);
	const { errorBanner, perform } = useActionError();

	const automation = ready?.data.automations.find(
		(candidate) => candidate.id === automationId,
	);
	const run = ready?.data.runs.find((candidate) => candidate.runId === runId);
	const terminals = useMemo(
		() =>
			groupSpaceTerminals(space?.terminals ?? [], ready?.data.runs ?? []).find(
				(group) => group.run?.runId === runId,
			)?.terminals ?? [],
		[ready?.data.runs, runId, space?.terminals],
	);
	const name = automation?.name ?? 'Deleted automation';
	useTabTitle(
		host,
		run === undefined ? undefined : `${name} · ${formatTime(run.startedAt, now)}`,
	);
	useCloseWhenGone(
		host,
		{
			ready: ready !== undefined,
			present: run !== undefined,
			version: ready?.data.runs,
			...(ready === undefined ? {} : { refresh: ready.data.refresh }),
		},
		'the run was removed',
	);

	if (ready === undefined)
		return <BindingPlaceholder binding={binding} host={host} title="Run" />;
	if (run === undefined)
		return (
			<div className="home-section home-automations" data-terminay-automations>
				<PageHeader
					title={name}
					{...(host.compact ? { onBack: host.requestClose } : {})}
				/>
				<p
					className="workspace-dashboard__empty automations-empty"
					role="status"
				>
					Loading this run…
				</p>
			</div>
		);

	const server = serverNote(shared, serverId);
	return (
		<div
			className="home-section home-automations"
			data-terminay-automations
			data-terminay-automation-run-page={run.runId}
		>
			<PageHeader
				title={name}
				{...(host.compact ? { onBack: host.requestClose } : {})}
				subtitle={[
					`Run from ${formatTime(run.startedAt, now)}`,
					describeStartedBy(run),
					run.durationMs === undefined
						? undefined
						: formatDuration(run.durationMs),
					server,
				]
					.filter((part) => part !== undefined)
					.join(' · ')}
			>
				{automation === undefined ? null : (
					<button
						type="button"
						className="automations-button"
						data-terminay-automation-run-open-automation="true"
						onClick={() =>
							host.open({ kind: 'automation', serverId, automationId })
						}
					>
						Open automation
					</button>
				)}
			</PageHeader>
			{errorBanner}
			<div className="workspace-dashboard__list automations-body">
				<RunDetail
					run={run}
					terminals={terminals}
					onOpenTerminal={(panelId) =>
						host.open({ kind: 'terminal', serverId, panelId })
					}
					onStop={(stopped) =>
						void perform(() => ready.data.client.stop(stopped))
					}
					{...(ready.context === undefined ? {} : { context: ready.context })}
				/>
			</div>
		</div>
	);
}

// --- The editor --------------------------------------------------------------

export function AutomationEditorPanel({
	automationId,
	data: shared,
	host,
	initialForm,
	serverId,
}: PanelProps &
	Readonly<{
		serverId: string;
		/** The automation being edited; absent for a new one. */
		automationId?: string;
		/** What a new automation starts from: blank, a copy, or a starting point. */
		initialForm?: Partial<AutomationForm>;
	}>) {
	const { now } = shared;
	const binding = useBinding(shared, serverId, host);
	const ready = binding.state === 'ready' ? binding : undefined;
	const automation =
		automationId === undefined
			? undefined
			: ready?.data.automations.find(
					(candidate) => candidate.id === automationId,
				);
	// What the editor opened with is fixed the first time it can be known, so
	// a newer copy of the automation never replaces what is being typed.
	const [initial, setInitial] = useState<AutomationForm | undefined>(() =>
		automationId === undefined
			? { ...emptyAutomationForm(), ...initialForm }
			: undefined,
	);
	useEffect(() => {
		if (initial === undefined && automation !== undefined)
			setInitial(formFromAutomation(automation));
	}, [automation, initial]);
	useCloseWhenGone(
		host,
		{
			ready: ready !== undefined,
			present: automationId === undefined || automation !== undefined,
			version: ready?.data.automations,
			...(ready === undefined ? {} : { refresh: ready.data.refresh }),
		},
		'the automation was deleted',
	);
	const fallbackTitle =
		automationId === undefined ? 'New automation' : 'Edit automation';
	const [title, setTitle] = useState<string>();
	useTabTitle(host, title);
	const hostRef = useRef(host);
	hostRef.current = host;
	const handleChange = useCallback(
		(form: AutomationForm, dirty: boolean) => {
			const name = form.name.trim();
			setTitle(
				automationId === undefined
					? name || 'New automation'
					: `Edit ${name || 'automation'}`,
			);
			hostRef.current.setDirty(dirty);
		},
		[automationId],
	);
	useEffect(() => () => hostRef.current.setDirty(false), []);

	if (ready === undefined)
		return (
			<BindingPlaceholder binding={binding} host={host} title={fallbackTitle} />
		);
	if (initial === undefined) return null;

	const { data } = ready;
	const save = async (draft: AutomationDraft) => {
		const before = new Set(data.automations.map((existing) => existing.id));
		const state = await data.client.upsert(draft, {
			expectedRevision: data.revision,
		});
		const saved =
			draft.id === undefined
				? state.automations.find((candidate) => !before.has(candidate.id))
				: state.automations.find((candidate) => candidate.id === draft.id);
		data.refresh();
		host.setDirty(false);
		host.open(
			saved === undefined
				? { kind: 'list' }
				: { kind: 'automation', serverId, automationId: saved.id },
		);
		host.close();
	};

	return (
		<div className="home-section home-automations" data-terminay-automations>
			<AutomationEditor
				initial={initial}
				now={now}
				{...(data.timeZone === undefined ? {} : { timeZone: data.timeZone })}
				onCancel={host.requestClose}
				onChange={handleChange}
				onSave={save}
				renderHeader={(controls) => (
					<PageHeader
						title={title ?? fallbackTitle}
						{...(serverNote(shared, serverId) === undefined
							? {}
							: { subtitle: serverNote(shared, serverId) })}
					>
						{controls}
					</PageHeader>
				)}
				{...(ready.context?.applicationClient === undefined
					? {}
					: { applicationClient: ready.context.applicationClient })}
			/>
		</div>
	);
}

// --- One automation space terminal -------------------------------------------

export function AutomationTerminalPanel({
	data: shared,
	host,
	panelId,
	serverId,
}: PanelProps & Readonly<{ serverId: string; panelId: string }>) {
	const { now } = shared;
	const binding = useBinding(shared, serverId, host);
	const ready = binding.state === 'ready' ? binding : undefined;
	const { loaded, space } = useAutomationSpace(ready?.context);
	const { errorBanner, perform } = useActionError();
	const terminal = space?.terminals.find(
		(candidate) => candidate.panelId === panelId,
	);
	useTabTitle(host, terminal?.title);
	// The workspace snapshot is always current, so a terminal missing from it
	// is gone.
	const closeTabRef = useRef(host.close);
	closeTabRef.current = host.close;
	const terminalGone = ready !== undefined && loaded && terminal === undefined;
	useEffect(() => {
		if (terminalGone) closeTabRef.current('the terminal was closed');
	}, [terminalGone]);
	const group = useMemo(
		() =>
			groupSpaceTerminals(space?.terminals ?? [], ready?.data.runs ?? []).find(
				(candidate) =>
					candidate.terminals.some((item) => item.panelId === panelId),
			),
		[panelId, ready?.data.runs, space?.terminals],
	);
	// One terminal per tab: the inner host shows this terminal and no other.
	const shown = useMemo(
		() => (terminal === undefined ? [] : [terminal]),
		[terminal],
	);

	if (ready === undefined)
		return (
			<BindingPlaceholder
				binding={binding}
				host={host}
				title="Automation terminal"
			/>
		);
	if (
		terminal === undefined ||
		space === undefined ||
		ready.context === undefined
	)
		return null;

	const { context } = ready;
	// Closing the terminal is its own action; closing its tab only closes the
	// view of it.
	const closeTerminal = (target: string) =>
		void perform(async () => {
			await context.workspaceSnapshotStore?.closePanel(target);
		});
	const automationName =
		group?.run === undefined
			? undefined
			: (ready.data.automations.find(
					(candidate) => candidate.id === group.run?.automationId,
				)?.name ?? 'Deleted automation');

	return (
		<div
			className="home-section home-automations home-automations--terminal"
			data-terminay-automations
			data-terminay-automation-terminal-page={terminal.sessionId}
		>
			<PageHeader
				title={terminal.title}
				{...(host.compact ? { onBack: host.requestClose } : {})}
				subtitle={
					group?.run === undefined
						? 'Automation terminal'
						: `${automationName} · ${formatTime(group.run.startedAt, now)}`
				}
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
						terminals={shown}
						selectedPanelId={terminal.panelId}
						onSelect={() => undefined}
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
