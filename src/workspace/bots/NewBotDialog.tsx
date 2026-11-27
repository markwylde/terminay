/**
 * New bot: the few choices a bot needs before it exists. Everything else is
 * set in its Profile tab, which opens as soon as the bot is created.
 */

import type { BotAvatarStyle } from '@terminay/protocol';
import { X } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { BotAvatar } from './BotAvatar';
import { refusalText, type ServerBots } from './useServerBots';

const COLOURS = [
	'#7cc4f5',
	'#b48cf5',
	'#f5a97c',
	'#7cf5b4',
	'#f57ca8',
	'#f5d97c',
] as const;

export function NewBotDialog({
	servers,
	onClose,
	onCreated,
}: Readonly<{
	servers: ReadonlyMap<string, ServerBots>;
	onClose: () => void;
	onCreated: (serverId: string, botId: string) => void;
}>) {
	const serverList = useMemo(() => [...servers.values()], [servers]);
	const [serverId, setServerId] = useState(serverList[0]?.serverId ?? '');
	const server = servers.get(serverId);
	const agents = server?.agents ?? [];
	const [name, setName] = useState('');
	const [agentId, setAgentId] = useState('');
	const [avatarStyle, setAvatarStyle] = useState<BotAvatarStyle>('critter');
	const [avatar, setAvatar] = useState('');
	const [colour, setColour] = useState<string>(COLOURS[0]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const nameRef = useRef<HTMLInputElement>(null);

	useEffect(() => nameRef.current?.focus(), []);
	useEffect(() => {
		if (!agents.some((agent) => agent.id === agentId))
			setAgentId(agents[0]?.id ?? '');
	}, [agents, agentId]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const agent = agents.find((candidate) => candidate.id === agentId);
	const avatarInvalid =
		avatarStyle === 'character' &&
		[...avatar].length > 2 &&
		!/^\p{Extended_Pictographic}/u.test(avatar);
	const canCreate =
		server !== undefined &&
		name.trim().length > 0 &&
		agent !== undefined &&
		!avatarInvalid;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!canCreate || busy) return;
		setBusy(true);
		setError(undefined);
		server.client
			.save({
				name: name.trim(),
				agentId: agent.id,
				avatarStyle,
				colour,
				...(avatarStyle === 'character' && avatar.trim().length > 0
					? { avatar: avatar.trim() }
					: {}),
				...(agent.autonomousOnly ? { approvalMode: 'autonomous' } : {}),
			})
			.then((bot) => {
				server.refreshBot(bot.id);
				onCreated(server.serverId, bot.id);
			})
			.catch((cause: unknown) => {
				setError(refusalText(cause));
				setBusy(false);
			});
	};

	return (
		<div
			className="bots-modal"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<form
				className="bots-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="bots-new-title"
				onSubmit={submit}
				data-terminay-bots-new-dialog="true"
			>
				<header className="bots-dialog__head">
					<BotAvatar
						bot={{
							name: name.trim() || '?',
							colour,
							avatar,
							avatarStyle,
						}}
						size="md"
					/>
					<h2 id="bots-new-title">New bot</h2>
					<button
						type="button"
						className="bots-icon-btn"
						onClick={onClose}
						aria-label="Close"
					>
						<X size={15} aria-hidden="true" />
					</button>
				</header>
				<label className="bots-field">
					<span>Name</span>
					<input
						ref={nameRef}
						value={name}
						maxLength={40}
						placeholder="Bird"
						onChange={(event) => setName(event.target.value)}
						data-terminay-bots-new-name="true"
					/>
				</label>
				{serverList.length > 1 ? (
					<label className="bots-field">
						<span>Server</span>
						<select
							value={serverId}
							onChange={(event) => setServerId(event.target.value)}
						>
							{serverList.map((candidate) => (
								<option key={candidate.serverId} value={candidate.serverId}>
									{candidate.label}
								</option>
							))}
						</select>
					</label>
				) : null}
				<label className="bots-field">
					<span>Agent</span>
					<select
						value={agentId}
						disabled={agents.length === 0}
						onChange={(event) => setAgentId(event.target.value)}
						data-terminay-bots-new-agent="true"
					>
						{agents.length === 0 ? (
							<option value="">No agents available</option>
						) : null}
						{agents.map((candidate) => (
							<option key={candidate.id} value={candidate.id}>
								{candidate.displayName}
							</option>
						))}
					</select>
					<small className="bots-faint">
						Agents come from extensions. You choose the model in the bot's
						Profile.
					</small>
				</label>
				<div className="bots-field">
					<span>Avatar</span>
					<fieldset className="bots-seg" aria-label="Avatar style">
						<button
							type="button"
							className={avatarStyle === 'critter' ? 'bots-seg--on' : ''}
							aria-pressed={avatarStyle === 'critter'}
							onClick={() => setAvatarStyle('critter')}
							data-terminay-bots-new-avatar-style="critter"
						>
							Critter
						</button>
						<button
							type="button"
							className={avatarStyle === 'character' ? 'bots-seg--on' : ''}
							aria-pressed={avatarStyle === 'character'}
							onClick={() => setAvatarStyle('character')}
							data-terminay-bots-new-avatar-style="character"
						>
							Character
						</button>
					</fieldset>
				</div>
				{avatarStyle === 'character' ? (
					<div className="bots-avatar-picker__character">
						<label className="bots-field bots-avatar-field">
							<span>Character</span>
							<input
								value={avatar}
								placeholder={[...name.trim()][0]?.toUpperCase() ?? 'B'}
								maxLength={8}
								onChange={(event) => setAvatar(event.target.value)}
								data-terminay-bots-new-avatar="true"
							/>
						</label>
						<fieldset className="bots-field">
							<legend>Colour</legend>
							<div className="bots-swatches">
								{COLOURS.map((candidate) => (
									<button
										key={candidate}
										type="button"
										className={`bots-swatch${candidate === colour ? ' bots-swatch--on' : ''}`}
										style={{ background: candidate }}
										aria-label={`Colour ${candidate}`}
										aria-pressed={candidate === colour}
										onClick={() => setColour(candidate)}
									/>
								))}
							</div>
						</fieldset>
					</div>
				) : null}
				{avatarInvalid ? (
					<p className="bots-note bots-note--warn">
						The avatar is one emoji or one character.
					</p>
				) : null}
				{error ? <p className="bots-note bots-note--warn">{error}</p> : null}
				<footer className="bots-dialog__foot">
					<button type="button" className="bots-btn" onClick={onClose}>
						Cancel
					</button>
					<button
						type="submit"
						className="bots-btn bots-btn--primary"
						disabled={!canCreate || busy}
						data-terminay-bots-new-create="true"
					>
						{busy ? 'Creating…' : 'Create bot'}
					</button>
				</footer>
			</form>
		</div>
	);
}
