/**
 * Environment › Desktop, and the context rail's thumbnail.
 *
 * The desktop opens view-only. Each mode is its own stream, bound by the
 * server to this connection, the bot, the mode, and a generation, so changing
 * the mode opens a new stream. In view-only mode the server discards input;
 * the viewer also sets noVNC's own view-only flag.
 */

import RFB from '@novnc/novnc';
import { BotIoClient } from '@terminay/client-core';
import type { BotDesktopMode, BotProfile } from '@terminay/protocol';
import { Eye, Maximize2, MousePointer2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RfbStreamChannel } from './rfbChannel';
import { refusalText, type ServerBots } from './useServerBots';

type DesktopState = 'connecting' | 'open' | 'closed' | 'failed';

let generation = 0;

export function BotDesktopCanvas({
	server,
	bot,
	mode,
	thumbnail = false,
	attempt = 0,
	onState,
}: Readonly<{
	server: ServerBots;
	bot: Pick<BotProfile, 'id'>;
	mode: BotDesktopMode;
	thumbnail?: boolean;
	attempt?: number;
	onState?: (state: DesktopState, error?: string) => void;
}>) {
	const host = useRef<HTMLDivElement>(null);
	const io = useMemo(
		() => new BotIoClient(server.transport as never),
		[server.transport],
	);
	const report = useRef(onState);
	report.current = onState;
	// The thumbnail is always view-only. Otherwise each mode is its own
	// server stream, so the server enforces view-only.
	const streamMode: BotDesktopMode = thumbnail ? 'view-only' : mode;
	// Connections drawn into stacked layers. A new stream draws hidden behind
	// the one on screen and replaces it once connected, so switching modes or
	// reconnecting never flashes an empty frame.
	const layers = useRef<DesktopLayer[]>([]);

	useEffect(() => {
		const root = host.current;
		if (root === null) return;
		const el = document.createElement('div');
		el.className = 'bots-vnc__layer';
		el.style.visibility = layers.current.length > 0 ? 'hidden' : 'visible';
		root.appendChild(el);
		const layer: DesktopLayer = { el, shown: false };
		layers.current.push(layer);
		const others = () => layers.current.filter((l) => l !== layer);
		const show = () => {
			if (layer.retired) return;
			layer.shown = true;
			el.style.visibility = 'visible';
			for (const old of others()) retire(layers.current, old);
			report.current?.('open');
		};
		if (layers.current.length === 1) report.current?.('connecting');
		io.desktop(bot.id, ++generation, streamMode, thumbnail)
			.then((stream) => {
				if (layer.retired) {
					void stream.close();
					return;
				}
				const channel = new RfbStreamChannel(stream);
				const rfb = new RFB(el, channel, { shared: true });
				layer.rfb = rfb;
				layer.channel = channel;
				rfb.viewOnly = streamMode === 'view-only';
				rfb.scaleViewport = true;
				rfb.resizeSession = false;
				rfb.focusOnClick = !thumbnail;
				rfb.background = '#0d0f12';
				// Give noVNC a moment to paint its first frame before swapping.
				rfb.addEventListener('connect', () => setTimeout(show, 150));
				rfb.addEventListener('disconnect', () => {
					if (layer.retired) return;
					retire(layers.current, layer);
					if (layers.current.length === 0) report.current?.('closed');
				});
				channel.start();
			})
			.catch((cause: unknown) => {
				if (layer.retired) return;
				// Never leave a stream of the wrong mode on screen.
				for (const l of [...layers.current]) retire(layers.current, l);
				report.current?.('failed', refusalText(cause));
			});
		return () => {
			// A layer still connecting is abandoned. The one on screen stays
			// until its replacement connects, or until the canvas unmounts.
			if (!layer.shown) retire(layers.current, layer);
		};
	}, [io, bot.id, streamMode, thumbnail, attempt]);

	useEffect(
		() => () => {
			for (const l of [...layers.current]) retire(layers.current, l);
		},
		[],
	);

	return (
		<div
			className={`bots-vnc${thumbnail ? ' bots-vnc--thumb' : ''}`}
			ref={host}
			data-terminay-bot-desktop-mode={mode}
		/>
	);
}

type DesktopLayer = {
	el: HTMLDivElement;
	shown: boolean;
	retired?: boolean;
	rfb?: RFB;
	channel?: RfbStreamChannel;
};

function retire(list: DesktopLayer[], layer: DesktopLayer): void {
	if (layer.retired) return;
	layer.retired = true;
	const at = list.indexOf(layer);
	if (at >= 0) list.splice(at, 1);
	try {
		layer.rfb?.disconnect();
	} catch {
		// Already gone.
	}
	layer.channel?.close();
	layer.el.remove();
}

export function BotDesktopView({
	server,
	bot,
	visible,
}: Readonly<{ server: ServerBots; bot: BotProfile; visible: boolean }>) {
	const [mode, setMode] = useState<BotDesktopMode>('view-only');
	const [state, setState] = useState<DesktopState>('connecting');
	const [error, setError] = useState<string>();
	const [attempt, setAttempt] = useState(0);
	const frame = useRef<HTMLDivElement>(null);
	const environment = server.environments.get(bot.id);

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
						onClick={() => setMode('control')}
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
								: 'Controlling the bot’s desktop.'
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
			{environment !== 'running' && state !== 'open' ? (
				<div className="bots-note">
					The desktop runs while the container runs. Start the bot from
					Overview, or send it a message.
				</div>
			) : null}
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
					/>
				) : null}
			</div>
		</div>
	);
}
