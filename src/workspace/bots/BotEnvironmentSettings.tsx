/**
 * Environment › Overview: the bot's environment settings (Share engine socket,
 * limits, idle stop).
 *
 * Socket and limit changes apply when the container is next recreated; idle
 * stop applies at once. Turning the socket on asks first, in the words the
 * server chose for this engine.
 */

import type {
	BotEnvironmentSettings,
	BotProfile,
	BotResourceLimits,
} from '@terminay/protocol';
import { useCallback, useEffect, useState } from 'react';
import { refusalText, type ServerBots } from './useServerBots';

const GIB = 1024 ** 3;
const MINUTE = 60_000;

/** Idle stop choices; the server accepts 5 minutes to 7 days, or never. */
export const IDLE_STOP_CHOICES: readonly Readonly<{
	label: string;
	value: number | null;
}>[] = [
	{ label: '5 minutes', value: 5 * MINUTE },
	{ label: '15 minutes', value: 15 * MINUTE },
	{ label: '30 minutes', value: 30 * MINUTE },
	{ label: '1 hour', value: 60 * MINUTE },
	{ label: '4 hours', value: 240 * MINUTE },
	{ label: '1 day', value: 1440 * MINUTE },
	{ label: 'Never', value: null },
];

export const SOCKET_CONFIRM: Readonly<
	Record<BotEnvironmentSettings['socketWarning'], string>
> = {
	'root-equivalent':
		'The bot will control every container of this engine. On Linux that is the same as root on this machine.',
	'server-account':
		'The bot will control every container of the account the server runs as.',
	'engine-control': 'The bot will control this engine’s containers.',
};

/** The refusal code a server error carries, through any wrapping. */
export function refusalCode(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current; depth += 1) {
		const code = (current as { code?: unknown }).code;
		if (typeof code === 'string') return code;
		current = (current as { cause?: unknown }).cause;
	}
	return undefined;
}

function idleLabel(value: number | null): string {
	return (
		IDLE_STOP_CHOICES.find((c) => c.value === value)?.label ??
		(value === null ? 'Never' : `${Math.round(value / MINUTE)} minutes`)
	);
}

type LimitsDraft = { cpus: string; memoryGiB: string; pids: string };

function limitsDraft(limits: BotResourceLimits): LimitsDraft {
	return {
		cpus: String(limits.cpus),
		memoryGiB: String(Math.round((limits.memoryBytes / GIB) * 10) / 10),
		pids: String(limits.pids),
	};
}

/** The draft as limits, or the reason it is not valid yet. */
export function parseLimitsDraft(
	draft: LimitsDraft,
): BotResourceLimits | string {
	const cpus = Number(draft.cpus);
	const memory = Number(draft.memoryGiB);
	const pids = Number(draft.pids);
	if (!Number.isFinite(cpus) || cpus <= 0 || cpus > 1024)
		return 'CPUs must be more than 0.';
	if (!Number.isFinite(memory) || memory * GIB < 16 * 1024 * 1024)
		return 'Memory must be at least 16 MiB.';
	if (!Number.isInteger(pids) || pids < 1 || pids > 4_194_304)
		return 'Processes must be a whole number of at least 1.';
	return { cpus, memoryBytes: Math.round(memory * GIB), pids };
}

export function EnvironmentSettingsCard({
	server,
	bot,
	reloadKey,
	onSaved,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	reloadKey: unknown;
	onSaved: () => void;
}>) {
	const [settings, setSettings] = useState<BotEnvironmentSettings>();
	const [draft, setDraft] = useState<LimitsDraft>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [confirmSocket, setConfirmSocket] = useState(false);

	const load = useCallback(() => {
		server.environment
			.settings(bot.id)
			.then((next) => {
				setSettings(next);
				setDraft(limitsDraft(next.limits));
			})
			.catch((cause: unknown) => setError(refusalText(cause)));
	}, [server.environment, bot.id]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is the cue to read again.
	useEffect(load, [load, reloadKey]);

	const save = (
		patch: Omit<
			Parameters<ServerBots['environment']['setSettings']>[0],
			'botId'
		>,
	) => {
		if (settings === undefined) return;
		setBusy(true);
		setError(undefined);
		server.environment
			.setSettings({
				botId: bot.id,
				expectedRevision: settings.revision,
				...patch,
			})
			.then((next) => {
				setSettings(next);
				setDraft(limitsDraft(next.limits));
				onSaved();
			})
			.catch((cause: unknown) => {
				if (refusalCode(cause) === 'conflict') {
					setError(
						'These settings changed elsewhere. They have been read again.',
					);
					load();
				} else setError(refusalText(cause));
			})
			.finally(() => setBusy(false));
	};

	if (settings === undefined || draft === undefined)
		return error ? (
			<div className="bots-note bots-note--error">{error}</div>
		) : null;

	const parsed = parseLimitsDraft(draft);
	const limitsDirty =
		typeof parsed !== 'string' &&
		(parsed.cpus !== settings.limits.cpus ||
			parsed.memoryBytes !== settings.limits.memoryBytes ||
			parsed.pids !== settings.limits.pids);

	return (
		<section
			className="bots-card bots-settings"
			data-terminay-bot-env-settings={settings.revision}
		>
			<h3 className="bots-lab">Settings</h3>
			<div className="bots-kv">
				<span>
					Share engine socket
					<span className="bots-faint bots-block">
						Lets the bot run containers of its own. Applies when the container
						is recreated.
					</span>
				</span>
				<button
					type="button"
					role="switch"
					aria-checked={settings.shareEngineSocket}
					aria-label="Share engine socket"
					className="bots-toggle"
					disabled={busy}
					onClick={() =>
						settings.shareEngineSocket
							? save({ shareEngineSocket: false })
							: setConfirmSocket(true)
					}
					data-terminay-bot-env-socket={settings.shareEngineSocket}
				></button>
			</div>
			<div className="bots-kv">
				<label htmlFor={`bots-idle-${bot.id}`}>
					Stop when idle for
					<span className="bots-faint bots-block">
						No session, shell, or desktop viewer.
					</span>
				</label>
				<select
					id={`bots-idle-${bot.id}`}
					className="bots-in bots-in--sm"
					value={String(settings.idleStopMs)}
					disabled={busy}
					onChange={(event) =>
						save({
							idleStopMs:
								event.target.value === 'null'
									? null
									: Number(event.target.value),
						})
					}
					data-terminay-bot-env-idle="true"
				>
					{IDLE_STOP_CHOICES.some(
						(c) => c.value === settings.idleStopMs,
					) ? null : (
						<option value={String(settings.idleStopMs)}>
							{idleLabel(settings.idleStopMs)}
						</option>
					)}
					{IDLE_STOP_CHOICES.map((choice) => (
						<option key={choice.label} value={String(choice.value)}>
							{choice.label}
						</option>
					))}
				</select>
			</div>
			<form
				className="bots-limits"
				onSubmit={(event) => {
					event.preventDefault();
					if (typeof parsed !== 'string') save({ limits: parsed });
				}}
				data-terminay-bot-env-limits="true"
			>
				<span>
					Limits
					{settings.limitsEnforced ? null : (
						<span className="bots-faint bots-block">
							This engine does not enforce them.
						</span>
					)}
				</span>
				<label>
					<input
						className="bots-in bots-in--sm"
						inputMode="decimal"
						value={draft.cpus}
						onChange={(event) =>
							setDraft({ ...draft, cpus: event.target.value })
						}
						data-terminay-bot-env-limit="cpus"
					/>{' '}
					CPUs
				</label>
				<label>
					<input
						className="bots-in bots-in--sm"
						inputMode="decimal"
						value={draft.memoryGiB}
						onChange={(event) =>
							setDraft({ ...draft, memoryGiB: event.target.value })
						}
						data-terminay-bot-env-limit="memory"
					/>{' '}
					GiB
				</label>
				<label>
					<input
						className="bots-in bots-in--sm"
						inputMode="numeric"
						value={draft.pids}
						onChange={(event) =>
							setDraft({ ...draft, pids: event.target.value })
						}
						data-terminay-bot-env-limit="pids"
					/>{' '}
					processes
				</label>
				<button
					type="submit"
					className="bots-btn bots-btn--sm"
					disabled={busy || !limitsDirty}
					data-terminay-bot-env-limits-save="true"
				>
					Save limits
				</button>
				{typeof parsed === 'string' ? (
					<span className="bots-field-error">{parsed}</span>
				) : null}
			</form>
			{error ? <div className="bots-note bots-note--error">{error}</div> : null}
			{confirmSocket ? (
				<div className="bots-modal" role="presentation">
					<div
						className="bots-dialog"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="bots-socket-confirm"
					>
						<h2 id="bots-socket-confirm">
							Share the engine socket with {bot.name}?
						</h2>
						<p data-terminay-bot-socket-warning={settings.socketWarning}>
							{SOCKET_CONFIRM[settings.socketWarning]}
						</p>
						<p className="bots-faint">
							It applies when the container is next recreated.
						</p>
						<footer className="bots-dialog__foot">
							<button
								type="button"
								className="bots-btn"
								onClick={() => setConfirmSocket(false)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="bots-btn bots-btn--danger"
								onClick={() => {
									setConfirmSocket(false);
									save({ shareEngineSocket: true, confirmed: true });
								}}
								data-terminay-bot-socket-confirm="true"
							>
								Share the socket
							</button>
						</footer>
					</div>
				</div>
			) : null}
		</section>
	);
}
