import type {
	TerminalClientSession,
	TerminalPanelAttachment,
	TerminayTerminalClient,
	TerminayTerminalPanelClient,
} from '@terminay/client-core';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

const MAX_RENDERED_OUTPUT = 64 * 1024;

export interface SharedTerminalRouteBodyProps {
	readonly terminalClient?: TerminayTerminalClient;
	readonly panelClient?: TerminayTerminalPanelClient;
	readonly serverId?: string;
	readonly projectId?: string;
	readonly clientId?: string;
	readonly loading?: boolean;
}

/** One project-scoped terminal lifecycle surface; layout remains workspace-owned. */
export function SharedTerminalRouteBody({
	terminalClient,
	panelClient,
	serverId,
	projectId,
	clientId,
	loading = false,
}: SharedTerminalRouteBodyProps) {
	const [attempt, setAttempt] = useState(0);
	const [sessions, setSessions] = useState<readonly TerminalClientSession[]>(
		[],
	);
	const [status, setStatus] = useState<
		'loading' | 'ready' | 'empty' | 'unavailable' | 'failed'
	>(() => (loading ? 'loading' : 'unavailable'));
	const [error, setError] = useState<string>();
	const [attachment, setAttachment] = useState<TerminalPanelAttachment>();
	const [output, setOutput] = useState('');
	const [input, setInput] = useState('');
	const decoder = useMemo(() => new TextDecoder(), []);

	useEffect(() => {
		if (loading) {
			setStatus('loading');
			return;
		}
		if (
			terminalClient === undefined ||
			panelClient === undefined ||
			serverId === undefined ||
			projectId === undefined ||
			clientId === undefined
		) {
			setStatus('unavailable');
			return;
		}
		let active = true;
		setStatus('loading');
		void terminalClient
			.list(projectId)
			.then((result) => {
				if (!active) return;
				setSessions(result.sessions);
				setStatus(result.sessions.length === 0 ? 'empty' : 'ready');
				setError(undefined);
			})
			.catch((cause) => {
				if (active) {
					setStatus('failed');
					setError(
						message(cause, 'Terminay could not list terminal sessions.'),
					);
				}
			});
		return () => {
			active = false;
		};
	}, [
		attempt,
		clientId,
		loading,
		panelClient,
		projectId,
		serverId,
		terminalClient,
	]);

	useEffect(() => {
		if (attachment === undefined) return;
		const append = (bytes: Uint8Array) =>
			setOutput((current) =>
				boundedOutput(current + decoder.decode(bytes, { stream: true })),
			);
		for (const event of attachment.initialEvents)
			if (event.type === 'output') append(event.bytes);
		const removeOutput = attachment.onOutput((event) => {
			append(event.bytes);
			void attachment.ack(event.nextPosition).catch(() => undefined);
		});
		const removeExit = attachment.onExit((event) =>
			setOutput((current) =>
				boundedOutput(`${current}\n[terminal exited ${event.exitCode}]`),
			),
		);
		const removeResync = attachment.onSkip((event) =>
			setOutput((current) =>
				boundedOutput(`${current}\n[replay resumes at ${event.toPosition}]`),
			),
		);
		return () => {
			removeOutput();
			removeExit();
			removeResync();
			void attachment.detach().catch(() => undefined);
		};
	}, [attachment, decoder]);

	const attach = async (session: TerminalClientSession) => {
		if (panelClient === undefined || clientId === undefined) return;
		setError(undefined);
		try {
			const next = await panelClient.attach({
				serverId: session.serverId,
				projectId: session.projectId,
				sessionId: session.sessionId,
				clientId,
				fromPosition: session.replayFrom,
			});
			setOutput('');
			setAttachment(next);
		} catch (cause) {
			setError(message(cause, 'Terminay could not attach to the terminal.'));
		}
	};

	const create = async () => {
		if (terminalClient === undefined || projectId === undefined) return;
		setError(undefined);
		try {
			const created = await terminalClient.create({
				projectId,
				cols: 80,
				rows: 24,
			});
			setSessions((current) => [...current, created]);
			setStatus('ready');
			await attach(created);
		} catch (cause) {
			setError(message(cause, 'Terminay could not create a terminal.'));
		}
	};

	const submitInput = (event: FormEvent) => {
		event.preventDefault();
		if (attachment === undefined || input.length === 0) return;
		const value = input;
		setInput('');
		void attachment
			.write(value)
			.catch((cause) => setError(message(cause, 'Terminal input failed.')));
	};

	return (
		<main className="shared-production-route" data-shared-route-body="terminal">
			<header>
				<h1>Terminals</h1>
				<p>Server-owned sessions for the selected project.</p>
			</header>
			{status === 'loading' && (
				<p role="status" aria-busy="true">
					Loading terminal sessions…
				</p>
			)}
			{status === 'unavailable' && (
				<p role="status">
					Terminal capability is unavailable for this connection.
				</p>
			)}
			{status === 'failed' && (
				<div role="alert">
					<p>{error}</p>
					<button
						type="button"
						onClick={() => setAttempt((value) => value + 1)}
					>
						Retry terminals
					</button>
				</div>
			)}
			{status === 'empty' && (
				<p role="status">This project has no terminal sessions.</p>
			)}
			{(status === 'ready' || status === 'empty') && (
				<button type="button" onClick={() => void create()}>
					New terminal
				</button>
			)}
			{status === 'ready' && (
				<ul aria-label="Terminal sessions">
					{sessions.map((session) => (
						<li key={session.sessionId}>
							<button type="button" onClick={() => void attach(session)}>
								{session.cwd} — {session.status}
							</button>
						</li>
					))}
				</ul>
			)}
			{error !== undefined && status !== 'failed' && (
				<p role="alert">{error}</p>
			)}
			{attachment !== undefined && (
				<section aria-label="Attached terminal">
					<pre role="log" aria-live="off">
						{output}
					</pre>
					<form onSubmit={submitInput}>
						<label>
							Terminal input
							<input
								value={input}
								onChange={(event) => setInput(event.target.value)}
							/>
						</label>
						<button type="submit">Send input</button>
					</form>
					<button
						type="button"
						onClick={() =>
							void attachment
								.resize({ cols: 100, rows: 30 })
								.catch((cause) =>
									setError(message(cause, 'Terminal resize failed.')),
								)
						}
					>
						Resize terminal
					</button>
					<button
						type="button"
						onClick={() => {
							void attachment.detach();
							setAttachment(undefined);
						}}
					>
						Detach terminal
					</button>
				</section>
			)}
		</main>
	);
}

function boundedOutput(value: string): string {
	return value.slice(-MAX_RENDERED_OUTPUT);
}
function message(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
}
