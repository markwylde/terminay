/**
 * A bot's triggers: the list, the next seven days of firings, and the editor.
 */

import type {
	BotProfile,
	BotTrigger,
	BotTriggerFiring,
	BotUpcomingFiring,
} from '@terminay/protocol';
import { Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BotTriggerEditor } from './BotTriggerEditor';
import { shortAge } from './botsModel';
import {
	describeCondition,
	FIRING_OUTCOME_LABELS,
	lastFirings,
	MAX_TRIGGERS,
	nextFirings,
	TRIGGER_KIND_LABELS,
	UPCOMING_DAYS,
} from './triggersModel';
import { useNow } from './useNow';
import { refusalText, type ServerBots } from './useServerBots';

const DAY_MS = 24 * 60 * 60 * 1000;

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
	const now = useNow(60_000);
	const [triggers, setTriggers] = useState<readonly BotTrigger[]>();
	const [firings, setFirings] = useState<readonly BotTriggerFiring[]>([]);
	const [upcoming, setUpcoming] = useState<readonly BotUpcomingFiring[]>([]);
	const [error, setError] = useState<string>();
	const [editing, setEditing] = useState<BotTrigger | 'new'>();
	const [confirmDelete, setConfirmDelete] = useState<string>();
	const { client } = server;

	const load = useCallback(async () => {
		try {
			const from = Date.now();
			const [list, history, next] = await Promise.all([
				client.triggers(bot.id),
				client.triggerFirings(bot.id),
				client.upcomingTriggers(bot.id, from, from + UPCOMING_DAYS * DAY_MS, {
					limit: 200,
				}),
			]);
			setTriggers(list.triggers);
			setFirings(history);
			setUpcoming(next.firings);
			setError(undefined);
		} catch (cause) {
			setError(refusalText(cause));
		}
	}, [client, bot.id]);

	// Trigger edits and firings arrive as `bots.changed` for this bot, which
	// moves the projection's revision.
	useEffect(() => {
		void load();
	}, [load, server.revision]);

	const act = (work: Promise<unknown>) => {
		setError(undefined);
		work
			.then(() => load())
			.catch((cause: unknown) => setError(refusalText(cause)));
	};

	const last = useMemo(() => lastFirings(firings), [firings]);
	const next = useMemo(() => nextFirings(upcoming), [upcoming]);
	const count = triggers?.length ?? 0;

	return (
		<div className="bots-scroll bots-cpad" data-terminay-bot-panel="triggers">
			<div className="bots-trigpage">
				<div className="bots-toolbar">
					<div>
						<h3 className="bots-h3">Triggers</h3>
						<p className="bots-faint">
							Each trigger starts a new session with its prompt. {count} of{' '}
							{MAX_TRIGGERS}.
						</p>
					</div>
					<button
						type="button"
						className="bots-btn bots-btn--primary"
						disabled={count >= MAX_TRIGGERS}
						onClick={() => setEditing('new')}
						data-terminay-bot-trigger-new="true"
					>
						<Plus size={14} aria-hidden="true" /> New trigger
					</button>
				</div>
				{error ? (
					<div className="bots-note bots-note--error" role="alert">
						{error}
					</div>
				) : null}
				{upcoming.length > 0 ? (
					<section aria-label="Coming up" data-terminay-bot-upcoming-strip="true">
						<h3 className="bots-lab">Coming up</h3>
						<div className="bots-nextstrip">
							{upcoming.slice(0, 5).map((firing) => (
								<div
									className="bots-card bots-nextstrip__item"
									key={`${firing.triggerId}:${firing.at}`}
								>
									<span className="bots-mono">{formatWhen(firing.at)}</span>
									<span>{firing.triggerName}</span>
								</div>
							))}
						</div>
					</section>
				) : null}
				{triggers === undefined ? (
					<p className="bots-faint">Loading triggers…</p>
				) : triggers.length === 0 ? (
					<div className="bots-emptyc">
						<b>No triggers yet</b>
						<span>
							A trigger runs this bot on a schedule, or when something happens
							in Terminay.
						</span>
					</div>
				) : (
					<ul className="bots-trows">
						{triggers.map((trigger) => {
							const fired = last.get(trigger.id);
							const due = next.get(trigger.id);
							return (
								<li
									key={trigger.id}
									className={`bots-trow${trigger.enabled ? '' : ' bots-trow--off'}`}
									data-terminay-bot-trigger={trigger.id}
								>
									<button
										type="button"
										role="switch"
										aria-checked={trigger.enabled}
										aria-label={`${trigger.enabled ? 'Disable' : 'Enable'} ${trigger.name}`}
										className="bots-toggle"
										onClick={() =>
											act(
												client.enableTrigger(
													bot.id,
													trigger.id,
													!trigger.enabled,
												),
											)
										}
									/>
									<div className="bots-trow__body">
										<div className="bots-trow__title">
											<b>{trigger.name}</b>
											<span className="bots-tag">
												{TRIGGER_KIND_LABELS[trigger.condition.kind]}
											</span>
										</div>
										<div className="bots-trow__desc">
											{describeCondition(trigger.condition)}
										</div>
										<div className="bots-trow__prompt">{trigger.prompt}</div>
										<div className="bots-trow__meta">
											<span>
												Last:{' '}
												{fired === undefined
													? 'never'
													: `${FIRING_OUTCOME_LABELS[fired.outcome]} · ${shortAge(fired.firedAt, now)}${fired.reason ? ` · ${fired.reason}` : ''}`}
											</span>
											<span>
												Next:{' '}
												{due === undefined
													? trigger.enabled
														? '—'
														: 'disabled'
													: formatWhen(due)}
											</span>
										</div>
										{trigger.missedCount > 0 ? (
											<div
												className="bots-note bots-note--warn"
												data-terminay-bot-trigger-missed={trigger.missedCount}
											>
												Missed {trigger.missedCount} firing
												{trigger.missedCount === 1 ? '' : 's'} while the server
												was off.{' '}
												<button
													type="button"
													className="bots-link"
													onClick={() =>
														act(
															client.dismissMissedTriggers(bot.id, trigger.id),
														)
													}
												>
													Dismiss
												</button>
											</div>
										) : null}
									</div>
									<div className="bots-trow__actions">
										<button
											type="button"
											className="bots-btn bots-btn--sm"
											onClick={() => act(client.runTrigger(bot.id, trigger.id))}
											data-terminay-bot-trigger-run={trigger.id}
										>
											<Play size={12} aria-hidden="true" /> Run now
										</button>
										<button
											type="button"
											className="bots-icon-btn"
											aria-label={`Edit ${trigger.name}`}
											onClick={() => setEditing(trigger)}
										>
											<Pencil size={14} aria-hidden="true" />
										</button>
										{confirmDelete === trigger.id ? (
											<button
												type="button"
												className="bots-btn bots-btn--sm bots-btn--danger"
												onClick={() => {
													setConfirmDelete(undefined);
													act(client.deleteTrigger(bot.id, trigger.id));
												}}
											>
												Delete
											</button>
										) : (
											<button
												type="button"
												className="bots-icon-btn"
												aria-label={`Delete ${trigger.name}`}
												onClick={() => setConfirmDelete(trigger.id)}
											>
												<Trash2 size={14} aria-hidden="true" />
											</button>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
			{editing === undefined ? null : (
				<BotTriggerEditor
					server={server}
					bot={bot}
					trigger={editing === 'new' ? undefined : editing}
					onClose={() => setEditing(undefined)}
					onSaved={() => {
						setEditing(undefined);
						void load();
					}}
				/>
			)}
		</div>
	);
}
