/**
 * A bot's Profile: who it is, which agent and model it runs, how it asks
 * permission, how it signs in, and deleting it.
 */

import { BotCredentialClient } from '@terminay/client-core';
import type {
	BotApprovalMode,
	BotProfile,
	BotSignIn,
} from '@terminay/protocol';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BotSignInSection } from './BotSignInSection';
import { botActivity, ENVIRONMENT_LABELS } from './botsModel';
import {
	type BotAgentOption,
	type BotAgentState,
	refusalText,
	type ServerBots,
} from './useServerBots';

export const MAX_NAME = 40;
export const MAX_DESCRIPTION = 200;
export const MAX_INSTRUCTIONS_BYTES = 32 * 1024;
export const AUTONOMOUS_ONLY_REASON =
	'This agent cannot ask permission inside a container, so it always runs Autonomous.';

/** The status's own detail (e.g. an image update) reads better than the bare state. */
export function agentStateLabel(status: {
	state: BotAgentState;
	detail?: string;
}): string {
	return status.detail ?? AGENT_STATE_LABELS[status.state];
}

export const AGENT_STATE_LABELS: Readonly<Record<BotAgentState, string>> = {
	ready: 'Ready',
	'not-signed-in': 'Not signed in',
	'not-installed': 'Not in the bot image',
	unavailable: 'Unavailable',
};

const COLOURS = [
	'#7cc4f5',
	'#b48cf5',
	'#f5a97c',
	'#7cf5b4',
	'#f57ca8',
	'#f5d97c',
] as const;

type ProfileForm = Readonly<{
	name: string;
	avatar: string;
	colour: string;
	description: string;
	instructions: string;
	agentId: string;
	modelId: string | null;
	approvalMode: BotApprovalMode;
	maxTurnMinutes: string;
}>;

function formFromBot(bot: BotProfile): ProfileForm {
	return {
		name: bot.name,
		avatar: bot.avatar,
		colour: bot.colour,
		description: bot.description,
		instructions: bot.instructions,
		agentId: bot.agentId,
		modelId: bot.modelId,
		approvalMode: bot.approvalMode,
		maxTurnMinutes: String(Math.round(bot.maxTurnMs / 60_000)),
	};
}

/** Agents grouped under their extension's name, in the order listed. */
export function groupAgents(
	agents: readonly BotAgentOption[],
): readonly Readonly<{
	extension: string;
	agents: readonly BotAgentOption[];
}>[] {
	const groups = new Map<string, BotAgentOption[]>();
	for (const agent of agents) {
		const list = groups.get(agent.extensionName) ?? [];
		list.push(agent);
		groups.set(agent.extensionName, list);
	}
	return [...groups].map(([extension, list]) => ({ extension, agents: list }));
}

/** Why the form cannot be saved, if it cannot. */
export function profileProblem(form: ProfileForm): string | undefined {
	if (form.name.trim().length === 0) return 'Give the bot a name.';
	if ([...form.name.trim()].length > MAX_NAME)
		return `A name is at most ${MAX_NAME} characters.`;
	if (
		[...form.avatar].length > 2 &&
		!/^\p{Extended_Pictographic}/u.test(form.avatar)
	)
		return 'The avatar is one emoji or one character.';
	if ([...form.description].length > MAX_DESCRIPTION)
		return `A description is at most ${MAX_DESCRIPTION} characters.`;
	if (
		new TextEncoder().encode(form.instructions).length > MAX_INSTRUCTIONS_BYTES
	)
		return 'Instructions are at most 32 KiB.';
	const minutes = Number(form.maxTurnMinutes);
	if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60)
		return 'The maximum turn is a whole number of minutes, 1 to 1440.';
	return undefined;
}

export function BotProfilePanel({
	server,
	bot,
	onDeleted,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	onDeleted: (warning?: string) => void;
}>) {
	const [form, setForm] = useState<ProfileForm>(() => formFromBot(bot));
	const [base, setBase] = useState(bot);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [saved, setSaved] = useState(false);
	const credentials = useMemo(
		() => new BotCredentialClient(server.transport as never),
		[server.transport],
	);
	const update = (patch: Partial<ProfileForm>) => {
		setSaved(false);
		setForm((current) => ({ ...current, ...patch }));
	};

	// Another device saved: take its values for fields this one has not
	// touched.
	useEffect(() => {
		if (bot.updatedAt === base.updatedAt) return;
		const before = formFromBot(base);
		const after = formFromBot(bot);
		setForm((current) => {
			const next: Record<string, unknown> = { ...current };
			for (const key of Object.keys(after) as (keyof ProfileForm)[])
				if (current[key] === before[key]) next[key] = after[key];
			return next as ProfileForm;
		});
		setBase(bot);
	}, [bot, base]);

	const agent = server.agents.find((a) => a.id === form.agentId);
	const autonomousOnly = agent?.autonomousOnly === true;
	const approvalMode: BotApprovalMode = autonomousOnly
		? 'autonomous'
		: form.approvalMode;
	const problem = profileProblem(form);
	const original = formFromBot(base);
	const dirty = (Object.keys(form) as (keyof ProfileForm)[]).some(
		(key) => form[key] !== original[key],
	);

	const save = () => {
		if (problem !== undefined || busy) return;
		setBusy(true);
		setError(undefined);
		server.client
			.save({
				id: bot.id,
				name: form.name.trim(),
				avatar: form.avatar.trim(),
				colour: form.colour,
				description: form.description,
				instructions: form.instructions,
				agentId: form.agentId,
				modelId: form.modelId,
				approvalMode,
				maxTurnMs: Number(form.maxTurnMinutes) * 60_000,
			})
			.then((next) => {
				setBase(next);
				setForm(formFromBot(next));
				setSaved(true);
				server.refreshBot(bot.id);
			})
			.catch((cause: unknown) => setError(refusalText(cause)))
			.finally(() => setBusy(false));
	};

	const saveSignIn = (signIn: BotSignIn) =>
		server.client
			.save({ id: bot.id, name: bot.name, agentId: bot.agentId, signIn })
			.then(() => server.refreshBot(bot.id));

	const sessions = server.sessions.get(bot.id) ?? [];
	const environment = server.environments.get(bot.id) ?? 'unknown';
	const activity = botActivity(sessions, environment);

	return (
		<div className="bots-scroll bots-cpad" data-terminay-bot-panel="profile">
			<div className="bots-form">
				<div className="bots-form__col">
					<div className="bots-form__row bots-form__row--name">
						<label className="bots-field bots-grow">
							<span>Name</span>
							<input
								value={form.name}
								maxLength={MAX_NAME}
								onChange={(event) => update({ name: event.target.value })}
								data-terminay-bot-profile="name"
							/>
						</label>
						<label className="bots-field bots-avatar-field">
							<span>Avatar</span>
							<input
								value={form.avatar}
								placeholder={[...form.name.trim()][0]?.toUpperCase() ?? 'B'}
								maxLength={8}
								onChange={(event) => update({ avatar: event.target.value })}
								data-terminay-bot-profile="avatar"
							/>
						</label>
						<fieldset className="bots-field">
							<legend>Colour</legend>
							<div className="bots-swatches">
								{COLOURS.map((colour) => (
									<button
										key={colour}
										type="button"
										className={`bots-swatch${colour === form.colour ? ' bots-swatch--on' : ''}`}
										style={{ background: colour }}
										aria-label={`Colour ${colour}`}
										aria-pressed={colour === form.colour}
										onClick={() => update({ colour })}
									/>
								))}
							</div>
						</fieldset>
					</div>
					<label className="bots-field">
						<span>Description</span>
						<input
							value={form.description}
							maxLength={MAX_DESCRIPTION}
							placeholder="What this bot is for"
							onChange={(event) => update({ description: event.target.value })}
							data-terminay-bot-profile="description"
						/>
					</label>
					<label className="bots-field">
						<span>Bio / instructions</span>
						<textarea
							value={form.instructions}
							placeholder="How this bot should work. Given to the agent at the start of every session."
							onChange={(event) => update({ instructions: event.target.value })}
							data-terminay-bot-profile="instructions"
						/>
						<small className="bots-faint">
							{new TextEncoder()
								.encode(form.instructions)
								.length.toLocaleString()}{' '}
							of 32,768 bytes. Pinned memories follow them in each session’s
							context.
						</small>
					</label>
					<div className="bots-form__row">
						<div className="bots-field">
							<span>Agent</span>
							<AgentPicker
								agents={server.agents}
								value={form.agentId}
								savedAgentId={base.agentId}
								onChange={(agentId) =>
									// Models follow the agent: a new agent starts on Default.
									update({ agentId, modelId: null })
								}
								onBuildImage={() =>
									void server.transport
										.command('bots.image.build', {})
										.catch((cause: unknown) => setError(refusalText(cause)))
										// Show the build at once; the list refreshes until it ends.
										.finally(() => server.refreshAgents())
								}
							/>
						</div>
						<label className="bots-field">
							<span>Model</span>
							<select
								value={form.modelId ?? ''}
								disabled={agent === undefined}
								onChange={(event) =>
									update({ modelId: event.target.value || null })
								}
								data-terminay-bot-profile="model"
							>
								<option value="">Default</option>
								{form.modelId !== null &&
								!agent?.models.some((m) => m.id === form.modelId) ? (
									<option value={form.modelId}>{form.modelId}</option>
								) : null}
								{agent?.models.map((model) => (
									<option key={model.id} value={model.id}>
										{model.displayName}
									</option>
								))}
							</select>
							<small className="bots-faint">
								{agent !== undefined && !agent.modelsAvailable
									? 'This agent did not list its models. Default lets it choose.'
									: 'Default lets the agent choose.'}
							</small>
						</label>
					</div>
					<div className="bots-form__row">
						<div className="bots-field">
							<span>Approval</span>
							<fieldset className="bots-seg" aria-label="Approval mode">
								<button
									type="button"
									className={
										approvalMode === 'autonomous' ? 'bots-seg--on' : ''
									}
									aria-pressed={approvalMode === 'autonomous'}
									onClick={() => update({ approvalMode: 'autonomous' })}
									data-terminay-bot-approval="autonomous"
								>
									Autonomous
								</button>
								<button
									type="button"
									className={approvalMode === 'ask' ? 'bots-seg--on' : ''}
									aria-pressed={approvalMode === 'ask'}
									disabled={autonomousOnly}
									onClick={() => update({ approvalMode: 'ask' })}
									data-terminay-bot-approval="ask"
								>
									Ask me
								</button>
							</fieldset>
							<small
								className="bots-faint"
								data-terminay-bot-approval-note="true"
							>
								{autonomousOnly
									? AUTONOMOUS_ONLY_REASON
									: approvalMode === 'autonomous'
										? 'The agent’s requests are allowed once each. It acts only inside the bot’s container.'
										: 'Each request waits for you, here and in Needs you.'}
							</small>
						</div>
						<label className="bots-field">
							<span>Maximum turn (minutes)</span>
							<input
								type="number"
								min={1}
								max={1440}
								value={form.maxTurnMinutes}
								onChange={(event) =>
									update({ maxTurnMinutes: event.target.value })
								}
							/>
						</label>
					</div>
					<div className="bots-actionrow">
						<span className="bots-actionrow__msg">
							{error ? (
								<span className="bots-need" role="alert">
									{error}
								</span>
							) : problem && dirty ? (
								<span className="bots-need">{problem}</span>
							) : saved ? (
								<span className="bots-done">
									Saved. Applies to sessions that start from now.
								</span>
							) : dirty ? (
								<span className="bots-faint">Unsaved changes</span>
							) : null}
						</span>
						{dirty ? (
							<button
								type="button"
								className="bots-btn"
								disabled={busy}
								onClick={() => {
									setForm(formFromBot(base));
									setError(undefined);
								}}
							>
								Revert
							</button>
						) : null}
						<button
							type="button"
							className="bots-btn bots-btn--primary"
							disabled={!dirty || busy || problem !== undefined}
							onClick={save}
							data-terminay-bot-profile-save="true"
						>
							{busy ? 'Saving…' : 'Save'}
						</button>
						<DeleteBot server={server} bot={bot} onDeleted={onDeleted} />
					</div>
				</div>
				<aside className="bots-form__side">
					<section
						className="bots-card bots-side-card"
						data-terminay-bot-summary="true"
					>
						<h3 className="bots-lab">Summary</h3>
						<div className="bots-kv">
							<span>Sessions</span>
							<span>{sessions.length}</span>
						</div>
						<div className="bots-kv">
							<span>Agent</span>
							<span>{agent?.displayName ?? form.agentId}</span>
						</div>
						<div className="bots-kv">
							<span>Machine</span>
							<span
								className={`bots-chip bots-chip--small bots-chip--${activity}`}
							>
								{ENVIRONMENT_LABELS[environment]}
							</span>
						</div>
					</section>
					<section className="bots-card bots-side-card">
						<BotSignInSection
							server={server}
							bot={bot}
							agent={server.agents.find((a) => a.id === bot.agentId)}
							credentials={credentials}
							onSignInChange={saveSignIn}
						/>
					</section>
				</aside>
			</div>
		</div>
	);
}

function AgentPicker({
	agents,
	value,
	savedAgentId,
	onChange,
	onBuildImage,
}: Readonly<{
	agents: readonly BotAgentOption[];
	value: string;
	savedAgentId: string;
	onChange: (agentId: string) => void;
	onBuildImage: () => void;
}>) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const current = agents.find((a) => a.id === value);
	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (!root.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		window.addEventListener('mousedown', onDown);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('mousedown', onDown);
			window.removeEventListener('keydown', onKey);
		};
	}, [open]);
	return (
		<div className="bots-dd" ref={root}>
			<button
				type="button"
				className="bots-in bots-dd__btn"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				data-terminay-bot-profile="agent"
			>
				<span className="bots-grow">
					{current?.displayName ?? value}
					{current === undefined ? (
						<span className="bots-need"> · Unavailable</span>
					) : current.status.state === 'ready' ? null : (
						<span className="bots-need">
							{' '}
							· {agentStateLabel(current.status)}
						</span>
					)}
				</span>
				<ChevronDown size={14} aria-hidden="true" />
			</button>
			{current === undefined && value === savedAgentId ? (
				<small className="bots-need">
					The extension that provided this agent is disabled or removed. The bot
					starts no session until you choose a ready agent.
				</small>
			) : null}
			{current?.status.state !== 'ready' && current?.status.action ? (
				<AgentAction agent={current} onBuildImage={onBuildImage} />
			) : null}
			{open ? (
				<div className="bots-card bots-dd__panel" role="listbox">
					{agents.length === 0 ? (
						<p className="bots-faint bots-pad">
							No installed extension offers bot agents.
						</p>
					) : (
						groupAgents(agents).map((group) => (
							<fieldset key={group.extension} aria-label={group.extension}>
								<div className="bots-dd__grp">{group.extension}</div>
								{group.agents.map((agent) => (
									<button
										key={agent.id}
										type="button"
										role="option"
										aria-selected={agent.id === value}
										className={`bots-dd__opt${agent.id === value ? ' bots-dd__opt--on' : ''}`}
										onClick={() => {
											if (agent.id !== value) onChange(agent.id);
											setOpen(false);
										}}
										data-terminay-bot-agent-option={agent.id}
										data-terminay-bot-agent-state={agent.status.state}
									>
										<span className="bots-dd__check">
											{agent.id === value ? (
												<Check size={13} aria-hidden="true" />
											) : null}
										</span>
										<span className="bots-grow">
											<b>{agent.displayName}</b>
											<span className="bots-dd__sub">
												{agentStateLabel(agent.status)}
												{agent.status.action
													? ` · ${agent.status.action.label}`
													: agent.status.detail
														? ` · ${agent.status.detail}`
														: ''}
												{agent.autonomousOnly ? ' · Autonomous only' : ''}
											</span>
										</span>
									</button>
								))}
							</fieldset>
						))
					)}
				</div>
			) : null}
		</div>
	);
}

function AgentAction({
	agent,
	onBuildImage,
}: Readonly<{ agent: BotAgentOption; onBuildImage: () => void }>) {
	const action = agent.status.action;
	if (action === undefined) return null;
	return (
		<div
			className="bots-note bots-note--warn"
			data-terminay-bot-agent-action={action.kind}
		>
			{agentStateLabel(agent.status)}.{' '}
			{action.kind === 'build-image' ? (
				<button type="button" className="bots-link" onClick={onBuildImage}>
					{action.label}
				</button>
			) : (
				action.label
			)}
		</div>
	);
}

function DeleteBot({
	server,
	bot,
	onDeleted,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	onDeleted: (warning?: string) => void;
}>) {
	const [confirming, setConfirming] = useState(false);
	const [deleteHome, setDeleteHome] = useState(false);
	const [siblings, setSiblings] = useState<number>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();

	useEffect(() => {
		if (!confirming) return;
		let live = true;
		server.environment
			.containers(bot.id)
			.then((list) => {
				if (live) setSiblings(list.length);
			})
			.catch(() => {
				if (live) setSiblings(0);
			});
		return () => {
			live = false;
		};
	}, [confirming, server.environment, bot.id]);

	return (
		<>
			<button
				type="button"
				className="bots-btn bots-btn--danger"
				onClick={() => setConfirming(true)}
				data-terminay-bot-delete="true"
			>
				Delete…
			</button>
			{confirming ? (
				<div className="bots-modal" role="presentation">
					<div
						className="bots-dialog"
						role="alertdialog"
						aria-label={`Delete ${bot.name}`}
					>
						<div className="bots-dialog__head">
							<h2>Delete {bot.name}?</h2>
						</div>
						<p className="bots-faint">
							This ends its running session, then removes its container,
							network, triggers, and session history.
						</p>
						{siblings === undefined ? null : siblings > 0 ? (
							<p data-terminay-bot-delete-siblings={siblings}>
								{bot.name} started {siblings} container
								{siblings === 1 ? '' : 's'} through the engine socket.{' '}
								{siblings === 1 ? 'It keeps' : 'They keep'} running.
							</p>
						) : null}
						<label className="bots-check">
							<input
								type="checkbox"
								checked={deleteHome}
								onChange={(event) => setDeleteHome(event.target.checked)}
								data-terminay-bot-delete-home="true"
							/>
							Also delete its home volume (files and memories)
						</label>
						{error ? <p className="bots-need">{error}</p> : null}
						<footer className="bots-dialog__foot">
							<button
								type="button"
								className="bots-btn"
								onClick={() => setConfirming(false)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="bots-btn bots-btn--danger"
								disabled={busy}
								onClick={() => {
									setBusy(true);
									server.client
										.remove(bot.id, deleteHome, true)
										.then((result) => {
											if (result?.warning)
												server.reportWarning?.(result.warning);
											onDeleted();
											server.refresh();
										})
										.catch((cause: unknown) => {
											setError(refusalText(cause));
											setBusy(false);
										});
								}}
								data-terminay-bot-delete-confirm="true"
							>
								{deleteHome ? 'Delete bot and home' : 'Delete bot, keep home'}
							</button>
						</footer>
					</div>
				</div>
			) : null}
		</>
	);
}
