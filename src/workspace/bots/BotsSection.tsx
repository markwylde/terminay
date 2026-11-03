/**
 * Home › Bots: the fleet dashboard.
 *
 * Every bot on every attached server, as a card, with filters, the container
 * engine's summary, and a Needs you list. Cards update as the servers report
 * changes; nothing here polls.
 */

import { MessageSquare, Plus, Search, Settings } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BotAvatar } from './BotAvatar';
import { subscribeNewBot } from './botFocus';
import {
	BOT_ACTIVITY_LABELS,
	BOT_FILTER_LABELS,
	BOT_FILTERS,
	type BotEntry,
	type BotFilter,
	botActivity,
	ENVIRONMENT_LABELS,
	filterCounts,
	type NeedsYouEntry,
	needsYou,
	SESSION_STATE_LABELS,
	sessionTitle,
	shortAge,
	visibleBots,
} from './botsModel';
import type { BotTabHost } from './botTabHost';
import { NewBotDialog } from './NewBotDialog';
import {
	type BotEngineView,
	ENGINE_REASON_TEXT,
	useBotEngine,
} from './useBotEngine';
import { useNow } from './useNow';
import { botEntries, type ServerBots } from './useServerBots';
import './bots.css';
import './botPanels.css';

export type BotsSectionProps = Readonly<{
	servers: ReadonlyMap<string, ServerBots>;
	host: BotTabHost;
}>;

export function BotsSection({ servers, host }: BotsSectionProps) {
	const now = useNow();
	const [filter, setFilter] = useState<BotFilter>('all');
	const [search, setSearch] = useState('');
	const [creating, setCreating] = useState(false);
	useEffect(() => subscribeNewBot(() => setCreating(true)), []);
	const entries = useMemo(() => botEntries(servers), [servers]);
	useEffect(() => {
		for (const server of servers.values()) server.wantAgents();
	}, [servers]);
	const counts = useMemo(() => filterCounts(entries), [entries]);
	const visible = useMemo(
		() => visibleBots(entries, filter, search),
		[entries, filter, search],
	);
	const waiting = useMemo(() => needsYou(entries), [entries]);
	// The engine summary is per server; Home shows the first that serves bots,
	// and names it when there is more than one.
	const primary = servers.values().next().value as ServerBots | undefined;
	const engine = useBotEngine(primary);
	const loading = [...servers.values()].some((s) => s.status === 'loading');
	const errors = [...servers.values()].filter((s) => s.status === 'error');

	if (servers.size === 0)
		return (
			<div className="bots-ui bots-section" data-terminay-bots="unavailable">
				<div className="bots-placeholder">
					<b>Bots are not available</b>
					<span>
						No attached server offers bots. Bots run on a Terminay server with
						Docker or Podman.
					</span>
				</div>
			</div>
		);

	return (
		<div className="bots-ui bots-section" data-terminay-bots="dashboard">
			<header className="bots-dhead">
				<div className="bots-dhead__row">
					<div className="bots-dhead__title">
						<h2>Bots</h2>
						<p>
							Long-lived teammates, each in its own container. Message them,
							schedule them, give them triggers.
						</p>
					</div>
					<label className="bots-filter-input">
						<Search size={14} aria-hidden="true" />
						<span className="bots-sr">Filter bots</span>
						<input
							value={search}
							placeholder="Filter bots…"
							onChange={(event) => setSearch(event.target.value)}
							data-terminay-bots-search="true"
						/>
					</label>
					<button
						type="button"
						className="bots-btn bots-btn--primary"
						onClick={() => setCreating(true)}
						data-terminay-bots-new="true"
					>
						<Plus size={14} aria-hidden="true" /> New bot
					</button>
				</div>
				<fieldset className="bots-dhead__chips" aria-label="Show bots">
					{BOT_FILTERS.map((candidate) => (
						<button
							key={candidate}
							type="button"
							className={`bots-chip bots-chip--${candidate}${filter === candidate ? ' bots-chip--on' : ''}`}
							aria-pressed={filter === candidate}
							onClick={() => setFilter(candidate)}
							data-terminay-bots-filter={candidate}
						>
							<b>{counts[candidate]}</b> {BOT_FILTER_LABELS[candidate]}
						</button>
					))}
					{filter !== 'all' || search !== '' ? (
						<button
							type="button"
							className="bots-link"
							onClick={() => {
								setFilter('all');
								setSearch('');
							}}
						>
							Clear filter
						</button>
					) : null}
				</fieldset>
			</header>
			<div className="bots-dbody">
				<div className="bots-scroll bots-dmain">
					{[...servers.values()]
						.filter((s) => s.warning)
						.map((s) => (
							<p
								role="status"
								className="bots-note bots-note--warn"
								key={s.serverId}
							>
								{s.warning}
							</p>
						))}
					{errors.map((server) => (
						<div className="bots-note bots-note--warn" key={server.serverId}>
							{server.label}: {server.error}{' '}
							<button
								type="button"
								className="bots-link"
								onClick={server.refresh}
							>
								Try again
							</button>
						</div>
					))}
					{visible.length > 0 ? (
						<div className="bots-grid" data-terminay-bots-cards="true">
							{visible.map((entry) => (
								<BotCard
									key={`${entry.serverId}:${entry.bot.id}`}
									entry={entry}
									showServer={servers.size > 1}
									now={now}
									onOpen={(mode) =>
										host.openBot({
											serverId: entry.serverId,
											botId: entry.bot.id,
											mode,
										})
									}
								/>
							))}
							<button
								type="button"
								className="bots-newcard"
								onClick={() => setCreating(true)}
							>
								<Plus size={20} aria-hidden="true" />
								<span>New bot</span>
							</button>
						</div>
					) : entries.length === 0 && !loading ? (
						<div className="bots-emptyc" data-terminay-bots-empty="true">
							<b>No bots yet</b>
							<span>
								A bot is an agent with its own container, desktop, files,
								memories, and triggers.
							</span>
							<button
								type="button"
								className="bots-btn bots-btn--primary"
								onClick={() => setCreating(true)}
							>
								<Plus size={14} aria-hidden="true" /> New bot
							</button>
						</div>
					) : (
						<div className="bots-empty">
							{loading ? 'Loading bots…' : 'No bots match this filter.'}
						</div>
					)}
				</div>
				<aside className="bots-rail bots-scroll" aria-label="Bots overview">
					<EngineSummary
						engine={engine}
						label={servers.size > 1 ? primary?.label : undefined}
					/>
					<NeedsYouList
						entries={waiting}
						now={now}
						onOpen={(item) =>
							host.openBot({
								serverId: item.serverId,
								botId: item.botId,
								mode: 'chat',
								sessionId: item.sessionId,
							})
						}
					/>
				</aside>
			</div>
			{creating ? (
				<NewBotDialog
					servers={servers}
					onClose={() => setCreating(false)}
					onCreated={(serverId, botId) => {
						setCreating(false);
						host.openBot({ serverId, botId, mode: 'configure' });
					}}
				/>
			) : null}
		</div>
	);
}

function BotCard({
	entry,
	showServer,
	now,
	onOpen,
}: Readonly<{
	entry: BotEntry;
	showServer: boolean;
	now: number;
	onOpen: (mode: 'chat' | 'configure') => void;
}>) {
	const { bot } = entry;
	const activity = botActivity(entry.sessions, entry.environment);
	const latest = entry.sessions[0];
	const live = entry.sessions.find((s) => s.state === 'running');
	return (
		<article
			className="bots-card bots-acard"
			data-terminay-bot-card={bot.id}
			data-terminay-bot-activity={activity}
		>
			<button
				type="button"
				className="bots-acard__open"
				onClick={() => onOpen('chat')}
				aria-label={`Open ${bot.name}`}
			>
				<BotAvatar bot={bot} activity={activity} size="lg" />
				<span className="bots-acard__name">
					<b>{bot.name}</b>
					<span>
						{entry.agentName ?? bot.agentId}
						{bot.modelId === null ? '' : ` · ${bot.modelId}`}
						{showServer ? ` · ${entry.serverLabel}` : ''}
					</span>
				</span>
			</button>
			<div className="bots-acard__state">
				<span className={`bots-chip bots-chip--small bots-chip--${activity}`}>
					{BOT_ACTIVITY_LABELS[activity]}
					{live === undefined ? '' : ` · ${shortAge(live.startedAt, now)}`}
				</span>
				<span className="bots-acard__env">
					{ENVIRONMENT_LABELS[entry.environment]}
				</span>
			</div>
			<p className="bots-acard__desc">{bot.description || 'No description.'}</p>
			<div className="bots-acard__meta">
				<span>
					{latest === undefined
						? 'No sessions yet'
						: `${sessionTitle(latest)} · ${SESSION_STATE_LABELS[latest.state]} · ${shortAge(latest.startedAt, now)}`}
				</span>
				<span>
					{entry.nextTrigger === undefined
						? 'No upcoming triggers'
						: `Next: ${entry.nextTrigger.name}`}
				</span>
			</div>
			<div className="bots-acard__actions">
				<button
					type="button"
					className="bots-btn bots-btn--sm"
					onClick={() => onOpen('chat')}
				>
					<MessageSquare size={13} aria-hidden="true" /> Chat
				</button>
				<button
					type="button"
					className="bots-btn bots-btn--sm"
					onClick={() => onOpen('configure')}
				>
					<Settings size={13} aria-hidden="true" /> Configure
				</button>
			</div>
		</article>
	);
}

export function EngineSummary({
	engine,
	label,
	compact = false,
}: Readonly<{
	engine: BotEngineView;
	label: string | undefined;
	compact?: boolean;
}>) {
	const { status } = engine;
	const [switching, setSwitching] = useState<string>();
	const name =
		status?.engine === 'podman'
			? 'Podman'
			: status?.engine === 'docker'
				? 'Docker'
				: 'No engine';
	return (
		<section data-terminay-bots-engine={status?.available ? 'ready' : 'setup'}>
			{!compact ? (
				<h3 className="bots-lab">
					Container engine{label === undefined ? '' : ` · ${label}`}
				</h3>
			) : null}
			<div className="bots-card bots-engine">
				<div className="bots-kv">
					<span>Engine</span>
					<span>
						{name}
						{status === undefined
							? ''
							: status.available
								? ' · available'
								: ' · unavailable'}
					</span>
				</div>
				{!compact ? (
					<div className="bots-kv">
						<span>Containers</span>
						<span className="bots-mono">
							{status?.runningContainers ?? 0} / {status?.botContainers ?? 0}{' '}
							running
						</span>
					</div>
				) : null}
				{!compact || status?.available ? (
					<div className="bots-kv">
						<span>Image</span>
						<span data-terminay-bots-image={status?.image.state ?? 'unknown'}>
							{status === undefined
								? '—'
								: {
										missing: 'Not built',
										building: 'Building…',
										current: 'Built and current',
										outdated: 'Out of date',
										failed: 'Build failed',
									}[status.image.state]}
						</span>
					</div>
				) : null}
				{status?.reason ? (
					<p
						className="bots-note bots-note--warn"
						data-terminay-bots-engine-reason={status.reason}
					>
						{ENGINE_REASON_TEXT[status.reason]}
						{!compact && status.detail ? ` ${status.detail}` : ''}
					</p>
				) : null}
				{status?.available && status.image.error ? (
					<p className="bots-note bots-note--warn">{status.image.error}</p>
				) : null}
				{engine.error ? (
					<p className="bots-note bots-note--warn">{engine.error}</p>
				) : null}
				<div className="bots-engine__actions">
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						disabled={engine.busy}
						onClick={engine.checkAgain}
					>
						Check again
					</button>
					{status?.available && status.image.state !== 'current' ? (
						<button
							type="button"
							className="bots-btn bots-btn--sm bots-btn--primary"
							disabled={engine.busy || status.image.state === 'building'}
							onClick={engine.buildImage}
						>
							Build image
						</button>
					) : null}
				</div>
				{status?.candidates
					.filter(
						(candidate) =>
							candidate.available &&
							candidate.address !== null &&
							(!status.available ||
								status.pinned === null ||
								candidate.kind !== status.pinned.kind ||
								candidate.address !== status.pinned.address),
					)
					.map((candidate) => {
						const key = `${candidate.kind}:${candidate.address}`;
						const kindName = candidate.kind === 'podman' ? 'Podman' : 'Docker';
						return (
							<div key={key}>
								<div
									className="bots-engine__candidate"
									data-terminay-bots-engine-candidate
								>
									<span>
										{kindName} found
										<span className="bots-engine__address bots-faint bots-mono">
											{candidate.address}
										</span>
									</span>
									<button
										type="button"
										className="bots-btn bots-btn--sm"
										disabled={engine.busy}
										onClick={() =>
											status.pinned === null
												? engine.useEngine(candidate, false)
												: setSwitching(key)
										}
										data-terminay-bots-engine-use={candidate.kind}
									>
										Use this engine
									</button>
								</div>
								{switching === key ? (
									<div
										className="bots-note bots-note--warn"
										role="alertdialog"
										aria-label={`Switch to ${kindName}?`}
									>
										New containers will use {kindName}. Bots already on{' '}
										{status.pinned?.kind === 'podman' ? 'Podman' : 'Docker'}{' '}
										keep their containers and homes there, untouched.{' '}
										<button
											type="button"
											className="bots-link"
											onClick={() => {
												setSwitching(undefined);
												engine.useEngine(candidate, true);
											}}
											data-terminay-bots-engine-confirm="true"
										>
											Switch
										</button>{' '}
										<button
											type="button"
											className="bots-link"
											onClick={() => setSwitching(undefined)}
										>
											Cancel
										</button>
									</div>
								) : null}
							</div>
						);
					})}
			</div>
		</section>
	);
}

function NeedsYouList({
	entries,
	now,
	onOpen,
}: Readonly<{
	entries: readonly NeedsYouEntry[];
	now: number;
	onOpen: (entry: NeedsYouEntry) => void;
}>) {
	return (
		<section data-terminay-bots-needs-you={entries.length}>
			<h3 className="bots-lab">Needs you</h3>
			{entries.length === 0 ? (
				<p className="bots-faint">Nothing is waiting on you.</p>
			) : (
				<ul className="bots-needs">
					{entries.map((entry) => (
						<li key={`${entry.serverId}:${entry.sessionId}`}>
							<button
								type="button"
								className="bots-card bots-needs__item"
								onClick={() => onOpen(entry)}
								data-terminay-bots-needs-session={entry.sessionId}
							>
								<b>{entry.botName}</b>
								<span>{entry.summary}</span>
								<span className="bots-faint">{shortAge(entry.since, now)}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
