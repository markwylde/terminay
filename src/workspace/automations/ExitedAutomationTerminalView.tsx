/**
 * A kept automation terminal after its process exited, as a real terminal.
 *
 * "Keep terminal after run" keeps the run terminal open until a person closes
 * it. Its process has ended, so there is nothing to type into or resize: this
 * view attaches read-only, which the server allows only for an exited terminal
 * it still retains, and renders the bounded retained output and the exit in
 * an xterm of its own. Closing it closes the terminal on the server.
 */

import {
	type TerminalPanelAttachment,
	type TerminalStreamExitEvent,
	TerminayTerminalPanelClient,
} from '@terminay/client-core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { useOptionalTerminalSettings } from '../../hooks/useTerminalSettings';
import type { WorkspaceConnectionContext } from '../../shared/connections/connectionRegistry';
import { buildTerminalOptions } from '../../terminalSettings';
import type { AutomationSpaceTerminal } from './automationsModel';

export type ExitedAutomationTerminalViewProps = Readonly<{
	context: WorkspaceConnectionContext;
	serverId: string;
	projectId: string;
	terminal: AutomationSpaceTerminal;
	/** A person closed the terminal: close it on the server. */
	onClose: (panelId: string) => void;
}>;

type ViewState =
	| Readonly<{ kind: 'loading' }>
	| Readonly<{ kind: 'ready'; exit?: TerminalStreamExitEvent }>
	| Readonly<{ kind: 'unavailable' }>;

const EARLIER_OUTPUT_NOTICE =
	'\x1b[2m[Earlier output is no longer kept.]\x1b[0m\r\n';

function describeExit(exit: TerminalStreamExitEvent | undefined): string {
	if (exit === undefined) return 'Exited';
	if (exit.signal !== null && exit.signal !== 0)
		return `Stopped by signal ${exit.signal}`;
	return `Exited with code ${exit.exitCode}`;
}

export function ExitedAutomationTerminalView({
	context,
	onClose,
	projectId,
	serverId,
	terminal,
}: ExitedAutomationTerminalViewProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [state, setState] = useState<ViewState>({ kind: 'loading' });
	const { settings } = useOptionalTerminalSettings();
	// The xterm is created once per terminal; later setting changes do not
	// replay the output again.
	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	const { client, clientId } = context;
	const { sessionId } = terminal;

	useEffect(() => {
		const host = hostRef.current;
		if (host === null) return;
		let disposed = false;
		let attachment: TerminalPanelAttachment | undefined;
		setState({ kind: 'loading' });
		const xterm = new Terminal({
			...buildTerminalOptions(settingsRef.current),
			cursorBlink: false,
			cursorInactiveStyle: 'none',
			disableStdin: true,
		});
		const fit = new FitAddon();
		xterm.loadAddon(fit);
		xterm.open(host);
		const refit = () => {
			try {
				fit.fit();
			} catch {
				// A hidden or detached host has no size to fit to.
			}
		};
		refit();
		const observer =
			typeof ResizeObserver === 'undefined'
				? undefined
				: new ResizeObserver(refit);
		observer?.observe(host);

		void new TerminayTerminalPanelClient(client)
			.attach({ serverId, projectId, sessionId, clientId, readOnly: true })
			.then((opened) => {
				if (disposed) {
					void opened.detach().catch(() => undefined);
					return;
				}
				attachment = opened;
				let exit: TerminalStreamExitEvent | undefined;
				for (const event of opened.initialEvents) {
					if (event.type === 'output') xterm.write(event.bytes);
					else if (event.type === 'skip') xterm.write(EARLIER_OUTPUT_NOTICE);
					else if (event.type === 'exit') exit = event;
				}
				setState({ kind: 'ready', ...(exit === undefined ? {} : { exit }) });
			})
			.catch(() => {
				// The server no longer holds this terminal's output (it restarted,
				// or the terminal was closed elsewhere). The run keeps its tail.
				if (!disposed) setState({ kind: 'unavailable' });
			});

		return () => {
			disposed = true;
			observer?.disconnect();
			if (attachment !== undefined)
				void attachment.detach().catch(() => undefined);
			xterm.dispose();
		};
	}, [client, clientId, projectId, serverId, sessionId]);

	return (
		<div
			className="automations-exited-terminal"
			data-terminay-automation-exited-terminal={sessionId}
			data-terminay-automation-exited-terminal-state={state.kind}
		>
			<div className="automations-exited-terminal__header">
				<span className="automations-exited-terminal__title">
					{terminal.title}
				</span>
				<span
					className="automations-muted"
					data-terminay-automation-exited-terminal-exit="true"
				>
					{state.kind === 'ready'
						? `${describeExit(state.exit)} · read-only`
						: state.kind === 'loading'
							? 'Loading…'
							: terminal.status === 'interrupted'
								? 'Interrupted'
								: 'Exited'}
				</span>
				<button
					type="button"
					className="automations-button automations-button--quiet"
					data-terminay-automation-exited-terminal-close="true"
					onClick={() => onClose(terminal.panelId)}
				>
					Close
				</button>
			</div>
			{state.kind === 'unavailable' ? (
				<p className="automations-muted automations-exited-terminal__notice">
					The server no longer holds this terminal’s output. Its run keeps
					the final output in the run’s detail above.
				</p>
			) : null}
			<div
				ref={hostRef}
				className="automations-exited-terminal__screen"
				hidden={state.kind === 'unavailable'}
			/>
		</div>
	);
}
