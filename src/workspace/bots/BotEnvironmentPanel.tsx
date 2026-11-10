/**
 * A bot's environment: Overview, Files, Shell, Desktop, and Containers.
 */

import type {
	BotEnvironmentOverview,
	BotProfile,
	BotSiblingContainer,
} from '@terminay/protocol';
import {
	ChevronDown,
	FolderOpen,
	Monitor,
	Play,
	RefreshCw,
	RotateCw,
	ScrollText,
	Square,
	SquareTerminal,
	Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BotDesktopView } from './BotDesktopView';
import { EnvironmentSettingsCard } from './BotEnvironmentSettings';
import { BotFilesView } from './BotFilesView';
import { BotShellView } from './BotShellView';
import {
	ENVIRONMENT_LABELS,
	SESSION_STATE_LABELS,
	sessionTitle,
	shortAge,
} from './botsModel';
import { refusalText, type ServerBots } from './useServerBots';

export const BOT_ENVIRONMENT_TABS = [
	'overview',
	'files',
	'shell',
	'desktop',
	'containers',
] as const;
export type BotEnvironmentSubTab = (typeof BOT_ENVIRONMENT_TABS)[number];
const TAB_LABELS: Readonly<Record<BotEnvironmentSubTab, string>> = {
	overview: 'Overview',
	files: 'Files',
	shell: 'Shell',
	desktop: 'Desktop',
	containers: 'Containers',
};

export function formatBytes(bytes: number | null): string {
	if (bytes === null) return '—';
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatUptime(ms: number): string {
	if (ms <= 0) return '—';
	const m = Math.floor(ms / 60_000);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 48) return `${h}h ${m % 60}m`;
	return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** The protocol carries the engine's port bindings as JSON. Never display that wire format. */
function containerPorts(value: string): string[] {
	try {
		const ports: unknown = JSON.parse(value || '{}');
		if (!ports || typeof ports !== 'object' || Array.isArray(ports)) return [];
		const result = new Set<string>();
		for (const [port, bindings] of Object.entries(ports)) {
			const target = port.replace(/\/tcp$/, '');
			if (!Array.isArray(bindings) || bindings.length === 0) {
				result.add(`${port} (internal)`);
				continue;
			}
			for (const binding of bindings) {
				if (!binding || typeof binding.HostPort !== 'string') continue;
				const ip = typeof binding.HostIp === 'string' ? binding.HostIp : '';
				const host = ['', '0.0.0.0', '::'].includes(ip)
					? binding.HostPort
					: `${ip.includes(':') ? `[${ip}]` : ip}:${binding.HostPort}`;
				result.add(`${host} → ${target}`);
			}
		}
		return [...result];
	} catch {
		return ['Unavailable'];
	}
}

function containerAge(createdAt: string): string {
	const date = Date.parse(createdAt);
	if (!Number.isFinite(date)) return 'Unknown';
	const age = shortAge(date, Date.now());
	return age === 'now' ? 'Just now' : `${age} ago`;
}

export function BotEnvironmentPanel({
	server,
	bot,
	tab,
	onTabChange,
	visible,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	tab: BotEnvironmentSubTab;
	onTabChange: (tab: BotEnvironmentSubTab) => void;
	visible: boolean;
}>) {
	return (
		<div className="bots-env" data-terminay-bot-panel="environment">
			<div className="bots-env__nav">
				<div className="bots-seg" role="tablist" aria-label="Environment">
					{BOT_ENVIRONMENT_TABS.map((key) => (
						<button
							key={key}
							type="button"
							role="tab"
							aria-selected={tab === key}
							className={tab === key ? 'bots-seg--on' : ''}
							onClick={() => onTabChange(key)}
							data-terminay-bot-env-tab={key}
						>
							{TAB_LABELS[key]}
						</button>
					))}
				</div>
			</div>
			<div className="bots-env__body">
				{tab === 'overview' ? (
					<OverviewView server={server} bot={bot} onTabChange={onTabChange} />
				) : tab === 'files' ? (
					<BotFilesView server={server} bot={bot} />
				) : tab === 'shell' ? (
					<BotShellView server={server} bot={bot} visible={visible} />
				) : tab === 'desktop' ? (
					<BotDesktopView server={server} bot={bot} visible={visible} />
				) : (
					<ContainersView
						server={server}
						bot={bot}
						onOverview={() => onTabChange('overview')}
					/>
				)}
			</div>
		</div>
	);
}

function OverviewView({
	server,
	bot,
	onTabChange,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	onTabChange: (tab: BotEnvironmentSubTab) => void;
}>) {
	const [menu, setMenu] = useState(false);
	const [details, setDetails] = useState(false);
	const [overview, setOverview] = useState<BotEnvironmentOverview>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState<string>();
	const [confirm, setConfirm] = useState<'stop' | 'recreate'>();
	const sessions = server.sessions.get(bot.id) ?? [];
	const running = sessions.some(
		(s) => s.state === 'running' || s.state === 'needs-you',
	);

	// Usage is read when the Overview opens and on Refresh, never on a timer.
	const load = useCallback(() => {
		server.environment
			.overview(bot.id)
			.then((next) => {
				setOverview(next);
				setError(undefined);
			})
			.catch((cause: unknown) => setError(refusalText(cause)));
	}, [server.environment, bot.id]);
	useEffect(load, [load]);

	// Lifecycle changes move the projection's environment state.
	const projected = server.environments.get(bot.id);
	useEffect(() => {
		if (overview !== undefined && projected !== overview.state) load();
	}, [projected]);

	const lifecycle = (
		action: 'start' | 'stop' | 'restart' | 'recreate',
		confirmed = false,
	) => {
		setBusy(action);
		setError(undefined);
		server.environment
			.lifecycle(bot.id, action, { confirmed })
			.then(() => {
				server.refreshBot(bot.id);
				load();
			})
			.catch((cause: unknown) => setError(refusalText(cause)))
			.finally(() => setBusy(undefined));
	};
	const ask = (action: 'stop' | 'recreate') =>
		running ? setConfirm(action) : lifecycle(action, true);

	if (overview === undefined)
		return (
			<div className="bots-cpad">
				{error ? (
					<div className="bots-note bots-note--error">{error}</div>
				) : (
					<p className="bots-faint">Reading the environment…</p>
				)}
			</div>
		);

	const state = overview.state;
	const up = state === 'running';
	const missing = state === 'not-created';
	const settling = state === 'starting' || state === 'building';
	// The one action that brings the machine up, named for what it will do.
	const startLabel =
		busy === 'start' || settling
			? missing || state === 'building'
				? 'Creating…'
				: 'Starting…'
			: missing
				? 'Create environment'
				: state === 'failed'
					? 'Try again'
					: 'Start';
	const activity = [...sessions]
		.sort((a, b) => b.startedAt - a.startedAt)
		.slice(0, 6);
	return (
		<div className="bots-scroll bots-cpad" data-terminay-bot-env-state={state}>
			<div className="bots-hero">
				<div className={`bots-hero__icon bots-env-state--${state}`}>
					<Monitor size={24} aria-hidden="true" />
				</div>
				<div className="bots-grow">
					<h3 className="bots-hero__title">
						{bot.name}’s machine{' '}
						{state === 'failed'
							? 'failed to start'
							: `is ${ENVIRONMENT_LABELS[state].toLowerCase()}`}
					</h3>
					<p className="bots-faint">
						{up
							? `Up ${formatUptime(overview.uptimeMs)} · ${
									overview.cpuPercent === null
										? '—'
										: `${overview.cpuPercent.toFixed(0)}%`
								} CPU · ${formatBytes(overview.memoryBytes)} memory`
							: settling
								? 'Getting ready…'
								: missing
									? 'Create it to use the desktop and shell. Sessions also create it when they start, and files work without it.'
									: state === 'failed'
										? 'Try again, or recreate it from the current image. The home is kept.'
										: 'Start it to use the desktop and shell. Files work while it is stopped.'}
					</p>
				</div>
				<div className="bots-row-actions">
					{up ? (
						<button
							type="button"
							className="bots-btn"
							disabled={busy !== undefined}
							onClick={() => ask('stop')}
							data-terminay-bot-env-action="stop"
						>
							Stop
						</button>
					) : (
						<button
							type="button"
							className="bots-btn bots-btn--primary"
							disabled={busy !== undefined || settling}
							onClick={() => lifecycle('start')}
							data-terminay-bot-env-action="start"
						>
							{startLabel}
						</button>
					)}
					<div className="bots-menuwrap">
						<button
							type="button"
							className="bots-btn"
							aria-expanded={menu}
							aria-haspopup="menu"
							onClick={() => setMenu((open) => !open)}
							data-terminay-bot-env-actions="true"
						>
							Actions <ChevronDown size={12} aria-hidden="true" />
						</button>
						{menu ? (
							<div className="bots-menu" role="menu">
								{missing ? (
									<button
										type="button"
										role="menuitem"
										disabled={busy !== undefined}
										onClick={() => {
											setMenu(false);
											lifecycle('start');
										}}
										data-terminay-bot-env-action="create"
									>
										Create environment
									</button>
								) : null}
								<button
									type="button"
									role="menuitem"
									disabled={busy !== undefined || !up}
									onClick={() => {
										setMenu(false);
										lifecycle('restart', true);
									}}
									data-terminay-bot-env-action="restart"
								>
									Restart
									{up ? null : <small>Needs a running machine</small>}
								</button>
								<button
									type="button"
									role="menuitem"
									disabled={busy !== undefined || missing}
									onClick={() => {
										setMenu(false);
										ask('recreate');
									}}
									data-terminay-bot-env-action="recreate"
								>
									Recreate
									{missing ? <small>Nothing to recreate yet</small> : null}
								</button>
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										setMenu(false);
										onTabChange('containers');
									}}
								>
									Containers
								</button>
							</div>
						) : null}
					</div>
				</div>
			</div>
			{error ? <div className="bots-note bots-note--error">{error}</div> : null}
			{!overview.current && state !== 'not-created' ? (
				<div
					className="bots-note bots-note--warn"
					data-terminay-bot-env-outdated="true"
				>
					The container was made from an older image or settings.{' '}
					<button
						type="button"
						className="bots-link"
						onClick={() => ask('recreate')}
					>
						Recreate to update
					</button>
					. The home volume is kept.
				</div>
			) : null}
			{overview.limitsChangePending ? (
				<div
					className="bots-note bots-note--warn"
					data-terminay-bot-env-pending="true"
				>
					The new limits apply when the container is recreated.{' '}
					<button
						type="button"
						className="bots-link"
						onClick={() => ask('recreate')}
					>
						Recreate now
					</button>
				</div>
			) : null}
			<div className="bots-ovgrid">
				<section>
					<h3 className="bots-lab">Use it</h3>
					<div className="bots-usegrid">
						<button
							type="button"
							className="bots-usecard"
							disabled={!up}
							onClick={() => onTabChange('desktop')}
							data-terminay-bot-env-use="desktop"
						>
							<Monitor size={18} aria-hidden="true" />
							<strong>Watch the desktop</strong>
							<span className="bots-faint">
								{up ? 'See what the bot sees.' : 'Runs while the machine runs.'}
							</span>
						</button>
						<button
							type="button"
							className="bots-usecard"
							onClick={() => onTabChange('shell')}
							data-terminay-bot-env-use="shell"
						>
							<SquareTerminal size={18} aria-hidden="true" />
							<strong>Open a shell</strong>
							<span className="bots-faint">
								{up ? 'A terminal inside the machine.' : 'Starts the machine.'}
							</span>
						</button>
						<button
							type="button"
							className="bots-usecard"
							onClick={() => onTabChange('files')}
							data-terminay-bot-env-use="files"
						>
							<FolderOpen size={18} aria-hidden="true" />
							<strong>Browse files</strong>
							<span className="bots-faint">The bot’s home folder.</span>
						</button>
					</div>
				</section>
				<aside>
					<h3 className="bots-lab">Activity</h3>
					{activity.length === 0 ? (
						<p className="bots-faint">Nothing yet.</p>
					) : (
						<ol className="bots-tline">
							{activity.map((session) => (
								<li
									key={session.id}
									className={`bots-tline__item bots-tline--${session.state}`}
								>
									<span className="bots-tline__text">
										{sessionTitle(session)}
									</span>
									<span className="bots-faint">
										{SESSION_STATE_LABELS[session.state]} ·{' '}
										{shortAge(session.startedAt, Date.now())} ago
									</span>
								</li>
							))}
						</ol>
					)}
				</aside>
			</div>
			<div className="bots-envfoot">
				<span>
					{overview.limits.cpus} CPU ·{' '}
					{formatBytes(overview.limits.memoryBytes)} ·{' '}
					{overview.image || 'terminay-bot:local'} ·{' '}
					{formatBytes(overview.homeBytes)} home
				</span>
				<button
					type="button"
					className="bots-link"
					aria-expanded={details}
					onClick={() => setDetails((open) => !open)}
					data-terminay-bot-env-details="true"
				>
					Machine details &amp; settings{' '}
					<ChevronDown
						size={12}
						aria-hidden="true"
						style={{ transform: details ? 'rotate(180deg)' : undefined }}
					/>
				</button>
			</div>
			{details ? (
				<div className="bots-ovgrid bots-ovgrid--details">
					<div>
						<section className="bots-card bots-kvcard">
							<div className="bots-kv">
								<span>Image</span>
								<span className="bots-mono">
									{overview.image || '—'}
									{overview.current ? '' : ' · out of date'}
								</span>
							</div>
							<div className="bots-kv">
								<span>Home volume</span>
								<span className="bots-mono">{overview.homeVolume}</span>
							</div>
							<div className="bots-kv">
								<span>Limits</span>
								<span>
									{overview.limits.cpus} CPU ·{' '}
									{formatBytes(overview.limits.memoryBytes)} ·{' '}
									{overview.limits.pids} processes
									{overview.limitsEnforced
										? ''
										: ' (not enforced by this engine)'}
								</span>
							</div>
							<div className="bots-kv">
								<span>Engine socket</span>
								<span>
									{overview.engineSocket === 'proxy'
										? 'Proxied'
										: overview.engineSocket === 'not-created'
											? 'Available when started'
											: 'Recreate to enable proxy'}
								</span>
							</div>
						</section>
						<h3 className="bots-lab bots-mt">Recent log</h3>
						<pre className="bots-term" data-terminay-bot-env-log="true">
							{overview.log.length === 0 ? 'No output yet.' : overview.log}
						</pre>
					</div>
					<aside>
						<section className="bots-card bots-kvcard">
							<div className="bots-kv">
								<span>CPU</span>
								<span>
									{overview.cpuPercent === null
										? '—'
										: `${overview.cpuPercent.toFixed(1)}%`}
								</span>
							</div>
							<div className="bots-kv">
								<span>Memory</span>
								<span>{formatBytes(overview.memoryBytes)}</span>
							</div>
							<div className="bots-kv">
								<span>Home size</span>
								<span>{formatBytes(overview.homeBytes)}</span>
							</div>
							<div className="bots-kv">
								<span className="bots-faint">
									Read{' '}
									{new Date(overview.sampledAt).toLocaleTimeString(undefined, {
										hour: '2-digit',
										minute: '2-digit',
										second: '2-digit',
									})}
								</span>
								<button
									type="button"
									className="bots-btn bots-btn--sm"
									onClick={load}
									data-terminay-bot-env-refresh="true"
								>
									<RefreshCw size={12} aria-hidden="true" /> Refresh
								</button>
							</div>
						</section>
						<EnvironmentSettingsCard
							server={server}
							bot={bot}
							reloadKey={overview.sampledAt}
							onSaved={load}
						/>
					</aside>
				</div>
			) : null}
			{confirm !== undefined ? (
				<div className="bots-modal" role="presentation">
					<div
						className="bots-dialog"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="bots-env-confirm"
					>
						<h2 id="bots-env-confirm">
							{confirm === 'stop'
								? `Stop ${bot.name}?`
								: `Recreate ${bot.name}?`}
						</h2>
						<p>
							A session is running.{' '}
							{confirm === 'stop' ? 'Stopping' : 'Recreating'} ends it, and ends
							every process in the container.
							{confirm === 'recreate' ? ' The home volume is kept.' : ''}
						</p>
						<footer className="bots-dialog__foot">
							<button
								type="button"
								className="bots-btn"
								onClick={() => setConfirm(undefined)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="bots-btn bots-btn--danger"
								onClick={() => {
									const action = confirm;
									setConfirm(undefined);
									lifecycle(action, true);
								}}
							>
								{confirm === 'stop' ? 'Stop' : 'Recreate'}
							</button>
						</footer>
					</div>
				</div>
			) : null}
		</div>
	);
}

function ContainersView({
	server,
	bot,
	onOverview,
}: Readonly<{ server: ServerBots; bot: BotProfile; onOverview: () => void }>) {
	const [list, setList] = useState<readonly BotSiblingContainer[]>();
	const [socketMode, setSocketMode] =
		useState<BotEnvironmentOverview['engineSocket']>();
	const [error, setError] = useState<string>();
	const [logs, setLogs] = useState<{ name: string; text: string }>();
	const [confirmRemove, setConfirmRemove] = useState<string>();
	const removeDialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		if (confirmRemove) removeDialog.current?.showModal();
	}, [confirmRemove]);

	const load = useCallback(() => {
		Promise.all([
			server.environment.containers(bot.id),
			server.environment.overview(bot.id),
		])
			.then(([containers, overview]) => {
				setList(containers);
				setSocketMode(overview.engineSocket);
				setError(undefined);
			})
			.catch((cause: unknown) => setError(refusalText(cause)));
	}, [server.environment, bot.id]);
	useEffect(load, [load]);

	const act = (
		container: BotSiblingContainer,
		action: 'start' | 'stop' | 'restart' | 'logs' | 'remove',
	) => {
		setError(undefined);
		server.environment
			.containerAction(bot.id, container.id, action, action === 'remove')
			.then((result) => {
				if (action === 'logs')
					setLogs({ name: container.name, text: result ?? '' });
				else load();
			})
			.catch((cause: unknown) => setError(refusalText(cause)));
	};

	return (
		<div
			className="bots-scroll bots-cpad"
			data-terminay-bot-env-containers="true"
		>
			<div className="bots-toolbar">
				<div>
					<h3 className="bots-h3">Containers</h3>
					<p className="bots-faint">
						Containers created through this bot’s engine proxy. The bot can also
						control other containers on the shared engine.
					</p>
				</div>
				<button type="button" className="bots-btn bots-btn--sm" onClick={load}>
					<RefreshCw size={12} aria-hidden="true" /> Refresh
				</button>
			</div>
			{error ? <div className="bots-note bots-note--error">{error}</div> : null}
			{socketMode === 'recreate-required' ? (
				<div
					className="bots-card bots-explain"
					data-terminay-bot-proxy-pending="true"
				>
					<b>Recreate to enable the engine proxy</b>
					<span>
						This container needs an update before it can use the shared engine
						with automatic workload attribution. Its home and sign-in are kept.
					</span>
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						onClick={onOverview}
					>
						Open environment overview
					</button>
				</div>
			) : null}
			{list === undefined ? (
				<p className="bots-faint">Loading containers…</p>
			) : list.length === 0 ? (
				<p className="bots-faint">No containers.</p>
			) : (
				<div className="bots-containers">
					<div className="bots-containers__head" aria-hidden="true">
						<span>Container</span>
						<span>Status</span>
						<span>Ports</span>
						<span>Created</span>
						<span />
					</div>
					<ul className="bots-containers__list" aria-label="Bot containers">
						{list.map((container) => {
							const ports = containerPorts(container.ports);
							const running = container.state === 'running';
							return (
								<li
									key={container.id}
									className="bots-container"
									data-terminay-bot-sibling={container.id}
								>
									<div className="bots-container__identity">
										<strong title={container.name}>{container.name}</strong>
										<span className="bots-mono" title={container.image}>
											{container.image}
										</span>
									</div>
									<span
										className={`bots-state bots-container__state${running ? ' bots-state--completed' : ''}`}
									>
										{container.state.charAt(0).toUpperCase() +
											container.state.slice(1)}
									</span>
									<div className="bots-container__ports">
										<span className="bots-container__label">Ports</span>
										{ports.length ? (
											ports.map((port) => (
												<span
													key={port}
													className="bots-container__port bots-mono"
													title="Host → container"
												>
													{port}
												</span>
											))
										) : (
											<span className="bots-faint">None published</span>
										)}
									</div>
									<time
										className="bots-container__created"
										dateTime={container.createdAt || undefined}
										title={
											Number.isFinite(Date.parse(container.createdAt))
												? new Date(container.createdAt).toLocaleString()
												: undefined
										}
									>
										<span className="bots-container__label">Created</span>{' '}
										{containerAge(container.createdAt)}
									</time>
									<div className="bots-container__actions">
										<button
											type="button"
											className="bots-btn bots-btn--sm"
											onClick={() => act(container, running ? 'stop' : 'start')}
										>
											{running ? (
												<Square size={12} aria-hidden="true" />
											) : (
												<Play size={12} aria-hidden="true" />
											)}{' '}
											{running ? 'Stop' : 'Start'}
										</button>
										{running ? (
											<button
												type="button"
												className="bots-btn bots-btn--sm bots-container__icon"
												aria-label={`Restart ${container.name}`}
												title="Restart"
												onClick={() => act(container, 'restart')}
											>
												<RotateCw size={15} aria-hidden="true" />
											</button>
										) : null}
										<button
											type="button"
											className="bots-btn bots-btn--sm bots-container__icon"
											aria-label={`Logs for ${container.name}`}
											title="View logs"
											onClick={() => act(container, 'logs')}
										>
											<ScrollText size={15} aria-hidden="true" />
										</button>
										<button
											type="button"
											className="bots-btn bots-btn--sm bots-container__icon"
											aria-label={`Remove ${container.name}`}
											title="Remove container"
											onClick={() => setConfirmRemove(container.id)}
										>
											<Trash2 size={15} aria-hidden="true" />
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				</div>
			)}
			{confirmRemove ? (
				<dialog
					ref={removeDialog}
					className="bots-dialog bots-container-remove"
					role="alertdialog"
					aria-labelledby="bots-container-remove-title"
					onCancel={() => setConfirmRemove(undefined)}
				>
					<h2 id="bots-container-remove-title">Remove container?</h2>
					<p>
						<strong>
							{list?.find((container) => container.id === confirmRemove)?.name}
						</strong>{' '}
						will be removed. This cannot be undone.
					</p>
					<footer className="bots-dialog__foot">
						<button
							type="button"
							className="bots-btn"
							onClick={() => setConfirmRemove(undefined)}
						>
							Cancel
						</button>
						<button
							type="button"
							className="bots-btn bots-btn--danger"
							onClick={() => {
								const container = list?.find(
									(item) => item.id === confirmRemove,
								);
								setConfirmRemove(undefined);
								if (container) act(container, 'remove');
							}}
						>
							Remove container
						</button>
					</footer>
				</dialog>
			) : null}
			{logs !== undefined ? (
				<section className="bots-mt">
					<div className="bots-toolbar">
						<h3 className="bots-lab">Logs · {logs.name}</h3>
						<button
							type="button"
							className="bots-link"
							onClick={() => setLogs(undefined)}
						>
							Close
						</button>
					</div>
					<pre className="bots-term">{logs.text || 'No output.'}</pre>
				</section>
			) : null}
		</div>
	);
}
