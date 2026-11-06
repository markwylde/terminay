import { PermissionPrompt } from './BotPermissionPrompt';
/**
 * A bot's sessions: filter, search, and read any of them, with Stop on a
 * running execution. Completed executions remain diagnostic records.
 */

import type {
	BotProfile,
	BotSessionRecord,
	BotSessionState,
} from '@terminay/protocol';
import { Search, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BotTranscript } from './BotTranscript';
import { formatWhen } from './BotTriggersPanel';
import { SESSION_STATE_LABELS, sessionTitle, shortAge } from './botsModel';
import { foldTranscript } from './transcriptModel';
import { useBotSession } from './useBotSession';
import { useNow } from './useNow';
import { refusalText, type ServerBots } from './useServerBots';

type OriginFilter = 'all' | 'chat' | 'trigger' | 'run-now';
/** The trigger a Sessions list is filtered to, named as it was when chosen. */
export type SessionsTrigger = Readonly<{ id: string; name: string }>;
type OutcomeFilter = 'all' | BotSessionState;

const ORIGIN_LABELS: Readonly<Record<OriginFilter, string>> = {
	all: 'Any origin',
	chat: 'Chat',
	trigger: 'Trigger',
	'run-now': 'Run now',
};
const OUTCOMES: readonly OutcomeFilter[] = [
	'all',
	'running',
	'needs-you',
	'queued',
	'suspended',
	'completed',
	'stopped',
	'timed-out',
	'failed',
	'interrupted',
];

export function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function BotSessionsPanel({
	server,
	bot,
	onOpenInChat,
	selectedId,
	trigger,
	onClearTrigger,
}: Readonly<{
	selectedId?: string;
	trigger?: SessionsTrigger;
	onClearTrigger?: () => void;
	server: ServerBots;
	bot: BotProfile;
	onOpenInChat: (sessionId: string) => void;
}>) {
	const now = useNow();
	const [origin, setOrigin] = useState<OriginFilter>('all');
	const [outcome, setOutcome] = useState<OutcomeFilter>('all');
	const [search, setSearch] = useState('');
	const [query, setQuery] = useState('');
	const [list, setList] = useState<readonly BotSessionRecord[]>();
	const [selected, setSelected] = useState<string>();
	useEffect(() => {
		if (selectedId) setSelected(selectedId);
	}, [selectedId]);
	// Applying a trigger filter selects the newest of that trigger's sessions.
	const triggerId = trigger?.id;
	useEffect(() => {
		if (triggerId !== undefined) setSelected(undefined);
	}, [triggerId]);
	const [error, setError] = useState<string>();
	const recent = server.sessions.get(bot.id);

	useEffect(() => {
		const timer = setTimeout(() => setQuery(search.trim()), 250);
		return () => clearTimeout(timer);
	}, [search]);

	// The projection's recent sessions move on every change to this bot.
	useEffect(() => {
		let live = true;
		server.client
			.sessions(bot.id, {
				...(origin === 'all' ? {} : { origin }),
				...(outcome === 'all' ? {} : { state: outcome }),
				...(query === '' ? {} : { search: query }),
				...(triggerId === undefined ? {} : { triggerId }),
			})
			.then((sessions) => {
				if (!live) return;
				setList([...sessions].sort((a, b) => b.startedAt - a.startedAt));
				setError(undefined);
			})
			.catch((cause: unknown) => {
				if (live) setError(refusalText(cause));
			});
		return () => {
			live = false;
		};
	}, [server.client, bot.id, origin, outcome, query, triggerId, recent]);

	const record =
		list?.find((s) => s.id === selected) ?? (selected ? undefined : list?.[0]);

	return (
		<div className="bots-sesswrap" data-terminay-bot-panel="sessions">
			<div className="bots-slist">
				<div className="bots-stool">
					<label className="bots-filter-input">
						<Search size={14} aria-hidden="true" />
						<span className="bots-sr">Search sessions</span>
						<input
							value={search}
							placeholder="Search sessions…"
							onChange={(event) => setSearch(event.target.value)}
							data-terminay-bot-sessions-search="true"
						/>
					</label>
					<div className="bots-two">
						<select
							className="bots-in"
							aria-label="Origin"
							value={origin}
							onChange={(event) =>
								setOrigin(event.target.value as OriginFilter)
							}
							data-terminay-bot-sessions-origin="true"
						>
							{(Object.keys(ORIGIN_LABELS) as OriginFilter[]).map((key) => (
								<option key={key} value={key}>
									{ORIGIN_LABELS[key]}
								</option>
							))}
						</select>
						<select
							className="bots-in"
							aria-label="Outcome"
							value={outcome}
							onChange={(event) =>
								setOutcome(event.target.value as OutcomeFilter)
							}
							data-terminay-bot-sessions-outcome="true"
						>
							{OUTCOMES.map((key) => (
								<option key={key} value={key}>
									{key === 'all' ? 'Any outcome' : SESSION_STATE_LABELS[key]}
								</option>
							))}
						</select>
					</div>
					{trigger ? (
						<div
							className="bots-filterchip"
							data-terminay-bot-sessions-trigger={trigger.id}
						>
							<span className="bots-filterchip__label">
								Trigger: <b>{trigger.name}</b>
							</span>
							<button
								type="button"
								className="bots-iconbtn bots-iconbtn--sm"
								aria-label={`Show sessions from every trigger, not only ${trigger.name}`}
								title="Clear trigger filter"
								onClick={onClearTrigger}
								data-terminay-bot-sessions-trigger-clear="true"
							>
								<X size={12} aria-hidden="true" />
							</button>
						</div>
					) : null}
				</div>
				<div className="bots-scroll bots-slist__rows">
					{error ? (
						<div className="bots-note bots-note--error">{error}</div>
					) : null}
					{list === undefined ? (
						<p className="bots-faint bots-pad">Loading sessions…</p>
					) : list.length === 0 ? (
						<p className="bots-faint bots-pad">No sessions match.</p>
					) : (
						list.map((s) => (
							<button
								key={s.id}
								type="button"
								className={`bots-srow${s.id === record?.id ? ' bots-srow--on' : ''}`}
								onClick={() => setSelected(s.id)}
								data-terminay-bot-session-row={s.id}
								data-terminay-bot-session-state={s.state}
							>
								<span
									className={`bots-sicon bots-state--${s.state}`}
									title={SESSION_STATE_LABELS[s.state]}
								>
									{STATE_GLYPHS[s.state]}
								</span>
								<span className="bots-srow__body">
									<span className="bots-stitle">{sessionTitle(s)}</span>
									<span className="bots-smeta">
										<span className="bots-tchip">
											{ORIGIN_CHIPS[s.origin.kind]}
										</span>
										<span>
											{s.durationMs > 0
												? `${formatDuration(s.durationMs)} · `
												: ''}
											{shortAge(s.startedAt, now)} ago
										</span>
									</span>
								</span>
							</button>
						))
					)}
				</div>
			</div>
			<div className="bots-sdetail bots-scroll">
				{record === undefined ? (
					<div className="bots-placeholder">
						<span>Choose a session to read it.</span>
					</div>
				) : (
					<SessionDetail
						key={record.id}
						server={server}
						bot={bot}
						record={record}
						onOpenInChat={onOpenInChat}
					/>
				)}
			</div>
		</div>
	);
}

const STATE_GLYPHS: Readonly<Record<BotSessionRecord['state'], string>> = {
	completed: '✓',
	failed: '✕',
	interrupted: '!',
	'needs-you': '!',
	queued: '●',
	running: '●',
	stopped: '–',
	suspended: '–',
	'timed-out': '✕',
};
const ORIGIN_CHIPS: Readonly<
	Record<BotSessionRecord['origin']['kind'], string>
> = {
	chat: 'Message',
	'run-now': 'Manual',
	trigger: 'Trigger',
};

function SessionDetail({
	server,
	bot,
	record,
	onOpenInChat,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	record: BotSessionRecord;
	onOpenInChat: (sessionId: string) => void;
}>) {
	const { session, error: readError } = useBotSession(server, bot.id, record);
	const items = useMemo(
		() => foldTranscript(session?.updates ?? []),
		[session],
	);
	const [error, setError] = useState<string>();
	const running = record.state === 'running' || record.state === 'needs-you';

	const act = (work: Promise<unknown>, then?: () => void) => {
		setError(undefined);
		work
			.then(() => {
				server.refreshBot(bot.id);
				then?.();
			})
			.catch((cause: unknown) => setError(refusalText(cause)));
	};
	const origin =
		record.origin.kind === 'chat'
			? 'Chat'
			: `${record.origin.kind === 'run-now' ? 'Run now' : 'Trigger'} · ${record.origin.triggerName}`;
	return (
		<div data-terminay-bot-session={record.id}>
			<div className="bots-toolbar bots-sdetail__head">
				<div className="bots-grow">
					<h3 className="bots-sdetail__title">{sessionTitle(record)}</h3>
					<div className="bots-sdetail__sub">
						<span className={`bots-state bots-state--${record.state}`}>
							{STATE_GLYPHS[record.state]} {SESSION_STATE_LABELS[record.state]}
						</span>
						<span className="bots-faint">
							{origin} · {formatWhen(record.startedAt)} ·{' '}
							{formatDuration(record.durationMs)}
						</span>
					</div>
				</div>
				<div className="bots-row-actions">
					{running ? (
						<button
							type="button"
							className="bots-btn bots-btn--sm bots-btn--danger"
							onClick={() =>
								act(server.client.control(bot.id, record.id, 'stop'))
							}
							data-terminay-bot-session-stop="true"
						>
							<Square size={12} aria-hidden="true" /> Stop
						</button>
					) : null}
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						onClick={() => onOpenInChat(record.id)}
					>
						Back to messages
					</button>
				</div>
			</div>

			<p className="bots-note" data-terminay-bot-session-lifetime="true">
				Stop ends this execution and its commands. Desktop apps stay open,
				including unsaved workbooks. Stopping the bot container ends desktop
				apps.
			</p>

			{record.state === 'interrupted' ? (
				<div className="bots-note bots-note--warn">
					The server restarted during this session. Its execution commands were
					ended and its transcript is kept up to the last saved update.
					{record.recoveryMayHaveLostUpdates
						? ' Some of the latest updates may be missing.'
						: ''}
				</div>
			) : null}
			{record.state === 'suspended' ? (
				<div className="bots-note">
					Paused so other work could run. The next message resumes it.
				</div>
			) : null}
			{error ? <div className="bots-note bots-note--error">{error}</div> : null}
			<div className="bots-metagrid" data-terminay-bot-session-meta="true">
				<div>
					<span>Trigger</span>
					<b>{origin}</b>
				</div>
				<div>
					<span>Agent</span>
					<b>
						{server.agents.find((a) => a.id === record.snapshot.agentId)
							?.displayName ?? record.snapshot.agentId}
					</b>
				</div>
				<div>
					<span>Model</span>
					<b>{record.snapshot.modelId ?? 'Default'}</b>
				</div>
				<div>
					<span>Duration</span>
					<b>{formatDuration(record.durationMs)}</b>
				</div>
				<div>
					<span>Session</span>
					<b className="bots-mono" title={record.id}>
						{record.id.slice(0, 12)}
					</b>
				</div>
			</div>
			{record.permission ? (
				<PermissionPrompt
					permission={record.permission}
					onDecide={(optionId) =>
						act(
							server.client.decide(
								bot.id,
								record.id,
								record.permission!.id,
								optionId,
							),
						)
					}
				/>
			) : null}
			{record.reason ? (
				<p className="bots-note bots-note--warn">Reason: {record.reason}</p>
			) : null}
			<h4 className="bots-lab bots-sdetail__txlab">Transcript</h4>
			<div className="bots-sdetail__tx">
				{readError ? (
					<div className="bots-note bots-note--error">{readError}</div>
				) : null}
				{session === undefined ? (
					<p className="bots-faint">Loading transcript…</p>
				) : items.length === 0 ? (
					<p className="bots-faint">No messages.</p>
				) : (
					<BotTranscript
						transport={server.transport}
						items={items}
						bot={bot}
						active={
							session.state === 'running' || session.state === 'needs-you'
						}
					/>
				)}
			</div>
			<details className="bots-runner" data-terminay-bot-runner="true">
				<summary>Runner output</summary>
				<pre className="bots-tool__out bots-mono">
					{record.runnerOutput.length === 0
						? 'No output.'
						: record.runnerOutput}
				</pre>
			</details>
		</div>
	);
}
