/**
 * Home's Automations section.
 *
 * Automations are server-owned, workspace-wide trigger → action rules. The
 * section shows one server's at a time — the one the window works in unless a
 * person picks another — and never merges two servers' lists. From here a
 * person creates, edits, duplicates, enables, disables, deletes, and runs
 * automations, reads each one's run history, and works with the terminals the
 * automation space holds.
 */

import type {
	AutomationDefinition,
	AutomationDraft,
	AutomationRunEntry,
} from '@terminay/client-core';
import { Play, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

type Pane =
	| Readonly<{ kind: 'none' }>
	| Readonly<{ kind: 'automation'; automationId: string; runId?: string }>
	| Readonly<{ kind: 'edit'; form: AutomationForm }>;

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
		>
			{outcome.label}
		</span>
	);
}

function RunDetail({
	context,
	onStop,
	run,
	now,
}: Readonly<{
	context?: WorkspaceConnectionContext;
	run: AutomationRunEntry;
	now: number;
	onStop: (runId: string) => void;
}>) {
	const [revealError, setRevealError] = useState<string>();
	return (
		<section
			className="automations-run-detail"
			data-terminay-automation-run-detail={run.runId}
			aria-label="Run detail"
		>
			<dl className="automations-run-detail__facts">
				<dt>Outcome</dt>
				<dd>
					<OutcomeBadge run={run} />
				</dd>
				<dt>Started</dt>
				<dd>
					{formatTime(run.startedAt, now)} ·{' '}
					{run.startedBy === 'user' ? 'by you' : 'by its trigger'}
				</dd>
				<dt>Exit code</dt>
				<dd data-terminay-automation-run-exit-code="true">
					{run.exitCode ?? '—'}
				</dd>
				<dt>Duration</dt>
				<dd>{formatDuration(run.durationMs)}</dd>
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
						<dt>Suppressed</dt>
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
			{revealError === undefined ? null : (
				<p className="automations-error" role="alert">
					{revealError}
				</p>
			)}
			<h4 className="automations-subheading">Output</h4>
			{run.outputTail === undefined || run.outputTail.length === 0 ? (
				<p className="automations-muted">
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
	const [pane, setPane] = useState<Pane>({ kind: 'none' });
	const [actionError, setActionError] = useState<string>();
	const [confirmingDelete, setConfirmingDelete] = useState<string>();
	const [choosingSubject, setChoosingSubject] = useState<string>();
	const [subjectSessionId, setSubjectSessionId] = useState('');
	const [selectedTerminal, setSelectedTerminal] = useState<string>();

	// A request from the overview picks the server, then what to show on it.
	useEffect(() => {
		if (focus === undefined) return;
		const { target } = focus;
		setActionError(undefined);
		switch (target.kind) {
			case 'list':
				setPane({ kind: 'none' });
				return;
			case 'create':
				setPane({ kind: 'edit', form: emptyAutomationForm() });
				return;
			case 'automation':
				setRequestedServer(target.serverId);
				setPane({ kind: 'automation', automationId: target.automationId });
				return;
			case 'run':
				setRequestedServer(target.serverId);
				setPane({
					kind: 'automation',
					automationId: target.automationId,
					runId: target.runId,
				});
				return;
		}
	}, [focus]);

	const selectServer = (next: string) => {
		setRequestedServer(next);
		setPane({ kind: 'none' });
		setActionError(undefined);
	};

	const list = data?.automations ?? [];
	const runs = data?.runs ?? [];
	const latest = useMemo(() => latestRuns(runs), [runs]);
	const selectedAutomation =
		pane.kind === 'automation'
			? list.find((automation) => automation.id === pane.automationId)
			: undefined;
	const history = useMemo(
		() =>
			selectedAutomation === undefined
				? []
				: runs.filter((run) => run.automationId === selectedAutomation.id),
		[runs, selectedAutomation],
	);
	const selectedRun =
		pane.kind === 'automation'
			? (history.find((run) => run.runId === pane.runId) ?? undefined)
			: undefined;
	// Running terminals mount as live terminals. A kept terminal whose process
	// exited has nothing to type into; it is shown read-only on its own, with
	// its retained output, until a person closes it.
	const liveTerminals = useMemo(
		() =>
			(space?.terminals ?? []).filter(
				(terminal) => terminal.status === 'running',
			),
		[space?.terminals],
	);
	const shownExitedTerminal = useMemo(() => {
		const exited = (space?.terminals ?? []).filter(
			(terminal) => terminal.status !== 'running',
		);
		return (
			exited.find((terminal) => terminal.panelId === selectedTerminal) ??
			(liveTerminals.some((terminal) => terminal.panelId === selectedTerminal)
				? undefined
				: liveTerminals.length === 0
					? exited[0]
					: undefined)
		);
	}, [liveTerminals, selectedTerminal, space?.terminals]);
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
		setPane(
			saved === undefined
				? { kind: 'none' }
				: { kind: 'automation', automationId: saved.id },
		);
	};

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
			setPane({
				kind: 'automation',
				automationId: automation.id,
				runId: run.runId,
			});
		});

	const closeTerminal = (panelId: string) =>
		void perform(async () => {
			await context?.workspaceSnapshotStore?.closePanel(panelId);
		});

	const renderDetail = () => {
		if (data === undefined) return null;
		if (pane.kind === 'edit')
			return (
				<AutomationEditor
					key={pane.form.id ?? 'new'}
					initial={pane.form}
					now={now}
					{...(data.timeZone === undefined ? {} : { timeZone: data.timeZone })}
					onCancel={() =>
						setPane(
							pane.form.id === undefined
								? { kind: 'none' }
								: { kind: 'automation', automationId: pane.form.id },
						)
					}
					onSave={save}
					{...(context?.applicationClient === undefined
						? {}
						: { applicationClient: context.applicationClient })}
				/>
			);
		if (selectedAutomation === undefined)
			return (
				<div className="automations-placeholder">
					<p className="automations-muted">
						{list.length === 0
							? 'Automations run a command, a Macro, or some text on a schedule or when something happens in your workspace.'
							: 'Choose an automation to see its runs.'}
					</p>
					{list.length === 0 ? (
						<button
							type="button"
							className="automations-button automations-button--primary"
							onClick={() =>
								setPane({ kind: 'edit', form: emptyAutomationForm() })
							}
						>
							Create an automation
						</button>
					) : null}
				</div>
			);
		const automation = selectedAutomation;
		const next = nextRunAt(automation, now, data?.timeZone);
		const needsSubject = hasTerminalSubject(automation.trigger) &&
			automation.action.kind !== 'runCommand';
		return (
			<section
				className="automations-detail"
				data-terminay-automation-detail={automation.id}
				aria-label={automation.name}
			>
				<header className="automations-detail__header">
					<div className="automations-detail__heading">
						<h3 className="automations-detail__title">{automation.name}</h3>
						<p className="automations-muted">
							{describeTrigger(automation.trigger)} ·{' '}
							{ACTION_LABELS[automation.action.kind]}
							{automation.action.kind === 'runCommand' ? (
								<>
									{': '}
									<code>{automation.action.command}</code>
								</>
							) : null}
						</p>
						<p className="automations-muted">
							{automation.enabled
								? next === undefined
									? 'Enabled'
									: `Enabled · next run ${formatTime(next, now)}`
								: 'Disabled'}
						</p>
					</div>
					<div className="automations-detail__actions">
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
							<Play size={13} aria-hidden="true" /> Run now
						</button>
						<button
							type="button"
							className="automations-button"
							onClick={() =>
								setPane({ kind: 'edit', form: formFromAutomation(automation) })
							}
						>
							Edit
						</button>
						<button
							type="button"
							className="automations-button"
							onClick={() =>
								setPane({
									kind: 'edit',
									form: formFromAutomation(automation, true),
								})
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
					</div>
				</header>
				{confirmingDelete === automation.id ? (
					<div
						className="automations-confirm"
						role="alertdialog"
						aria-label="Delete automation"
					>
						<p>
							Delete “{automation.name}”? Runs already in progress keep going.
						</p>
						<button
							type="button"
							className="automations-button automations-button--danger"
							data-terminay-automation-confirm-delete="true"
							onClick={() =>
								void perform(async () => {
									await data.client.remove(automation.id, {
										expectedRevision: data.revision,
									});
									setConfirmingDelete(undefined);
									setPane({ kind: 'none' });
									data.refresh();
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
					<div className="automations-confirm" data-terminay-automation-subject-chooser>
						{subjects.length === 0 ? (
							<p>This automation acts on a terminal, and there is none open.</p>
						) : (
							<>
								<label className="automations-inline-field">
									Run on
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
				<div className="automations-detail__runs">
					<section className="automations-history" aria-label="Run history">
						<h4 className="automations-subheading">Runs</h4>
						{history.length === 0 ? (
							<p className="automations-muted">No runs yet.</p>
						) : (
							<ul className="automations-history__list">
								{history.map((run) => (
									<li key={run.runId}>
										<button
											type="button"
											className={`automations-history__row${run.runId === selectedRun?.runId ? ' automations-history__row--selected' : ''}`}
											aria-current={run.runId === selectedRun?.runId}
											data-terminay-automation-run={run.runId}
											onClick={() =>
												setPane({
													kind: 'automation',
													automationId: automation.id,
													runId: run.runId,
												})
											}
										>
											<OutcomeBadge run={run} />
											<span className="automations-history__time">
												{formatTime(run.startedAt, now)}
											</span>
											<span className="automations-muted">
												{run.startedBy === 'user' ? 'Run by you' : 'Triggered'}
											</span>
										</button>
									</li>
								))}
							</ul>
						)}
					</section>
					{selectedRun === undefined ? null : (
						<RunDetail
							run={selectedRun}
							now={now}
							onStop={(runId) =>
								void perform(() => data.client.stop(runId))
							}
							{...(context === undefined ? {} : { context })}
						/>
					)}
				</div>
			</section>
		);
	};

	return (
		<div className="home-section home-automations" data-terminay-automations>
			<header className="home-section__header home-automations__header">
				<div>
					<h2 className="home-section__heading">Automations</h2>
					<p className="home-section__subheading">
						Rules that run on a schedule or when something happens in your
						workspace.
					</p>
				</div>
				<div className="home-automations__toolbar">
					{selection.showsSelector ? (
						<label className="server-selector home-automations__server">
							<span className="server-selector__label">Server</span>
							<select
								className="server-selector__select automation-editor__input"
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
					) : null}
					{data === undefined ? null : (
						<>
							<button
								type="button"
								className="automations-button automations-button--icon"
								aria-label="Refresh automations"
								title="Refresh"
								onClick={data.refresh}
							>
								<RefreshCw size={13} aria-hidden="true" />
							</button>
							<button
								type="button"
								className="automations-button automations-button--primary"
								data-terminay-automation-new="true"
								onClick={() => {
									setActionError(undefined);
									setPane({ kind: 'edit', form: emptyAutomationForm() });
								}}
							>
								<Plus size={13} aria-hidden="true" /> New automation
							</button>
						</>
					)}
				</div>
			</header>

			{selection.selected === undefined ? (
				<div
					className="automations-placeholder"
					data-terminay-automations-unsupported="true"
				>
					<p>
						{selection.unsupported.length === 0
							? 'Automations appear here once a server is connected.'
							: `${selection.unsupported.map((choice) => choice.label).join(', ')} ${selection.unsupported.length === 1 ? 'does' : 'do'} not support automations. Update Terminay Server there to use them.`}
					</p>
				</div>
			) : data === undefined || data.status === 'loading' ? (
				<p className="automations-placeholder automations-muted" role="status">
					Loading automations…
				</p>
			) : data.status === 'error' ? (
				<div className="automations-placeholder" role="alert">
					<p>{data.error ?? 'This server’s automations are unavailable.'}</p>
					<button type="button" className="automations-button" onClick={data.refresh}>
						Try again
					</button>
				</div>
			) : (
				<>
					{selection.unsupported.length > 0 ? (
						<p className="automations-note" data-terminay-automations-unsupported-note>
							{selection.unsupported.map((choice) => choice.label).join(', ')}{' '}
							{selection.unsupported.length === 1 ? 'does' : 'do'} not support
							automations.
						</p>
					) : null}
					{actionError === undefined ? null : (
						<p
							className="automations-error"
							role="alert"
							data-terminay-automation-action-error="true"
						>
							{actionError}
						</p>
					)}
					<div className="home-automations__body">
						<section className="automations-list" aria-label="Automations">
							{list.length === 0 ? (
								<p className="automations-muted automations-list__empty">
									No automations yet.
								</p>
							) : (
								<ul className="automations-list__items">
									{list.map((automation) => {
										const next = nextRunAt(automation, now, data?.timeZone);
										const last = latest.get(automation.id);
										const selected =
											(pane.kind === 'automation' &&
												pane.automationId === automation.id) ||
											(pane.kind === 'edit' && pane.form.id === automation.id);
										return (
											<li
												key={automation.id}
												className={`automations-row${selected ? ' automations-row--selected' : ''}${automation.enabled ? '' : ' automations-row--disabled'}`}
												data-terminay-automation-row={automation.id}
											>
												<button
													type="button"
													className="automations-row__main"
													aria-current={selected}
													onClick={() => {
														setActionError(undefined);
														setPane({
															kind: 'automation',
															automationId: automation.id,
														});
													}}
												>
													<span
														className="automations-row__name"
														data-terminay-automation-name="true"
													>
														{automation.name}
													</span>
													<span
														className="automations-row__trigger"
														data-terminay-automation-trigger="true"
													>
														{describeTrigger(automation.trigger)}
													</span>
													<span className="automations-row__meta">
														{next === undefined ? null : (
															<span data-terminay-automation-next-run="true">
																Next {formatTime(next, now)}
															</span>
														)}
														{last === undefined ? (
															<span className="automations-muted">Never run</span>
														) : (
															<OutcomeBadge run={last} />
														)}
													</span>
												</button>
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
														onChange={(event) => {
															const enabled = event.target.checked;
															void perform(async () => {
																await data.client.setEnabled(
																	automation.id,
																	enabled,
																	{ expectedRevision: data.revision },
																);
																data.refresh();
															});
														}}
													/>
													<span aria-hidden="true" className="automations-switch__track" />
												</label>
											</li>
										);
									})}
								</ul>
							)}
						</section>
						<div className="automations-pane">{renderDetail()}</div>
					</div>

					<section
						className="automations-terminals"
						aria-label="Automation terminals"
						data-terminay-automation-terminals="true"
					>
						<h3 className="automations-subheading">Automation terminals</h3>
						{space === undefined || space.terminals.length === 0 ? (
							<p className="automations-muted">
								Terminals that automations open appear here. They are not
								part of any project.
							</p>
						) : (
							<div className="automations-terminals__layout">
								<ul className="automations-terminals__groups">
									{groups.map((group) => (
										<li
											key={group.run?.runId ?? 'unowned'}
											className="automations-terminals__group"
											data-terminay-automation-terminal-group={
												group.run?.runId ?? 'other'
											}
										>
											<p className="automations-terminals__group-title">
												{group.run === undefined
													? 'Other automation terminals'
													: `${automationName(group.run.automationId)} · ${formatTime(group.run.startedAt, now)}`}
											</p>
											<ul className="automations-terminals__items">
												{group.terminals.map((terminal) => (
													<li
														key={terminal.panelId}
														className={`automations-terminals__item${selectedTerminal === terminal.panelId ? ' automations-terminals__item--selected' : ''}`}
														data-terminay-automation-terminal={terminal.sessionId}
													>
														<button
															type="button"
															className="automations-terminals__open"
															onClick={() => setSelectedTerminal(terminal.panelId)}
														>
															{terminal.title}
															<span className="automations-muted">
																{terminal.status === 'running' ? 'Running' : 'Exited'}
															</span>
														</button>
														<button
															type="button"
															className="automations-button automations-button--quiet"
															aria-label={`Close ${terminal.title}`}
															onClick={() => closeTerminal(terminal.panelId)}
														>
															Close
														</button>
													</li>
												))}
											</ul>
										</li>
									))}
								</ul>
								{context === undefined || serverId === undefined ? null : (
									<div className="automations-terminals__views">
										{shownExitedTerminal === undefined ? null : (
											<ExitedAutomationTerminalView
												key={shownExitedTerminal.panelId}
												context={context}
												serverId={serverId}
												projectId={space.projectId}
												terminal={shownExitedTerminal}
												onClose={closeTerminal}
											/>
										)}
										{liveTerminals.length === 0 ? null : (
											// Kept mounted while an exited terminal is shown, so the
											// live terminals stay attached.
											<div
												className="automations-terminals__live"
												hidden={shownExitedTerminal !== undefined}
											>
												<AutomationTerminalView
													context={context}
													serverId={serverId}
													projectId={space.projectId}
													projectRoot={space.root}
													terminals={liveTerminals}
													onSelect={setSelectedTerminal}
													onClose={closeTerminal}
													{...(selectedTerminal === undefined
														? {}
														: { selectedPanelId: selectedTerminal })}
												/>
											</div>
										)}
									</div>
								)}
							</div>
						)}
					</section>
				</>
			)}
		</div>
	);
}
