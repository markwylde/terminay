import type { BotProfile, BotSessionRecord } from '@terminay/protocol';
import { Brain, FolderOpen, Monitor, SquareTerminal, Zap } from 'lucide-react';
import { BotDesktopCanvas } from './BotDesktopView';
import { formatWhen } from './BotTriggersPanel';
import { SESSION_STATE_LABELS, sessionTitle, shortAge } from './botsModel';
import { useNow } from './useNow';
import type { ServerBots } from './useServerBots';
import type { BotConfigTab } from './BotTab';
import type { BotEnvironmentSubTab } from './BotEnvironmentPanel';
export function BotContextRail({
	server,
	bot,
	sessions,
	environment,
	visible,
	onConfigure,
	onExecution,
}: {
	server: ServerBots;
	bot: BotProfile;
	sessions: readonly BotSessionRecord[];
	environment: string;
	visible: boolean;
	onConfigure: (tab: BotConfigTab, sub?: BotEnvironmentSubTab) => void;
	onExecution: (id: string) => void;
}) {
	const now = useNow();
	return (
		<aside className="bots-rail bots-scroll" aria-label={`${bot.name} context`}>
			<section>
				<div className="bots-railhead">
					<h3 className="bots-lab">Desktop</h3>
					{environment === 'running' ? (
						<button
							type="button"
							className="bots-link"
							onClick={() => onConfigure('environment', 'desktop')}
						>
							Open desktop
						</button>
					) : null}
				</div>
				{environment === 'running' && visible ? (
					<div
						className="bots-desk bots-desk--live"
						data-terminay-bot-desk-thumb="live"
					>
						<BotDesktopCanvas
							server={server}
							bot={bot}
							mode="view-only"
							thumbnail
						/>
						<button
							type="button"
							className="bots-desk__open"
							aria-label="Open the desktop"
							onClick={() => onConfigure('environment', 'desktop')}
						/>
					</div>
				) : (
					<button
						type="button"
						className="bots-desk"
						onClick={() => onConfigure('environment', 'desktop')}
						data-terminay-bot-desk-thumb={environment}
					>
						<Monitor size={20} aria-hidden="true" />
						<span>The desktop shows while the container runs</span>
					</button>
				)}
			</section>
			<section>
				<div className="bots-railhead">
					<h3 className="bots-lab">Recent sessions</h3>
					<button
						type="button"
						className="bots-link"
						onClick={() => onConfigure('sessions')}
					>
						View all
					</button>
				</div>
				{sessions.length === 0 ? (
					<p className="bots-faint">No sessions yet.</p>
				) : (
					<ul className="bots-sesslist">
						{sessions.slice(0, 6).map((s) => (
							<li key={s.id}>
								<button
									type="button"
									className="bots-sess"
									onClick={() => {
										onExecution(s.id);
									}}
								>
									<span
										className={`bots-sess__dot bots-sess__dot--${s.state}`}
										aria-hidden="true"
									/>
									<span className="bots-sess__body">
										<span className="bots-sess__t">{sessionTitle(s)}</span>
										<span className="bots-sess__m">
											{SESSION_STATE_LABELS[s.state]} ·{' '}
											{shortAge(s.startedAt, now)}
										</span>
									</span>
								</button>
								{['queued', 'running', 'needs-you'].includes(s.state) ? (
									<button
										type="button"
										className="bots-btn bots-btn--sm"
										data-terminay-bot-stop={s.id}
										aria-label={`Stop session ${s.id}`}
										onClick={() =>
											void server.client
												.control(bot.id, s.id, 'stop')
												.then(() => server.refreshBot(bot.id))
												.catch(() => server.refreshBot(bot.id))
										}
									>
										Stop
									</button>
								) : null}
							</li>
						))}
					</ul>
				)}
			</section>
			<section>
				<div className="bots-railhead">
					<h3 className="bots-lab">Upcoming</h3>
					<button
						type="button"
						className="bots-link"
						onClick={() => onConfigure('triggers')}
					>
						Triggers
					</button>
				</div>
				{(server.upcoming.get(bot.id) ?? []).length === 0 ? (
					<p className="bots-faint">No upcoming firings.</p>
				) : (
					<ul className="bots-upnext" data-terminay-bot-upcoming="true">
						{(server.upcoming.get(bot.id) ?? []).slice(0, 3).map((firing) => (
							<li key={`${firing.triggerId}:${firing.at}`}>
								<span className="bots-mono">{formatWhen(firing.at)}</span>
								<span>{firing.triggerName}</span>
							</li>
						))}
					</ul>
				)}
			</section>
			<section>
				<div className="bots-railhead">
					<h3 className="bots-lab">Shortcuts</h3>
				</div>
				<div className="bots-shortcuts">
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						onClick={() => onConfigure('environment', 'files')}
					>
						<FolderOpen size={13} aria-hidden="true" /> Files
					</button>
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						onClick={() => onConfigure('environment', 'shell')}
					>
						<SquareTerminal size={13} aria-hidden="true" /> Shell
					</button>
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						onClick={() => onConfigure('memories')}
					>
						<Brain size={13} aria-hidden="true" /> Memories
					</button>
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						onClick={() => onConfigure('triggers')}
					>
						<Zap size={13} aria-hidden="true" /> Triggers
					</button>
				</div>
			</section>
		</aside>
	);
}
