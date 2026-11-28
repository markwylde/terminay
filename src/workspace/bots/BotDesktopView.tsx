/**
 * Environment › Desktop, and the context rail's thumbnail.
 *
 * The desktop opens view-only. Each mode is its own stream, bound by the
 * server to this connection, the bot, the mode, and a generation, so changing
 * the mode opens a new stream. In view-only mode the server discards input;
 * the viewer also sets noVNC's own view-only flag.
 */

import { BotIoClient } from '@terminay/client-core';
import type { BotDesktopMode, BotProfile } from '@terminay/protocol';
import {
	RemoteDesktopCanvas,
	type RemoteDesktopClassNames,
	type RemoteDesktopClipboardHost,
	type RemoteDesktopSharingState,
	type RemoteDesktopState,
} from '@terminay/remote-desktop/ui';
import { Eye, Maximize2, MousePointer2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktopClipboardHost } from '../../host/desktopClipboardHost';
import { refusalText, type ServerBots } from './useServerBots';

type SharingState = RemoteDesktopSharingState;

type DesktopState = RemoteDesktopState;

const classNames: RemoteDesktopClassNames = {
	root: 'bots-vnc',
	thumbnail: 'bots-vnc--thumb',
	layer: 'bots-vnc__layer',
	pasteCatcher: 'bots-vnc__paste-catcher',
};

/** The device clipboard as this host offers it to a desktop. */
const clipboardHost: RemoteDesktopClipboardHost = desktopClipboardHost;

export function BotDesktopCanvas({
	server,
	bot,
	mode,
	thumbnail = false,
	attempt = 0,
	onState,
	onPasteTooLarge,
	onSharing,
}: Readonly<{
	server: ServerBots;
	bot: Pick<BotProfile, 'id'>;
	mode: BotDesktopMode;
	thumbnail?: boolean;
	attempt?: number;
	onState?: (state: DesktopState, error?: string) => void;
	onPasteTooLarge?: () => void;
	onSharing?: (state: SharingState) => void;
}>) {
	const io = useMemo(
		() => new BotIoClient(server.transport as never),
		[server.transport],
	);
	const open = useCallback(
		(generation: number, streamMode: BotDesktopMode, thumb: boolean) =>
			io.desktop(bot.id, generation, streamMode, thumb),
		[io, bot.id],
	);
	return (
		<RemoteDesktopCanvas
			open={open}
			streamKey={`${clientKey(io)}:${bot.id}`}
			mode={mode}
			thumbnail={thumbnail}
			attempt={attempt}
			clipboard={clipboardHost}
			classNames={classNames}
			describeFailure={refusalText}
			rootAttributes={{ 'data-terminay-bot-desktop-mode': mode }}
			onState={onState}
			onPasteTooLarge={onPasteTooLarge}
			onSharing={onSharing}
		/>
	);
}

/** A new client, which a new transport makes, is a new desktop stream. */
const clientKeys = new WeakMap<object, number>();
let clientCount = 0;
function clientKey(client: object): number {
	let key = clientKeys.get(client);
	if (key === undefined) {
		key = ++clientCount;
		clientKeys.set(client, key);
	}
	return key;
}

export function BotDesktopView({
	server,
	bot,
	visible,
}: Readonly<{ server: ServerBots; bot: BotProfile; visible: boolean }>) {
	const [mode, setMode] = useState<BotDesktopMode>('view-only');
	const [sharing, setSharing] = useState<SharingState>('inactive');
	const [state, setState] = useState<DesktopState>('connecting');
	const [error, setError] = useState<string>();
	const [attempt, setAttempt] = useState(0);
	const [pasteTooLarge, setPasteTooLarge] = useState(false);
	useEffect(() => {
		if (!pasteTooLarge) return;
		const clear = setTimeout(() => setPasteTooLarge(false), 5_000);
		return () => clearTimeout(clear);
	}, [pasteTooLarge]);
	const frame = useRef<HTMLDivElement>(null);

	return (
		<div className="bots-desktop" data-terminay-bot-desktop={state}>
			<div className="bots-shell__bar">
				<fieldset className="bots-seg" aria-label="Desktop mode">
					<button
						type="button"
						className={mode === 'view-only' ? 'bots-seg--on' : ''}
						aria-pressed={mode === 'view-only'}
						onClick={() => setMode('view-only')}
						data-terminay-bot-desktop-mode-button="view-only"
					>
						<Eye size={12} aria-hidden="true" /> View only
					</button>
					<button
						type="button"
						className={mode === 'control' ? 'bots-seg--on' : ''}
						aria-pressed={mode === 'control'}
						onClick={() => {
							setPasteTooLarge(false);
							setMode('control');
						}}
						data-terminay-bot-desktop-mode-button="control"
					>
						<MousePointer2 size={12} aria-hidden="true" /> Control
					</button>
				</fieldset>
				<span className="bots-faint bots-grow">
					{state === 'connecting'
						? 'Connecting…'
						: state === 'open'
							? mode === 'view-only'
								? 'Viewing. Your keyboard and mouse do not reach the bot.'
								: pasteTooLarge
									? 'Too large to paste into the bot.'
									: sharing === 'active'
										? 'Clipboard text is synced both ways while this desktop is open.'
										: sharing === 'syncing'
											? 'Starting clipboard sharing…'
											: sharing === 'unavailable'
												? 'Clipboard sync is unavailable. Use the device’s paste shortcut to send text.'
												: 'Clipboard sharing is inactive. Click the desktop to share here.'
							: state === 'closed'
								? 'Disconnected.'
								: 'The desktop could not open.'}
				</span>
				<button
					type="button"
					className="bots-btn bots-btn--sm"
					onClick={() => setAttempt((n) => n + 1)}
					data-terminay-bot-desktop-reconnect="true"
				>
					<RefreshCw size={12} aria-hidden="true" /> Reconnect
				</button>
				<button
					type="button"
					className="bots-btn bots-btn--sm"
					onClick={() => void frame.current?.requestFullscreen?.()}
				>
					<Maximize2 size={12} aria-hidden="true" /> Full screen
				</button>
			</div>
			{error ? <div className="bots-note bots-note--error">{error}</div> : null}
			<div className="bots-desktop__frame" ref={frame}>
				{visible ? (
					<BotDesktopCanvas
						server={server}
						bot={bot}
						mode={mode}
						attempt={attempt}
						onState={(next, why) => {
							setState(next);
							setError(why);
						}}
						onSharing={setSharing}
						onPasteTooLarge={() => setPasteTooLarge(true)}
					/>
				) : null}
			</div>
		</div>
	);
}
