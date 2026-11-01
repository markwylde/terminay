/**
 * Home's sidebar roster: every bot under a "Bots" heading, each with its
 * colour, initial and activity dot. Choosing one opens (or brings forward)
 * its tab; + opens the Bots section to make a new one.
 */

import { Plus } from 'lucide-react';
import { BotAvatar } from './BotAvatar';
import type { BotTabTarget } from './botTabHost';
import { BOT_ACTIVITY_LABELS, botActivity, shortAge } from './botsModel';
import { useNow } from './useNow';
import { botEntries, type ServerBots } from './useServerBots';
import './bots.css';

export function BotsSidebarList({
	servers,
	activeBot,
	onOpenBot,
	onNewBot,
}: Readonly<{
	servers: ReadonlyMap<string, ServerBots>;
	activeBot: Readonly<{ serverId: string; botId: string }> | undefined;
	onOpenBot: (target: BotTabTarget) => void;
	onNewBot: () => void;
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
					return (
						<button
							key={`${entry.serverId}/${entry.bot.id}`}
							type="button"
							className={`home-sidebar__section home-sidebar__bot${active ? ' home-sidebar__section--active' : ''}`}
							title={`${entry.bot.name} · ${BOT_ACTIVITY_LABELS[activity]}`}
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
