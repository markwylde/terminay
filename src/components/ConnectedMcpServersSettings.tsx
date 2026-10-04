import type {
	ConnectedServer,
	ConnectedServerSave,
	ConnectedServersClient,
	ConnectedServerStatus,
} from '@terminay/client-core';
import {
	type FormEvent,
	type ReactElement,
	useCallback,
	useEffect,
	useState,
} from 'react';
import './ConnectedMcpServersSettings.css';

/**
 * Settings > AI > Connected MCP servers (mcp-app-gateway).
 *
 * Terminay connects to these servers itself and offers their tools to agents
 * through the Terminay MCP server, which is what lets a tool's app window
 * appear in the terminal. A credential is write-only here: once saved, only
 * its name comes back.
 */

type Credential = {
	/** Stable row identity while editing. */
	id: number;
	name: string;
	value: string;
	/** Already stored on the server; the value is not known to this client. */
	stored: boolean;
	remove: boolean;
};

type Draft = {
	previousName?: string;
	name: string;
	enabled: boolean;
	transport: 'stdio' | 'http';
	command: string;
	args: string;
	url: string;
	env: Credential[];
	headers: Credential[];
};

let nextCredentialId = 0;
const stored = (names: readonly string[]): Credential[] =>
	names.map((name) => ({
		id: ++nextCredentialId,
		name,
		value: '',
		stored: true,
		remove: false,
	}));

function draftOf(server?: ConnectedServer): Draft {
	return {
		...(server === undefined ? {} : { previousName: server.name }),
		name: server?.name ?? '',
		enabled: server?.enabled ?? true,
		transport: server?.transport ?? 'stdio',
		command: server?.command ?? '',
		args: (server?.args ?? []).join('\n'),
		url: server?.url ?? '',
		env: stored(server?.envNames ?? []),
		headers: stored(server?.headerNames ?? []),
	};
}

/** What changes: a typed value sets it, a removed row clears it, and a stored
 * row left alone is not mentioned, so the server keeps it. */
export function credentialChanges(
	rows: readonly Pick<Credential, 'name' | 'value' | 'stored' | 'remove'>[],
): Record<string, string | null> {
	const changes: Record<string, string | null> = {};
	for (const row of rows) {
		const name = row.name.trim();
		if (name === '') continue;
		if (row.remove) {
			if (row.stored) changes[name] = null;
		} else if (row.value !== '' || !row.stored) changes[name] = row.value;
	}
	return changes;
}

export function toConnectedServerSave(draft: Draft): ConnectedServerSave {
	const base = {
		...(draft.previousName === undefined ? {} : { previousName: draft.previousName }),
		name: draft.name.trim(),
		enabled: draft.enabled,
	};
	return draft.transport === 'stdio'
		? {
				...base,
				transport: 'stdio',
				command: draft.command.trim(),
				args: draft.args
					.split('\n')
					.map((arg) => arg.trim())
					.filter((arg) => arg !== ''),
				env: credentialChanges(draft.env),
			}
		: {
				...base,
				transport: 'http',
				url: draft.url.trim(),
				headers: credentialChanges(draft.headers),
			};
}

export function connectedServerStatusText(
	status: ConnectedServerStatus | undefined,
	enabled: boolean,
): string {
	if (!enabled || status?.state === 'disabled') return 'Disabled';
	if (status === undefined || status.state === 'idle')
		return 'Starts when an agent first needs it';
	if (status.state === 'connected')
		return `Connected · ${status.tools} tool${status.tools === 1 ? '' : 's'}`;
	return `Not connected: ${status.reason ?? 'it did not answer'}`;
}

export function ConnectedMcpServersSettings(props: {
	readonly client: ConnectedServersClient;
}): ReactElement {
	const { client } = props;
	const [servers, setServers] = useState<readonly ConnectedServer[]>([]);
	const [status, setStatus] = useState<readonly ConnectedServerStatus[]>([]);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			const listed = await client.list();
			setServers(listed.servers);
			setStatus(listed.status);
		} catch {
			// Without authority there is nothing to manage here.
			setServers([]);
			setStatus([]);
		}
	}, [client]);

	useEffect(() => {
		void load();
		try {
			return client.onChanged(() => void load());
		} catch {
			return undefined;
		}
	}, [client, load]);

	const run = async (work: () => Promise<unknown>): Promise<boolean> => {
		setBusy(true);
		setError(null);
		try {
			await work();
			await load();
			return true;
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'The change was not saved.');
			return false;
		} finally {
			setBusy(false);
		}
	};

	const submit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (draft === null) return;
		if (await run(() => client.save(toConnectedServerSave(draft)))) setDraft(null);
	};

	const credentialRows = (kind: 'env' | 'headers', label: string): ReactElement => {
		const rows = draft?.[kind] ?? [];
		const update = (id: number, change: Partial<Credential>): void =>
			setDraft((current) =>
				current === null
					? current
					: {
							...current,
							[kind]: current[kind].map((row) => (row.id === id ? { ...row, ...change } : row)),
						},
			);
		return (
			<fieldset className="connected-servers-credentials">
				<legend>{label}</legend>
				{rows.some((row) => row.stored) ? (
					<p className="connected-servers-hint">
						Saved values are kept only while the {kind === 'env' ? 'command and arguments' : 'address'} stay
						the same. Change {kind === 'env' ? 'them' : 'it'} and you will need to enter the values again.
					</p>
				) : null}
				{rows.map((row) => (
					<div key={row.id} className="connected-servers-credential">
						<input
							aria-label={`${label} name`}
							value={row.name}
							disabled={row.stored}
							placeholder={kind === 'env' ? 'NAME' : 'Header-Name'}
							onChange={(event) => update(row.id, { name: event.target.value })}
						/>
						<input
							aria-label={`${label} value for ${row.name || 'new entry'}`}
							type="password"
							autoComplete="off"
							value={row.value}
							disabled={row.remove}
							placeholder={row.stored ? 'Set. Type to replace.' : 'Value'}
							onChange={(event) => update(row.id, { value: event.target.value })}
						/>
						<button
							type="button"
							aria-pressed={row.remove}
							onClick={() =>
								row.stored
									? update(row.id, { remove: !row.remove })
									: setDraft((current) =>
											current === null
												? current
												: { ...current, [kind]: current[kind].filter((entry) => entry.id !== row.id) },
										)
							}
						>
							{row.remove ? 'Keep' : 'Remove'}
						</button>
					</div>
				))}
				<button
					type="button"
					onClick={() =>
						setDraft((current) =>
							current === null
								? current
								: {
										...current,
										[kind]: [
											...current[kind],
											{ id: ++nextCredentialId, name: '', value: '', stored: false, remove: false },
										],
									},
						)
					}
				>
					Add {kind === 'env' ? 'variable' : 'header'}
				</button>
			</fieldset>
		);
	};

	return (
		<div className="connected-servers">
			<div className="settings-row settings-row--stacked">
				<div className="settings-row-info">
					<span className="settings-row-label">Connected MCP servers</span>
					<span className="settings-row-description">
						Terminay connects to these servers and offers their tools to agents
						through the Terminay MCP server. A tool that has an app shows it in a
						window in the terminal the agent is running in. Connect a server here
						instead of in the agent; in both, its tools appear twice.
					</span>
				</div>
				{servers.length === 0 ? (
					<p className="connected-servers-empty">No servers are connected.</p>
				) : (
					<ul className="connected-servers-list">
						{servers.map((server) => {
							const state = status.find((entry) => entry.name === server.name);
							return (
								<li key={server.name} className="connected-servers-item">
									<div className="connected-servers-item-main">
										<span className="connected-servers-name">{server.name}</span>
										<span className="connected-servers-target">
											{server.transport === 'stdio'
												? [server.command, ...(server.args ?? [])].join(' ')
												: server.url}
										</span>
										<span
											className="connected-servers-status"
											data-state={server.enabled ? (state?.state ?? 'idle') : 'disabled'}
										>
											{connectedServerStatusText(state, server.enabled)}
										</span>
									</div>
									<div className="connected-servers-actions">
										<button
											type="button"
											disabled={busy}
											onClick={() =>
												void run(() =>
													client.save({
														previousName: server.name,
														name: server.name,
														enabled: !server.enabled,
														transport: server.transport,
														...(server.command === undefined ? {} : { command: server.command }),
														...(server.args === undefined ? {} : { args: server.args }),
														...(server.url === undefined ? {} : { url: server.url }),
													}),
												)
											}
										>
											{server.enabled ? 'Disable' : 'Enable'}
										</button>
										<button
											type="button"
											disabled={busy}
											aria-label={`Edit ${server.name}`}
											onClick={() => {
												setError(null);
												setDraft(draftOf(server));
											}}
										>
											Edit
										</button>
										<button
											type="button"
											disabled={busy}
											aria-label={`Remove ${server.name}`}
											onClick={() => void run(() => client.remove(server.name))}
										>
											Remove
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				)}
				{draft === null ? (
					<button
						type="button"
						className="connected-servers-add"
						onClick={() => {
							setError(null);
							setDraft(draftOf());
						}}
					>
						Add server
					</button>
				) : (
					<form className="connected-servers-form" onSubmit={(event) => void submit(event)}>
						<label>
							<span>Name</span>
							<input
								value={draft.name}
								placeholder="diagrams"
								autoCapitalize="none"
								spellCheck={false}
								onChange={(event) => setDraft({ ...draft, name: event.target.value })}
							/>
							<small>
								Lowercase letters, digits, and hyphens. Agents see its tools as{' '}
								<code>{(draft.name.trim() || 'name')}__tool</code>.
							</small>
						</label>
						<label>
							<span>Kind</span>
							<select
								value={draft.transport}
								onChange={(event) =>
									setDraft({ ...draft, transport: event.target.value === 'http' ? 'http' : 'stdio' })
								}
							>
								<option value="stdio">Local command</option>
								<option value="http">Remote URL</option>
							</select>
						</label>
						{draft.transport === 'stdio' ? (
							<>
								<label>
									<span>Command</span>
									<input
										value={draft.command}
										placeholder="npx"
										spellCheck={false}
										onChange={(event) => setDraft({ ...draft, command: event.target.value })}
									/>
									<small>Runs once per project, in the project’s folder.</small>
								</label>
								<label>
									<span>Arguments</span>
									<textarea
										value={draft.args}
										rows={3}
										placeholder={'-y\n@example/mcp-server'}
										spellCheck={false}
										onChange={(event) => setDraft({ ...draft, args: event.target.value })}
									/>
									<small>One per line.</small>
								</label>
								{credentialRows('env', 'Environment variables')}
							</>
						) : (
							<>
								<label>
									<span>URL</span>
									<input
										value={draft.url}
										placeholder="https://mcp.example.com/mcp"
										spellCheck={false}
										onChange={(event) => setDraft({ ...draft, url: event.target.value })}
									/>
								</label>
								{credentialRows('headers', 'Request headers')}
							</>
						)}
						{error === null ? null : (
							<p className="connected-servers-error" role="alert">
								{error}
							</p>
						)}
						<div className="connected-servers-form-actions">
							<button type="submit" disabled={busy}>
								{draft.previousName === undefined ? 'Connect server' : 'Save changes'}
							</button>
							<button type="button" disabled={busy} onClick={() => setDraft(null)}>
								Cancel
							</button>
						</div>
					</form>
				)}
				{draft === null && error !== null ? (
					<p className="connected-servers-error" role="alert">
						{error}
					</p>
				) : null}
			</div>
		</div>
	);
}
