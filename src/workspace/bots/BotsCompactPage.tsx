/**
 * Home › Bots on a compact workspace: the compact section page.
 *
 * Tabs are the wide filter chips (one state, shared); rows are the bots;
 * Needs you shows each waiting request as a card that can be decided in
 * place; the container engine closes the All list and opens the sheet.
 */

import { Box, MessageSquare } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
	CompactChip,
	CompactEmpty,
	CompactLinkRow,
	CompactRow,
} from '../compact/CompactRow';
import { CompactSectionPage } from '../compact/CompactSectionPage';
import type { CompactTab } from '../compact/compactSectionModel';
import { BotAvatar } from './BotAvatar';
import { BuildBanner } from './BotBuildProgress';
import { PermissionPrompt } from './BotPermissionPrompt';
import { EngineSummary } from './BotsSection';
import {
	BOT_ACTIVITY_LABELS,
	BOT_FILTER_LABELS,
	BOT_FILTERS,
	type BotEntry,
	type BotFilter,
	botActivity,
	type NeedsYouEntry,
	SESSION_STATE_LABELS,
	sessionTitle,
	shortAge,
} from './botsModel';
import type { BotEngineView } from './useBotEngine';
import type { ServerBots } from './useServerBots';

const ACTIVITY_TONE = {
	'needs-you': 'attention',
	working: 'working',
	queued: 'working',
	idle: 'idle',
	stopped: 'muted',
} as const;

export function BotsCompactPage({
	servers,
	entries,
	visible,
	counts,
	waiting,
	filter,
	onFilter,
	search,
	onSearch,
	engine,
	engineLabel,
	isVisible,
	buildOpen,
	onBuildOpenChange,
	now,
	loading,
	notes,
	onCreate,
	onOpenBot,
}: Readonly<{
	servers: ReadonlyMap<string, ServerBots>;
	entries: readonly BotEntry[];
	visible: readonly BotEntry[];
	counts: Readonly<Record<BotFilter, number>>;
	waiting: readonly NeedsYouEntry[];
	filter: BotFilter;
	onFilter: (filter: BotFilter) => void;
	search: string;
	onSearch: (search: string) => void;
	engine: BotEngineView;
	engineLabel: string | undefined;
	isVisible: boolean;
	buildOpen: boolean;
	onBuildOpenChange: (open: boolean) => void;
	now: number;
	loading: boolean;
	/** Warnings and errors the servers report, shown above the rows. */
	notes: ReactNode;
	onCreate: () => void;
	onOpenBot: (
		target: Readonly<{
			serverId: string;
			botId: string;
			mode: 'chat' | 'configure';
			sessionId?: string;
		}>,
	) => void;
}>) {
	const [isSheetOpen, setIsSheetOpen] = useState(false);
	const tabs: CompactTab<BotFilter>[] = BOT_FILTERS.map((id) => ({
		id,
		label: id === 'all' ? 'All' : BOT_FILTER_LABELS[id],
		count: counts[id],
		attention: id === 'needs-you',
	}));
	const status = engine.status;
	const engineName =
		status?.engine === 'podman'
			? 'Podman'
			: status?.engine === 'docker'
				? 'Docker'
				: 'No engine';
	const imageText =
		status === undefined
			? 'Checking…'
			: {
					missing: 'Image not built',
					building: 'Building image…',
					current: 'Image current',
					outdated: 'Image out of date',
					failed: 'Image build failed',
				}[status.image.state];
	const term = search.trim().toLowerCase();
	const cards = waiting.filter(
		(item) =>
			term === '' ||
			item.botName.toLowerCase().includes(term) ||
			item.summary.toLowerCase().includes(term),
	);

	let body: ReactNode;
	if (entries.length === 0 && !loading) {
		body = (
			<CompactEmpty
				title="No bots yet"
				action={{ label: 'New bot', onActivate: onCreate }}
			>
				A bot is an agent with its own container, desktop, files, memories, and
				triggers.
			</CompactEmpty>
		);
	} else if (filter === 'needs-you') {
		body =
			cards.length === 0 ? (
				<CompactEmpty title="Nothing is waiting on you" />
			) : (
				<div data-terminay-bots-needs-you={cards.length}>
					{cards.map((item) => (
						<NeedsYouCard
							key={`${item.serverId}:${item.sessionId}`}
							item={item}
							server={servers.get(item.serverId)}
							now={now}
							onOpen={() =>
								onOpenBot({
									serverId: item.serverId,
									botId: item.botId,
									mode: 'chat',
									sessionId: item.sessionId,
								})
							}
						/>
					))}
				</div>
			);
	} else if (visible.length === 0) {
		body = loading ? (
			<CompactEmpty title="Loading bots…" />
		) : (
			<CompactEmpty
				title={
					search.trim() === ''
						? 'No bots here'
						: `No bot matches “${search.trim()}”`
				}
				action={
					search.trim() === ''
						? { label: 'Show all bots', onActivate: () => onFilter('all') }
						: { label: 'Clear search', onActivate: () => onSearch('') }
				}
			/>
		);
	} else {
		body = (
			<div data-terminay-bots-cards="true">
				{visible.map((entry) => (
					<BotRow
						key={`${entry.serverId}:${entry.bot.id}`}
						entry={entry}
						showServer={servers.size > 1}
						now={now}
						onOpen={() =>
							onOpenBot({
								serverId: entry.serverId,
								botId: entry.bot.id,
								mode: 'chat',
							})
						}
					/>
				))}
			</div>
		);
	}

	return (
		<CompactSectionPage
			section="bots"
			title="Bots"
			summary={entries.length === 0 ? undefined : String(entries.length)}
			search={{
				value: search,
				onChange: onSearch,
				placeholder: 'Search bots',
				label: 'Filter bots',
			}}
			create={{ label: 'New bot', onActivate: onCreate }}
			tabs={tabs}
			selectedTab={filter}
			onSelectTab={onFilter}
			sheet={
				isSheetOpen
					? {
							title: 'Container engine',
							canReset: false,
							onReset: () => {},
							isOpen: true,
							offerControl: false,
							onOpenChange: (open) => {
								setIsSheetOpen(open);
								// The engine card opened it, so focus goes back there.
								if (!open)
									window.requestAnimationFrame(() =>
										document
											.querySelector<HTMLElement>(
												'[data-terminay-bots-engine-card]',
											)
											?.focus(),
									);
							},
							content: (
								<EngineSummary
									engine={engine}
									label={engineLabel}
									visible={isVisible}
									showBanner={false}
									onShowBuild={() => {
										setIsSheetOpen(false);
										onBuildOpenChange(true);
									}}
								/>
							),
						}
					: undefined
			}
			banner={
				<>
					<div className="cpage__notes">
						<BuildBanner
							engine={engine}
							label={engineLabel}
							visible={isVisible}
							open={buildOpen}
							onOpenChange={onBuildOpenChange}
						/>
					</div>
					{notes}
				</>
			}
		>
			{body}
			{filter === 'all' && entries.length > 0 ? (
				<CompactLinkRow
					icon={<Box size={17} />}
					label="Container engine"
					detail={`${engineName} · ${imageText}`}
					count={
						status === undefined
							? undefined
							: `${status.runningContainers} / ${status.botContainers}`
					}
					onActivate={() => setIsSheetOpen(true)}
					dataAttr="data-terminay-bots-engine-card"
				/>
			) : null}
		</CompactSectionPage>
	);
}

function BotRow({
	entry,
	showServer,
	now,
	onOpen,
}: Readonly<{
	entry: BotEntry;
	showServer: boolean;
	now: number;
	onOpen: () => void;
}>) {
	const { bot } = entry;
	const activity = botActivity(entry.sessions, entry.environment);
	const latest = entry.sessions[0];
	const live = entry.sessions.find((s) => s.state === 'running');
	const pending = entry.sessions.find(
		(s) => s.state === 'needs-you' || s.permission !== null,
	);
	const label =
		bot.enabled === false ? 'Disabled' : BOT_ACTIVITY_LABELS[activity];
	const detail =
		pending !== undefined
			? pendingSummary(pending.permission?.toolCall)
			: live !== undefined
				? sessionTitle(live)
				: latest === undefined
					? 'No sessions yet'
					: `${sessionTitle(latest)} · ${SESSION_STATE_LABELS[latest.state]}`;
	const meta = [
		entry.nextTrigger === undefined
			? `${entry.agentName ?? bot.agentId}${bot.modelId === null ? '' : ` · ${bot.modelId}`}`
			: `Next: ${entry.nextTrigger.name}`,
		showServer ? entry.serverLabel : undefined,
	]
		.filter(Boolean)
		.join(' · ');
	return (
		<CompactRow
			variant="avatar"
			lead={<BotAvatar bot={bot} activity={activity} size="md" />}
			title={bot.name}
			trailing={
				latest === undefined ? undefined : shortAge(latest.startedAt, now)
			}
			detail={detail}
			detailTone={pending === undefined ? undefined : 'attention'}
			meta={meta}
			chips={
				<CompactChip
					tone={
						activity === 'queued'
							? 'info'
							: ACTIVITY_TONE[activity] === 'attention'
								? 'attention'
								: ACTIVITY_TONE[activity] === 'working'
									? 'working'
									: undefined
					}
				>
					{label}
				</CompactChip>
			}
			isDimmed={bot.enabled === false}
			onActivate={onOpen}
			activateLabel={`Open ${bot.name}`}
			rowProps={{
				'data-terminay-bot-card': bot.id,
				'data-terminay-bot-activity': activity,
			}}
		/>
	);
}

function pendingSummary(toolCall: unknown): string {
	const title =
		typeof toolCall === 'object' && toolCall !== null
			? (toolCall as Record<string, unknown>).title
			: undefined;
	return typeof title === 'string' && title.length > 0
		? `Wants to run: ${title}`
		: 'Waiting for your decision';
}

/**
 * One waiting request. A permission request is decided here on the owning
 * server's connection, as the bot's chat does: the choices are disabled
 * while the decision is in flight, and a failure keeps the card with a note.
 * A request decided elsewhere leaves `waiting`, so its card goes with it.
 */
function NeedsYouCard({
	item,
	server,
	now,
	onOpen,
}: Readonly<{
	item: NeedsYouEntry;
	server: ServerBots | undefined;
	now: number;
	onOpen: () => void;
}>) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const permission = item.permission;
	const decide = (optionId: string) => {
		if (pending || server === undefined || permission === undefined) return;
		setPending(true);
		setError(undefined);
		server.client
			.decide(item.botId, item.sessionId, permission.id, optionId)
			.catch((cause: unknown) =>
				setError(
					`The decision did not go through: ${cause instanceof Error ? cause.message : String(cause)}`,
				),
			)
			.finally(() => setPending(false));
	};
	return (
		<article
			className="ccard"
			data-terminay-bots-needs-session={item.sessionId}
			aria-label={`${item.botName}: ${item.summary}`}
		>
			<div className="ccard__head">
				<span className="ccard__title">{item.botName}</span>
				<span className="ccard__age">{shortAge(item.since, now)}</span>
			</div>
			<p className="ccard__body">{item.summary}</p>
			{permission === undefined ? null : (
				<PermissionPrompt
					permission={permission}
					onDecide={decide}
					disabled={pending}
				/>
			)}
			{error === undefined ? null : (
				<p className="bots-note bots-note--warn" role="alert">
					{error}
				</p>
			)}
			<div className="ccard__actions">
				<button
					type="button"
					className="bots-btn bots-btn--sm"
					onClick={onOpen}
					data-terminay-bots-needs-open="true"
				>
					<MessageSquare size={13} aria-hidden="true" /> Open chat
				</button>
			</div>
		</article>
	);
}
