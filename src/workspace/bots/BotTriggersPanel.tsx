import type {
	BotProfile,
	BotTrigger,
	BotTriggerFiring,
	BotUpcomingFiring,
} from '@terminay/protocol';
import { Plus, Zap } from 'lucide-react';
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
	sourceGroup,
	TRIGGER_KIND_LABELS,
	type TriggerKind,
	UPCOMING_DAYS,
} from './triggersModel';
import { useNow } from './useNow';
import { refusalText, type ServerBots } from './useServerBots';
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
	const editor = editing ? (
		<div className="bots-source-editor-wrap" hidden={editorHidden}>
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
	) : null;
	if (server.sourcesSupported === false)
		return (
			<div className="bots-cpad bots-note">
				Update this Terminay Server to configure container source triggers.
			</div>
		);
	return (
		<div className="bots-scroll bots-cpad" data-terminay-bot-panel="triggers">
			<div className="bots-trigpage">
				<div className="bots-toolbar">
					<div>
						<h3 className="bots-h3">Triggers</h3>
						<p className="bots-faint">
							Watch files, services and command results in this bot’s container.{' '}
							{triggers?.length ?? 0} of {MAX_TRIGGERS}.
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
				{upcoming.length ? (
					<section
						aria-label="Coming up"
						data-terminay-bot-upcoming-strip="true"
					>
						<h3 className="bots-lab">Coming up</h3>
						<div className="bots-nextstrip">
							{upcoming.slice(0, 5).map((f) => {
								const c = triggers?.find((t) => t.id === f.triggerId)?.condition
									.kind;
								return (
									<div
										className="bots-card bots-nextstrip__item"
										key={`${f.triggerId}:${f.at}`}
									>
										<span className="bots-mono">{formatWhen(f.at)}</span>
										<span>
											{f.triggerName}
											{c === 'http' || c === 'command' ? ' · check' : ''}
										</span>
									</div>
								);
							})}
						</div>
					</section>
				) : null}
				{triggers === undefined ? (
					<p className="bots-faint">Loading triggers…</p>
				) : !hasList ? (
					<>
						{showEditor ? null : (
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
										<h3 className="bots-h3">
											When something changes, ask your bot
										</h3>
										<p className="bots-faint">
											No triggers yet. Pick what to watch and {bot.name} gets a
											prompt, with the event attached, each time it fires.
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
												disabled={full}
												onClick={() => edit('new', kind)}
												data-terminay-bot-trigger-start={kind}
											>
												<span
													className="bots-trigstart__icon"
													aria-hidden="true"
												>
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
						)}
						{editor ? <div className="bots-source-solo">{editor}</div> : null}
					</>
				) : (
					<div className="bots-source-layout">
						<aside className="bots-source-list" aria-label="Trigger list">
							{Object.keys(SOURCE_GROUPS).map((group) => {
								const rows = triggers.filter(
									(t) => sourceGroup(t.condition.kind) === group,
								);
								if (!rows.length) return null;
								return (
									<section key={group}>
										<h4 className="bots-lab">
											{group} <span className="bots-faint">{rows.length}</span>
										</h4>
										<ul className="bots-source-rows">
											{rows.map((t) => {
												const fired = last.get(t.id);
												const health = t.health;
												const isSelected =
													editing !== 'new' && editing?.id === t.id;
												return (
													<li
														key={t.id}
														className={`bots-source-row${isSelected ? ' bots-source-row--selected' : ''}${t.enabled ? '' : ' bots-trow--off'}`}
														data-terminay-bot-trigger={t.id}
													>
														<button
															type="button"
															className="bots-source-row__select"
															aria-label={`Edit ${t.name}`}
															aria-current={isSelected ? 'true' : undefined}
															onClick={() => edit(t)}
														>
															<b>{t.name}</b>
															<span className="bots-faint">
																{TRIGGER_KIND_LABELS[t.condition.kind]} ·{' '}
																{t.unsupported ??
																	health?.state ??
																	(t.enabled ? 'Ready' : 'Disabled')}
															</span>
															<span className="bots-faint">
																{health?.lastAttempt
																	? `Checked ${shortAge(health.lastAttempt, now)}`
																	: describeCondition(t.condition)}
															</span>
														</button>
														{health?.error || health?.gap ? (
															<div className="bots-note bots-note--warn">
																{health.error}
																{health.gap ? <div>{health.gap}</div> : null}
																{health.error && t.enabled ? (
																	<button
																		type="button"
																		className="bots-link"
																		onClick={() =>
																			act(
																				server.client.retrySource(bot.id, t.id),
																			)
																		}
																	>
																		Retry
																	</button>
																) : null}
															</div>
														) : null}
														<div className="bots-source-row__meta">
															Last fired:{' '}
															{fired
																? `${FIRING_OUTCOME_LABELS[fired.outcome]} · ${shortAge(fired.firedAt, now)}${fired.reason ? ` · ${fired.reason}` : ''}`
																: 'never'}
														</div>
														{t.missedCount > 0 ? (
															<div
																className="bots-note bots-note--warn"
																data-terminay-bot-trigger-missed={t.missedCount}
															>
																{t.missedCount} missed occurrence
																{t.missedCount === 1 ? '' : 's'} ·{' '}
																{t.recovery ?? 'skip'}{' '}
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
															</div>
														) : null}
														<div className="bots-source-row__actions">
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
															<button
																type="button"
																className="bots-btn bots-btn--sm"
																disabled={
																	bot.enabled === false || !!t.unsupported
																}
																onClick={() =>
																	act(server.client.runTrigger(bot.id, t.id))
																}
																data-terminay-bot-trigger-run={t.id}
															>
																Run now
															</button>
															{confirmDelete === t.id ? (
																<>
																	<button
																		type="button"
																		className="bots-btn bots-btn--sm bots-btn--danger"
																		onClick={() => {
																			setConfirmDelete(undefined);
																			if (isSelected) setEditing(undefined);
																			act(
																				server.client.deleteTrigger(
																					bot.id,
																					t.id,
																				),
																			);
																		}}
																	>
																		Delete
																	</button>
																	<button
																		type="button"
																		className="bots-link"
																		onClick={() => setConfirmDelete(undefined)}
																	>
																		Cancel
																	</button>
																</>
															) : (
																<button
																	type="button"
																	className="bots-link"
																	aria-label={`Delete ${t.name}`}
																	onClick={() => setConfirmDelete(t.id)}
																>
																	Delete…
																</button>
															)}
														</div>
													</li>
												);
											})}
										</ul>
									</section>
								);
							})}
						</aside>
						{editor}
						{showEditor ? null : (
							<div className="bots-source-placeholder">
								<span className="bots-trigempty__badge" aria-hidden="true">
									<Zap size={18} />
								</span>
								<b>Select a trigger to edit it</b>
								<span className="bots-faint">
									Its source, recovery policy and prompt open here.
								</span>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
