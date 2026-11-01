/**
 * New bot: the few choices a bot needs before it exists. Everything else is
 * set in its Profile tab, which opens as soon as the bot is created.
 */

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
	const canCreate =
		server !== undefined && name.trim().length > 0 && agent !== undefined;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!canCreate || busy) return;
		setBusy(true);
		setError(undefined);
		server.client
			.save({
				name: name.trim(),
				agentId: agent.id,
				colour,
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
						bot={{ name: name || '?', colour, avatar: '' }}
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
