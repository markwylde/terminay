/**
 * One bot's tab: Chat, or Configure with its Profile, Environment, Memories,
 * Triggers, and Sessions. The tab reads the same per-server projection as the
 * dashboard, so a card and its tab never disagree.
 */

import { useEffect, useRef, useState } from 'react';
import { BotAvatar } from './BotAvatar';
import { BotChat } from './BotChat';
import {
	BotEnvironmentPanel,
	type BotEnvironmentSubTab,
} from './BotEnvironmentPanel';
import { BotMemoriesPanel } from './BotMemoriesPanel';
import { BotProfilePanel } from './BotProfilePanel';
import { BotSessionsPanel } from './BotSessionsPanel';
import { BotTriggersPanel } from './BotTriggersPanel';
import { subscribeBotFocus } from './botFocus';
import { BOT_ACTIVITY_LABELS, botActivity } from './botsModel';
import type { BotTabHost } from './botTabHost';
import type { ServerBots } from './useServerBots';
import './bots.css';
import './botPanels.css';

export const BOT_CONFIG_TABS = [
	'profile',
	'environment',
	'memories',
	'triggers',
	'sessions',
] as const;
export type BotConfigTab = (typeof BOT_CONFIG_TABS)[number];
const CONFIG_LABELS: Readonly<Record<BotConfigTab, string>> = {
	profile: 'Profile',
	environment: 'Environment',
	memories: 'Memories',
	triggers: 'Triggers',
	sessions: 'Sessions',
};

export function BotTab({
	server,
	botId,
	host,
}: Readonly<{
	server: ServerBots | undefined;
	botId: string;
	host: BotTabHost;
}>) {
	const [mode, setMode] = useState<'chat' | 'configure'>('chat');
	const [configTab, setConfigTab] = useState<BotConfigTab>('profile');
	const [envTab, setEnvTab] = useState<BotEnvironmentSubTab>('overview');
	const [chatSessionId, setChatSessionId] = useState<string>();
	const [draft, setDraft] = useState('');
	const bot = server?.bots.find((candidate) => candidate.id === botId);
	useEffect(() => server?.wantAgents(), [server]);
	const sessions = server?.sessions.get(botId) ?? [];
	const environment = server?.environments.get(botId) ?? 'unknown';
	const { setTitle, close } = host;
	const seen = useRef(false);
	const counts = useTabCounts(server, botId, mode === 'configure', sessions);

	useEffect(() => {
		if (bot !== undefined) setTitle(bot.name);
	}, [bot, setTitle]);

	// A bot that was shown and then vanished from a ready projection was
	// deleted, here or on another device.
	useEffect(() => {
		if (bot !== undefined) seen.current = true;
		else if (seen.current && server?.status === 'ready')
			close('This bot was deleted.');
	}, [bot, server?.status, close]);

	useEffect(() => {
		if (server === undefined) return;
		return subscribeBotFocus(server.serverId, botId, (target) => {
			if (target.mode !== undefined) setMode(target.mode);
			if (target.sessionId !== undefined) {
				setMode('chat');
				setChatSessionId(target.sessionId);
			}
		});
	}, [server, botId]);

	if (server === undefined)
		return (
			<div className="bots-ui" data-terminay-bot-tab="unavailable">
				<div className="bots-placeholder">
					<b>Server not connected</b>
					<span>This bot's server is not attached right now.</span>
				</div>
			</div>
		);
	if (bot === undefined)
		return (
			<div className="bots-ui" data-terminay-bot-tab="missing">
				<div className="bots-placeholder">
					{server.status === 'loading' ? (
						<span>Loading bot…</span>
					) : (
						<>
							<b>This bot no longer exists</b>
							<span>It was deleted, or you no longer have access to it.</span>
							<button
								type="button"
								className="bots-btn"
								onClick={() => host.close()}
							>
								Close tab
							</button>
						</>
					)}
				</div>
			</div>
		);

	const activity = botActivity(sessions, environment);
	const agent = server.agents.find((a) => a.id === bot.agentId);
	return (
		<div
			className="bots-ui bots-tab"
			data-terminay-bot-tab={bot.id}
			data-terminay-bot-mode={mode}
		>
			<header className="bots-ahead">
				<BotAvatar bot={bot} activity={activity} size="md" />
				<div className="bots-ahead__name">
					<b>{bot.name}</b>
					<span>
						{agent?.displayName ?? bot.agentId}
						{' / '}
						{bot.modelId ?? 'Default model'}
						{' · container '}
						<code>{`terminay-bot-${bot.id}`}</code>
					</span>
				</div>
				<span className={`bots-chip bots-chip--small bots-chip--${activity}`}>
					{BOT_ACTIVITY_LABELS[activity]}
				</span>
				<fieldset className="bots-seg" aria-label="Bot view">
					<button
						type="button"
						className={mode === 'chat' ? 'bots-seg--on' : ''}
						aria-pressed={mode === 'chat'}
						onClick={() => setMode('chat')}
						data-terminay-bot-mode-button="chat"
					>
						Chat
					</button>
					<button
						type="button"
						className={mode === 'configure' ? 'bots-seg--on' : ''}
						aria-pressed={mode === 'configure'}
						onClick={() => setMode('configure')}
						data-terminay-bot-mode-button="configure"
					>
						Configure
					</button>
				</fieldset>
			</header>
			{mode === 'chat' ? (
				<BotChat
					server={server}
					bot={bot}
					sessions={sessions}
					environment={environment}
					sessionId={chatSessionId}
					onSessionChange={setChatSessionId}
					draft={draft}
					onDraftChange={setDraft}
					visible={host.isVisible}
					onConfigure={(tab, sub) => {
						setConfigTab(tab);
						if (sub !== undefined) setEnvTab(sub);
						setMode('configure');
					}}
				/>
			) : (
				<div className="bots-cfg">
					<div className="bots-ctabs" role="tablist" aria-label="Configure">
						{BOT_CONFIG_TABS.map((tab) => (
							<button
								key={tab}
								type="button"
								role="tab"
								aria-selected={configTab === tab}
								className={configTab === tab ? 'bots-ctabs--on' : ''}
								onClick={() => setConfigTab(tab)}
								data-terminay-bot-config-tab={tab}
							>
								{CONFIG_LABELS[tab]}
								{counts[tab] === undefined ? null : (
									<span className="bots-ctabs__count">{counts[tab]}</span>
								)}
							</button>
						))}
					</div>
					<div className="bots-cbody" role="tabpanel">
						{configTab === 'profile' ? (
							<BotProfilePanel
								server={server}
								bot={bot}
								onDeleted={() => host.close()}
							/>
						) : configTab === 'environment' ? (
							<BotEnvironmentPanel
								server={server}
								bot={bot}
								tab={envTab}
								onTabChange={setEnvTab}
								visible={host.isVisible}
							/>
						) : configTab === 'memories' ? (
							<BotMemoriesPanel server={server} bot={bot} />
						) : configTab === 'triggers' ? (
							<BotTriggersPanel server={server} bot={bot} />
						) : (
							<BotSessionsPanel
								server={server}
								bot={bot}
								onOpenInChat={(sessionId) => {
									setChatSessionId(sessionId);
									setMode('chat');
								}}
							/>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * Counts shown beside the Memories, Triggers and Sessions tabs. Re-read
 * whenever the bot's sessions change, which is when memories and trigger
 * firings move too.
 */
function useTabCounts(
	server: ServerBots | undefined,
	botId: string,
	active: boolean,
	sessions: readonly unknown[],
): Partial<Record<BotConfigTab, number>> {
	const [counts, setCounts] = useState<{ memories?: number; triggers?: number }>(
		{},
	);
	const client = server?.client;
	useEffect(() => {
		if (client === undefined || !active) return;
		let live = true;
		void Promise.allSettled([client.memories(botId, ''), client.triggers(botId)]).then(
			([memories, triggers]) => {
				if (!live) return;
				setCounts({
					memories:
						memories.status === 'fulfilled' ? memories.value.length : undefined,
					triggers:
						triggers.status === 'fulfilled'
							? triggers.value.triggers.length
							: undefined,
				});
			},
		);
		return () => {
			live = false;
		};
	}, [client, botId, active, sessions]);
	return {
		memories: counts.memories || undefined,
		triggers: counts.triggers || undefined,
		sessions: sessions.length || undefined,
	};
}
