import type {
	BotProfile,
	BotTrigger,
	BotTriggerFiring,
	BotUpcomingFiring,
} from '@terminay/protocol';
import { Play, Plus, Trash2, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	BotTriggerEditor,
	SOURCE_DESCRIPTIONS,
	sourceIcon,
} from './BotTriggerEditor';
import { shortAge } from './botsModel';
import {
	describeCondition,
	FIRING_OUTCOME_LABELS,
	lastFirings,
	MAX_TRIGGERS,
	SOURCE_GROUPS,
	TRIGGER_KIND_LABELS,
	type TriggerKind,
	UPCOMING_DAYS,
} from './triggersModel';
import { useNow } from './useNow';
import { refusalText, type ServerBots } from './useServerBots';

const HEALTH_LABELS: Readonly<Record<string, string>> = {
	disabled: 'Disabled',
	watching: 'Watching',
	connected: 'Connected',
	waiting: 'Waiting',
	checking: 'Checking',
	healthy: 'Healthy',
	retrying: 'Retrying',
	blocked: 'Blocked',
	failed: 'Failed',
};
const MISSED_POLICY: Readonly<Record<string, string>> = {
	skip: 'skipped',
	once: 'runs once',
	replay: 'replays each',
	'recover-available': 'recovering',
	'ignore-gap': 'gap ignored',
};
function statusOf(t: BotTrigger): { label: string; tone: string } {
	if (t.unsupported) return { label: 'Unsupported', tone: 'need' };
	if (!t.enabled) return { label: 'Disabled', tone: 'idle' };
	const state = t.health?.state;
	if (state === 'failed' || state === 'blocked')
		return { label: HEALTH_LABELS[state]!, tone: 'need' };
	if (state === 'retrying') return { label: 'Retrying', tone: 'work' };
	return {
		label: state ? (HEALTH_LABELS[state] ?? state) : 'Ready',
		tone: 'done',
	};
}
export function formatWhen(at: number): string {
	return new Date(at).toLocaleString(undefined, {
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
	});
}
export function BotTriggersPanel({
	server,
	bot,
}: Readonly<{ server: ServerBots; bot: BotProfile }>) {
	const now = useNow(60000);
	const [triggers, setTriggers] = useState<readonly BotTrigger[]>();
	const [firings, setFirings] = useState<readonly BotTriggerFiring[]>([]);
	const [upcoming, setUpcoming] = useState<readonly BotUpcomingFiring[]>([]);
	const [error, setError] = useState<string>();
	const [editing, setEditing] = useState<BotTrigger | 'new'>();
	const [newKind, setNewKind] = useState<TriggerKind>();
	// Closing keeps the editor mounted, so reopening the same trigger, or New
	// trigger again, returns to the unsaved draft.
	const [editorHidden, setEditorHidden] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState<string>();
	const load = useCallback(async () => {
		try {
			const from = Date.now();
			const [list, history, next] = await Promise.all([
				server.client.triggers(bot.id),
				server.client.triggerFirings(bot.id),
				server.client.upcomingTriggers(
					bot.id,
					from,
					from + UPCOMING_DAYS * 86400000,
					{ limit: 200 },
				),
			]);
			setTriggers(list.triggers);
			setFirings(history);
			setUpcoming(next.firings);
			setError(undefined);
		} catch (e) {
			setError(refusalText(e));
		}
	}, [server.client, bot.id]);
	useEffect(() => {
		void load();
	}, [load, server.revision]);
	const act = (work: Promise<unknown>) => {
		setError(undefined);
		void work.then(load).catch((e) => setError(refusalText(e)));
	};
	const last = useMemo(() => lastFirings(firings), [firings]);
	const edit = (trigger: BotTrigger | 'new', kind?: TriggerKind) => {
		setEditing(trigger);
		setNewKind(kind);
		setEditorHidden(false);
	};
	const full = (triggers?.length ?? 0) >= MAX_TRIGGERS;
	const hasList = (triggers?.length ?? 0) > 0;
	const showEditor = editing !== undefined && !editorHidden;
	const nextFor = useMemo(() => {
		const map = new Map<string, number>();
		for (const f of upcoming)
			if (!map.has(f.triggerId) || f.at < map.get(f.triggerId)!)
				map.set(f.triggerId, f.at);
		return map;
	}, [upcoming]);
	useEffect(() => {
		if (!showEditor) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !event.defaultPrevented)
				setEditorHidden(true);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [showEditor]);
	if (server.sourcesSupported === false)
		return (
			<div className="bots-cpad bots-note">
				Update this Terminay Server to configure container source triggers.
			</div>
		);
	return (
		<div className="bots-trigroot">
			<div className="bots-scroll bots-cpad" data-terminay-bot-panel="triggers">
				<div className="bots-trigpage">
					<div className="bots-toolbar">
						<div>
							<h3 className="bots-h3">Triggers</h3>
							<p className="bots-faint">
								Watch files, services and command results in this bot’s
								container. {triggers?.length ?? 0} of {MAX_TRIGGERS}.
							</p>
						</div>
						<button
							type="button"
							className="bots-btn bots-btn--primary bots-btn--icon"
							disabled={full}
							onClick={() => edit('new')}
							data-terminay-bot-trigger-new="true"
						>
							<Plus size={14} aria-hidden="true" /> New trigger
						</button>
					</div>
					{bot.enabled === false ? (
						<div className="bots-note bots-note--warn">
							Bot disabled. Sources and automatic wake-ups are paused.{' '}
							<button
								type="button"
								className="bots-link"
								onClick={() => act(server.client.enableBot(bot.id, true))}
							>
								Enable bot
							</button>
						</div>
					) : null}
					{error ? (
						<div className="bots-note bots-note--error" role="alert">
							{error}
						</div>
					) : null}
					{triggers === undefined ? (
						<p className="bots-faint">Loading triggers…</p>
					) : !hasList ? (
						<EmptyState
							botName={bot.name}
							disabled={full}
							onStart={(kind) => edit('new', kind)}
						/>
					) : (
						<>
							{upcoming.length ? (
								<section
									className="bots-nextline"
									aria-label="Coming up"
									data-terminay-bot-upcoming-strip="true"
								>
									<h3 className="bots-lab">Coming up</h3>
									<ol>
										{upcoming.slice(0, 5).map((f) => (
											<li key={`${f.triggerId}:${f.at}`}>
												<span className="bots-mono">{formatWhen(f.at)}</span>{' '}
												{f.triggerName}
											</li>
										))}
									</ol>
								</section>
							) : null}
							<div className="bots-trigtable-wrap">
								<table className="bots-trigtable" aria-label="Trigger list">
									<thead>
										<tr>
											<th scope="col">Trigger</th>
											<th scope="col">Status</th>
											<th scope="col" className="bots-trigtable__opt">
												Last checked
											</th>
											<th scope="col">Last fired</th>
											<th scope="col" className="bots-trigtable__opt">
												Next
											</th>
											<th scope="col">
												<span className="bots-sr">Enabled</span>
											</th>
											<th scope="col">
												<span className="bots-sr">Actions</span>
											</th>
										</tr>
									</thead>
									<tbody>
										{triggers.map((t) => {
											const fired = last.get(t.id);
											const health = t.health;
											const status = statusOf(t);
											const next = nextFor.get(t.id) ?? health?.nextCheck;
											const selected =
												showEditor && editing !== 'new' && editing?.id === t.id;
											return (
												<tr
													key={t.id}
													className={`bots-trigrow${selected ? ' bots-trigrow--selected' : ''}${t.enabled ? '' : ' bots-trigrow--off'}`}
													data-terminay-bot-trigger={t.id}
													onClick={(event) => {
														if (
															(event.target as HTMLElement).closest(
																'button,a,input,[role="switch"]',
															)
														)
															return;
														edit(t);
													}}
												>
													<td className="bots-trigrow__main">
														<div className="bots-trigrow__cell">
															<span
																className="bots-trigrow__icon"
																aria-hidden="true"
															>
																{sourceIcon(t.condition.kind)}
															</span>
															<span className="bots-grow">
																<button
																	type="button"
																	className="bots-trigrow__name"
																	aria-label={`Edit ${t.name}`}
																	aria-current={selected ? 'true' : undefined}
																	onClick={() => edit(t)}
																>
																	{t.name}
																</button>
																<span className="bots-trigrow__desc">
																	{TRIGGER_KIND_LABELS[t.condition.kind]} ·{' '}
																	{describeCondition(t.condition)}
																</span>
																{health?.error || health?.gap ? (
																	<span className="bots-trigrow__problem">
																		{health.error ?? health.gap}
																		{health.error && t.enabled ? (
																			<>
																				{' '}
																				<button
																					type="button"
																					className="bots-link"
																					onClick={() =>
																						act(
																							server.client.retrySource(
																								bot.id,
																								t.id,
																							),
																						)
																					}
																				>
																					Retry
																				</button>
																			</>
																		) : null}
																	</span>
																) : null}
															</span>
														</div>
													</td>
													<td>
														<span
															className={`bots-trigstatus bots-trigstatus--${status.tone}`}
														>
															{status.label}
														</span>
														{t.missedCount > 0 ? (
															<span
																className="bots-trigrow__missed"
																data-terminay-bot-trigger-missed={t.missedCount}
															>
																{t.missedCount} missed ·{' '}
																{MISSED_POLICY[t.recovery ?? 'skip'] ??
																	t.recovery}{' '}
																<button
																	type="button"
																	className="bots-link"
																	onClick={() =>
																		act(
																			server.client.dismissMissedTriggers(
																				bot.id,
																				t.id,
																			),
																		)
																	}
																>
																	Dismiss
																</button>
															</span>
														) : null}
													</td>
													<td className="bots-trigtable__opt bots-trigrow__when">
														{health?.lastAttempt
															? shortAge(health.lastAttempt, now)
															: '—'}
													</td>
													<td className="bots-trigrow__when">
														{fired ? (
															<>
																{FIRING_OUTCOME_LABELS[fired.outcome]}
																<span className="bots-faint">
																	{' '}
																	· {shortAge(fired.firedAt, now)}
																</span>
																{fired.reason ? (
																	<span className="bots-trigrow__desc">
																		{fired.reason}
																	</span>
																) : null}
															</>
														) : (
															<span className="bots-faint">Never</span>
														)}
													</td>
													<td className="bots-trigtable__opt bots-trigrow__when bots-mono">
														{next ? formatWhen(next) : '—'}
													</td>
													<td>
														<button
															type="button"
															role="switch"
															aria-checked={t.enabled}
															aria-label={`${t.enabled ? 'Disable' : 'Enable'} ${t.name}`}
															className="bots-toggle"
															disabled={!!t.unsupported}
															onClick={() =>
																act(
																	server.client.enableTrigger(
																		bot.id,
																		t.id,
																		!t.enabled,
																	),
																)
															}
														/>
													</td>
													<td className="bots-trigrow__actions">
														{confirmDelete === t.id ? (
															<>
																<button
																	type="button"
																	className="bots-btn bots-btn--sm bots-btn--danger"
																	onClick={() => {
																		setConfirmDelete(undefined);
																		if (
																			editing !== 'new' &&
																			editing?.id === t.id
																		)
																			setEditing(undefined);
																		act(
																			server.client.deleteTrigger(bot.id, t.id),
																		);
																	}}
																>
																	Delete
																</button>
																<button
																	type="button"
																	className="bots-iconbtn bots-iconbtn--sm"
																	aria-label="Cancel delete"
																	title="Cancel"
																	onClick={() => setConfirmDelete(undefined)}
																>
																	<X size={14} aria-hidden="true" />
																</button>
															</>
														) : (
															<>
																<button
																	type="button"
																	className="bots-btn bots-btn--sm bots-btn--icon"
																	disabled={
																		bot.enabled === false || !!t.unsupported
																	}
																	onClick={() =>
																		act(server.client.runTrigger(bot.id, t.id))
																	}
																	data-terminay-bot-trigger-run={t.id}
																>
																	<Play size={12} aria-hidden="true" /> Run now
																</button>
																<button
																	type="button"
																	className="bots-iconbtn bots-iconbtn--sm"
																	aria-label={`Delete ${t.name}`}
																	title="Delete"
																	onClick={() => setConfirmDelete(t.id)}
																>
																	<Trash2 size={14} aria-hidden="true" />
																</button>
															</>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						</>
					)}
				</div>
			</div>
			{editing ? (
				<div
					className="bots-trigsheet"
					hidden={editorHidden}
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setEditorHidden(true);
					}}
				>
					<div className="bots-trigsheet__panel">
						<BotTriggerEditor
							key={editing === 'new' ? `new:${newKind ?? ''}` : editing.id}
							server={server}
							bot={bot}
							initialKind={editing === 'new' ? newKind : undefined}
							trigger={
								editing === 'new'
									? undefined
									: (triggers?.find((t) => t.id === editing.id) ?? editing)
							}
							onClose={() => setEditorHidden(true)}
							onSaved={() => {
								setEditing(undefined);
								void load();
							}}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}

function EmptyState({
	botName,
	disabled,
	onStart,
}: Readonly<{
	botName: string;
	disabled: boolean;
	onStart: (kind: TriggerKind) => void;
}>) {
	return (
		<section
			className="bots-trigempty"
			aria-label="No triggers yet"
			data-terminay-bot-trigger-empty="true"
		>
			<div className="bots-trigempty__intro">
				<span className="bots-trigempty__badge" aria-hidden="true">
					<Zap size={18} />
				</span>
				<div>
					<h3 className="bots-h3">When something changes, ask your bot</h3>
					<p className="bots-faint">
						No triggers yet. Pick what to watch and {botName} gets a prompt,
						with the event attached, each time it fires.
					</p>
				</div>
			</div>
			<div className="bots-trigempty__grid">
				{Object.values(SOURCE_GROUPS)
					.flat()
					.map((kind) => (
						<button
							key={kind}
							type="button"
							className="bots-trigstart"
							disabled={disabled}
							onClick={() => onStart(kind)}
							data-terminay-bot-trigger-start={kind}
						>
							<span className="bots-trigstart__icon" aria-hidden="true">
								{sourceIcon(kind)}
							</span>
							<span className="bots-grow">
								<b>{TRIGGER_KIND_LABELS[kind]}</b>
								<span>{SOURCE_DESCRIPTIONS[kind]}</span>
							</span>
						</button>
					))}
			</div>
		</section>
	);
}
