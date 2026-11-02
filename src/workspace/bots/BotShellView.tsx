/**
 * Environment › Shell: an interactive terminal in the bot's container, as
 * `bot` in /home/bot. Opening it starts the container when it is stopped;
 * closing the view ends the shell process.
 */

import { type BotByteStreamClient, BotIoClient } from '@terminay/client-core';
import type { BotProfile } from '@terminay/protocol';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOptionalTerminalSettings } from '../../hooks/useTerminalSettings';
import { buildTerminalOptions } from '../../terminalSettings';
import { refusalText, type ServerBots } from './useServerBots';

type ShellState = 'connecting' | 'open' | 'ended' | 'failed';

let generation = 0;

export function BotShellView({
	server,
	bot,
	visible,
	purpose = 'shell',
	onEnded,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	visible: boolean;
	/** 'sign-in' runs the agent's own sign-in command instead of a shell. */
	purpose?: 'shell' | 'sign-in';
	onEnded?: () => void;
}>) {
	const endedRef = useRef(onEnded);
	endedRef.current = onEnded;
	const host = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<ShellState>('connecting');
	const [error, setError] = useState<string>();
	const [attempt, setAttempt] = useState(0);
	const { settings } = useOptionalTerminalSettings();
	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	const fitRef = useRef<() => void>(() => {});
	const io = useMemo(
		() => new BotIoClient(server.transport as never),
		[server.transport],
	);

	useEffect(() => {
		const el = host.current;
		if (el === null) return;
		let disposed = false;
		let stream: BotByteStreamClient | undefined;
		setState('connecting');
		setError(undefined);
		const xterm = new Terminal({
			...buildTerminalOptions(settingsRef.current),
			cursorBlink: true,
		});
		const fit = new FitAddon();
		xterm.loadAddon(fit);
		xterm.open(el);
		const refit = () => {
			try {
				fit.fit();
			} catch {
				// Hidden: nothing to fit.
			}
		};
		fitRef.current = refit;
		refit();
		const encoder = new TextEncoder();
		// Writes are sent in order, one at a time.
		let queue = Promise.resolve();
		const send = (text: string) => {
			queue = queue
				.then(() => stream?.write(encoder.encode(text)))
				.catch(() => undefined);
		};
		const input = xterm.onData(send);
		const binary = xterm.onBinary((data) => {
			const bytes = Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff);
			queue = queue.then(() => stream?.write(bytes)).catch(() => undefined);
		});
		const resize = xterm.onResize(({ cols, rows }) => {
			void stream?.resize(cols, rows).catch(() => undefined);
		});
		const observer =
			typeof ResizeObserver === 'undefined'
				? undefined
				: new ResizeObserver(refit);
		observer?.observe(el);

		io.shell(bot.id, ++generation, xterm.cols, xterm.rows, {}, purpose)
			.then(async (opened) => {
				if (disposed) {
					await opened.close();
					return;
				}
				stream = opened;
				setState('open');
				xterm.focus();
				for await (const chunk of opened.read()) {
					if (disposed) break;
					xterm.write(chunk);
				}
				if (!disposed) {
					setState('ended');
					xterm.write('\r\n\x1b[2m[Ended]\x1b[0m\r\n');
					endedRef.current?.();
				}
			})
			.catch((cause: unknown) => {
				if (disposed) return;
				setState('failed');
				setError(refusalText(cause));
			});

		return () => {
			disposed = true;
			observer?.disconnect();
			input.dispose();
			binary.dispose();
			resize.dispose();
			void stream?.close();
			xterm.dispose();
		};
	}, [io, bot.id, attempt, purpose]);

	useEffect(() => {
		if (visible) fitRef.current();
	}, [visible]);

	return (
		<div className="bots-shell" data-terminay-bot-shell={state}>
			<div className="bots-shell__bar">
				<span className="bots-faint">
					{state === 'connecting'
						? purpose === 'sign-in'
							? 'Starting sign-in in the bot’s container…'
							: 'Opening a shell (the container starts if it is stopped)…'
						: state === 'open'
							? purpose === 'sign-in'
								? 'Follow the steps below.'
								: 'bot@container:~'
							: state === 'ended'
								? purpose === 'sign-in'
									? 'Sign-in finished.'
									: 'The shell ended.'
								: purpose === 'sign-in'
									? 'Sign-in could not start.'
									: 'The shell could not open.'}
				</span>
				{state === 'ended' || state === 'failed' ? (
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						onClick={() => setAttempt((n) => n + 1)}
						data-terminay-bot-shell-reconnect="true"
					>
						Open again
					</button>
				) : null}
			</div>
			{error ? <div className="bots-note bots-note--error">{error}</div> : null}
			<div className="bots-shell__term" ref={host} />
		</div>
	);
}
