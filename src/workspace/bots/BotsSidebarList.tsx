/**
 * Home's sidebar roster: every bot under a "Bots" heading, each with its
 * colour, initial and activity dot. Choosing one opens (or brings forward)
 * its tab; + opens the Bots section to make a new one.
 */

import { Plus } from 'lucide-react';
import { formatActivityCount } from '../activityCountBadge';
import {
	type BotUnreadCounts,
	botUnreadLabel,
} from '../publishedNotifications';
import { BotAvatar } from './BotAvatar';
import { BOT_ACTIVITY_LABELS, botActivity, shortAge } from './botsModel';
import type { BotTabTarget } from './botTabHost';
import { useNow } from './useNow';
import { botEntries, type ServerBots } from './useServerBots';
import './bots.css';

export function BotsSidebarList({
	servers,
	activeBot,
	onOpenBot,
	onNewBot,
	unread,
}: Readonly<{
	servers: ReadonlyMap<string, ServerBots>;
	activeBot: Readonly<{ serverId: string; botId: string }> | undefined;
	onOpenBot: (target: BotTabTarget) => void;
	onNewBot: () => void;
	/** Unread posts per bot, on the server that counted them. */
	unread?: BotUnreadCounts | undefined;
}>) {
	const entries = botEntries(servers).sort((a, b) =>
		a.bot.name.localeCompare(b.bot.name),
	);
	const multipleServers = servers.size > 1;
	const now = useNow(60_000);
	return (
		<div className="home-sidebar__bots" data-terminay-home-sidebar-bots="true">
			<div className="home-sidebar__heading">
				<span>Bots</span>
				<button
					type="button"
					aria-label="New bot"
					title="New bot"
					onClick={onNewBot}
					data-terminay-home-sidebar-new-bot="true"
				>
					<Plus size={13} aria-hidden="true" />
				</button>
			</div>
			{entries.length === 0 ? (
				<p className="home-sidebar__empty">No bots yet.</p>
			) : (
				entries.map((entry) => {
					const activity = botActivity(entry.sessions, entry.environment);
					const active =
						activeBot?.serverId === entry.serverId &&
						activeBot?.botId === entry.bot.id;
					const unreadCount =
						unread?.serverId === entry.serverId
							? (unread.byBot.get(entry.bot.id) ?? 0)
							: 0;
					return (
						<button
							key={`${entry.serverId}/${entry.bot.id}`}
							type="button"
							className={`home-sidebar__section home-sidebar__bot${active ? ' home-sidebar__section--active' : ''}`}
							title={`${entry.bot.name} · ${BOT_ACTIVITY_LABELS[activity]}`}
							{...(unreadCount > 0
								? {
										'aria-label': `${entry.bot.name}, ${botUnreadLabel(unreadCount)}`,
									}
								: {})}
							onClick={() =>
								onOpenBot({ serverId: entry.serverId, botId: entry.bot.id })
							}
							data-terminay-home-sidebar-bot={entry.bot.id}
						>
							<BotAvatar bot={entry.bot} activity={activity} size="sm" />
							<span className="home-sidebar__label">{entry.bot.name}</span>
							{(() => {
								// How long the current turn has run, as in the mockup.
								const live = entry.sessions.find(
									(s) => s.state === 'running' || s.state === 'needs-you',
								);
								const meta = [
									multipleServers ? entry.serverLabel : '',
									live === undefined ? '' : shortAge(live.startedAt, now),
								]
									.filter(Boolean)
									.join(' · ');
								return meta ? (
									<span className="home-sidebar__meta">{meta}</span>
								) : null;
							})()}
							{unreadCount > 0 ? (
								<span
									className="home-sidebar__badge"
									aria-hidden="true"
									data-terminay-home-sidebar-bot-unread={entry.bot.id}
								>
									{formatActivityCount(unreadCount)}
								</span>
							) : null}
						</button>
					);
				})
			)}
		</div>
	);
}

/** A bot tab's icon: the bot's initial on its colour, with its activity dot. */
export function BotTabIcon({
	servers,
	target,
}: Readonly<{
	servers: ReadonlyMap<string, ServerBots>;
	target: Readonly<{ serverId: string; botId: string }>;
}>) {
	const server = servers.get(target.serverId);
	const bot = server?.bots.find((candidate) => candidate.id === target.botId);
	if (server === undefined || bot === undefined) return null;
	const activity = botActivity(
		server.sessions.get(bot.id) ?? [],
		server.environments.get(bot.id) ?? 'unknown',
	);
	return (
		<span className="home-tab__bot">
			<BotAvatar bot={bot} activity={activity} size="sm" />
		</span>
	);
}
