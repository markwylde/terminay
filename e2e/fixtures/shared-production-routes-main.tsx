import {
	ConnectionProfileStore,
	FileViewerClient,
	MacroClient,
	McpServerControlClient,
	RecordingsClient,
	WorkspaceClient,
} from '@terminay/client-core';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SharedAgentRouteBody } from '../../src/shared/SharedAgentRouteBody';
import { SharedConnectionsRouteBody } from '../../src/shared/SharedConnectionsRouteBody';
import { SharedFolderRouteBody } from '../../src/shared/SharedFolderRouteBody';
import { SharedGitRouteBody } from '../../src/shared/SharedGitRouteBody';
import { SharedMacroRouteBody } from '../../src/shared/SharedMacroRouteBody';
import { SharedRecordingsRouteBody } from '../../src/shared/SharedRecordingsRouteBody';
import { SharedSettingsRouteBody } from '../../src/shared/SharedSettingsRouteBody';
import { SharedTerminalRouteBody } from '../../src/shared/SharedTerminalRouteBody';
import { WorkspaceSplitLayout } from '../../src/shared/WorkspaceSplitLayout';
import '../../src/shared/SharedProductionRoutes.css';
import type {
	AgentStatusClient,
	TerminalPanelAttachment,
	TerminayGitClient,
	TerminayTerminalClient,
	TerminayTerminalPanelClient,
} from '@terminay/client-core';

const failedGitClient = {
	list: async () => {
		throw new Error('Repository status failed');
	},
} as unknown as TerminayGitClient;
const connectionActions: string[] = [];
(window as unknown as { __connectionActions: string[] }).__connectionActions =
	connectionActions;
const connectionProfiles = new ConnectionProfileStore();
connectionProfiles.remember({
	id: 'remote:test',
	serverId: 'server:remote',
	label: 'Remote',
	origin: 'https://terminay.example',
	status: 'offline',
});
const canonicalConnectionStates = [
	{ label: 'Disconnected', status: 'offline' },
	{ label: 'Unreachable', status: 'unreachable' },
	{ label: 'Expired', status: 'expired' },
	{ label: 'Revoked', status: 'revoked' },
	{ label: 'Already connected', status: 'connected' },
] as const;
const canonicalConnectionStateStores = canonicalConnectionStates.map(
	({ label, status }) => {
		const store = new ConnectionProfileStore({ local: false });
		const profile = store.remember({
			id: `server:${status}`,
			serverId: `server:${status}`,
			label,
			origin: `https://${status}.example`,
			status,
		});
		if (status === 'connected') store.select(profile.id);
		return { label, store };
	},
);
const emptyConnectionStateStore = new ConnectionProfileStore({ local: false });
const mobileLifecycleActions: string[] = [];
(
	window as unknown as { __mobileLifecycleActions: string[] }
).__mobileLifecycleActions = mobileLifecycleActions;
const mobileLifecycleProfiles = new ConnectionProfileStore();
const mobileLifecycleProfile = mobileLifecycleProfiles.remember({
	id: 'server:mobile-lifecycle',
	serverId: 'server:mobile-lifecycle',
	label: 'Mobile lifecycle server',
	origin: 'https://mobile-lifecycle.example',
	status: 'connected',
});
mobileLifecycleProfiles.select(mobileLifecycleProfile.id);

function MobileServerLifecycleWorkflow() {
	const [, setRevision] = useState(0);
	const refresh = () => setRevision((value) => value + 1);
	return (
		<section aria-label="Mobile server lifecycle">
			<SharedConnectionsRouteBody
				state="ready"
				profileStore={mobileLifecycleProfiles}
				onSelect={() => undefined}
			/>
			<button
				type="button"
				onClick={() => {
					mobileLifecycleActions.push('restart-detected');
					mobileLifecycleProfiles.markStatus(
						mobileLifecycleProfile.id,
						'offline',
					);
					refresh();
				}}
			>
				Detect server restart
			</button>
			<button
				type="button"
				onClick={() => {
					mobileLifecycleActions.push('retry');
					mobileLifecycleProfiles.markStatus(
						mobileLifecycleProfile.id,
						'connecting',
					);
					refresh();
					window.setTimeout(() => {
						mobileLifecycleActions.push('recovered');
						mobileLifecycleProfiles.markStatus(
							mobileLifecycleProfile.id,
							'connected',
						);
						refresh();
					}, 50);
				}}
			>
				Retry connection
			</button>
		</section>
	);
}
const gitActions: string[] = [];
(window as unknown as { __gitActions: string[] }).__gitActions = gitActions;
const readyGitClient = {
	host: {
		has: (capability: string) =>
			capability === 'nativeWindows' || capability === 'clipboard',
	},
	list: async () => ({
		projectId: 'project:test',
		repositoryId: 'repo:test',
		bounded: true,
		worktrees: [
			{
				id: 'worktree:main',
				repositoryId: 'repo:test',
				branch: 'main',
				head: 'abc123',
				state: 'dirty',
				isMain: false,
				entries: [{ path: 'README.md' }],
			},
		],
	}),
	pull: async () => {
		gitActions.push('pull');
		return {};
	},
	remove: async () => {
		gitActions.push('remove');
		return {};
	},
	renamePresentation: async () => {
		gitActions.push('rename');
		return {};
	},
	openTerminal: async () => {
		gitActions.push('open');
		return {};
	},
	switchProject: async () => {
		gitActions.push('switch');
		return {};
	},
	reveal: async () => {
		gitActions.push('reveal');
		return {};
	},
	copy: async () => {
		gitActions.push('copy');
		return {};
	},
	proposeQuickPush: async () => {
		gitActions.push('propose');
		return {
			proposalId: 'proposal:test',
			revision: { head: 'abc123' },
			actionDigest: 'digest:test',
			targetBranch: 'main',
			actions: [{ kind: 'push' }, { kind: 'pull-request' }],
		};
	},
	approveQuickPush: async () => {
		gitActions.push('approve');
		return { applied: true };
	},
} as unknown as TerminayGitClient;
const agentSnapshot = {
	revision: 1,
	cursor: '1',
	entries: {
		'agent:test': {
			entryId: 'agent:test',
			kind: 'root',
			provider: 'codex',
			agentId: 'codex:test',
			sessionId: 'session:test',
			activationTerminalSessionId: 'terminal:test',
			state: 'blocked',
			active: true,
			unread: true,
		},
	},
} as const;
const agentClient = {
	snapshot: agentSnapshot,
	onChange: () => () => undefined,
	refresh: async () => ({ kind: 'ignored', revision: 1, changed: false }),
} as unknown as AgentStatusClient;
const readyFiles = {
	listFolder: async () => ({
		root: '.',
		offset: 0,
		truncated: true,
		entries: [
			{
				name: 'README.md',
				relativePath: 'README.md',
				kind: 'file',
				isSymbolicLink: false,
				accessible: true,
				size: 42,
			},
		],
	}),
} as unknown as FileViewerClient;
const emptyFiles = {
	listFolder: async () => ({
		root: '.',
		offset: 0,
		truncated: false,
		entries: [],
	}),
} as unknown as FileViewerClient;
const failedFiles = {
	listFolder: async () => {
		throw new Error('File catalog failed');
	},
} as unknown as FileViewerClient;
const terminalSession = {
	serverId: 'server:test',
	projectId: 'project:test',
	sessionId: 'terminal:test',
	cwd: '/workspace/project',
	status: 'running',
	createdAt: 1,
	outputPosition: 15,
	replayFrom: 0,
	dimensions: { cols: 80, rows: 24 },
} as const;
const terminalActions: string[] = [];
(window as unknown as { __terminalActions: string[] }).__terminalActions =
	terminalActions;

const mobileSettingsActions: string[] = [];
(
	window as unknown as { __mobileSettingsActions: string[] }
).__mobileSettingsActions = mobileSettingsActions;
const mobileMcpActions: string[] = [];
(window as unknown as { __mobileMcpActions: string[] }).__mobileMcpActions =
	mobileMcpActions;
const mobileMcpClient = new McpServerControlClient({
	query: async (operation: string) => {
		mobileMcpActions.push(`query:${operation}`);
		return {
			servers: [
				{ id: 'docs', label: 'Documentation', state: 'stopped' },
				{
					id: 'search',
					label: 'Search',
					state: 'failed',
					detail: 'Process exited',
				},
			],
		};
	},
	command: async (
		operation: string,
		payload: { serverId: string; action: string },
	) => {
		mobileMcpActions.push(
			`command:${operation}:${payload.serverId}:${payload.action}`,
		);
		if (payload.serverId === 'search') throw new Error('Retry was rejected');
		return { serverId: payload.serverId, state: 'running', acknowledged: true };
	},
} as never);
const mobileFileActions: string[] = [];
(window as unknown as { __mobileFileActions: string[] }).__mobileFileActions =
	mobileFileActions;
let mobileFileConflict = false;
const mobileFileClient = new FileViewerClient({
	query: async (operation: string, payload: unknown) => {
		mobileFileActions.push(`query:${operation}`);
		if (operation === 'files.open') {
			return {
				serverId: 'server:test',
				projectId: 'project:test',
				sessionId: 'file-session:mobile',
				relativePath: 'README.md',
				metadata: {
					canonicalPath: '/workspace/project/README.md',
					size: 14,
					draftSize: 14,
					diskRevision: 1,
					draftRevision: 1,
					dirty: false,
					conflict: false,
					watchState: 'watching',
				},
			};
		}
		if (operation === 'files.read-text') {
			return {
				canonicalPath: '/workspace/project/README.md',
				offset: 0,
				requestedLength: 1024,
				bytes: 'IyBNb2JpbGUgZmlsZQo=',
				text: '# Mobile file\n',
				invalidEncoding: false,
				totalSize: 14,
				diskRevision: 1,
				draftRevision: 1,
				dirty: false,
				conflict: false,
			};
		}
		if (operation === 'files.content-capabilities') {
			const path = (payload as { path: string }).path;
			return path === 'large.txt'
				? {
						relativePath: path,
						size: 105_906_176,
						kind: 'text',
						contentType: 'text/plain',
						isLarge: true,
						canPreview: false,
						canText: true,
						canHex: true,
						maxDecodedImagePixels: 0,
					}
				: {
						relativePath: path,
						size: 4,
						kind: 'binary',
						contentType: 'application/octet-stream',
						isLarge: false,
						canPreview: false,
						canText: false,
						canHex: true,
						maxDecodedImagePixels: 0,
					};
		}
		if (operation === 'files.content-hex') {
			return {
				relativePath: 'payload.bin',
				kind: 'binary',
				contentType: 'application/octet-stream',
				offset: 0,
				requestedLength: 64,
				bytes: 'AP+AQQ==',
				totalSize: 4,
				truncated: false,
				bytesPerRow: 16,
				rows: [{ offset: 0, hex: '00 FF 80 41', ascii: '...A' }],
			};
		}
		throw new Error(`Unexpected mobile file query: ${operation}`);
	},
	command: async (operation: string) => {
		mobileFileActions.push(`command:${operation}`);
		if (operation === 'files.save' && mobileFileConflict) {
			throw new Error('file has an unresolved external conflict');
		}
		return {};
	},
} as never);
const mobileRecordingActions: string[] = [];
(
	window as unknown as { __mobileRecordingActions: string[] }
).__mobileRecordingActions = mobileRecordingActions;

const recordingItem = {
	recordingId: 'recording:mobile',
	sessionId: 'session:mobile',
	serverId: 'server:test',
	projectId: 'project:test',
	projectName: 'Mobile project',
	title: 'Mobile recording',
	note: null,
	color: null,
	emoji: null,
	startedAt: '2030-01-01T00:00:00.000Z',
	endedAt: '2030-01-01T00:00:02.000Z',
	durationMs: 2_000,
	exitCode: 0,
	signal: null,
	recordingState: 'completed',
	capturedInput: false,
	inputPolicy: 'none',
	sensitiveInputPolicy: 'drop',
	eventCount: 2,
	bytesWritten: 64,
	castSize: 64,
	castAvailable: true,
	cwdLabel: 'project',
	shellName: 'zsh',
	format: 'asciicast',
	formatVersion: 3,
	errorMessage: null,
} as const;

function MobileMcpWorkflow() {
	const [servers, setServers] = useState<
		Array<{ id: string; label: string; state: string; detail?: string }>
	>([]);
	const [status, setStatus] = useState('Not loaded');
	const load = () => {
		setStatus('Loading MCP servers');
		void mobileMcpClient
			.list()
			.then((items) => {
				setServers(items.map((item) => ({ ...item })));
				setStatus('MCP servers ready');
			})
			.catch((error) =>
				setStatus(error instanceof Error ? error.message : 'MCP status failed'),
			);
	};
	const control = (serverId: string, action: 'start' | 'retry') => {
		void mobileMcpClient
			.control(serverId, action)
			.then((acknowledgement) => {
				setServers((items) =>
					items.map((item) =>
						item.id === acknowledgement.serverId
							? { ...item, state: acknowledgement.state }
							: item,
					),
				);
				setStatus(`${acknowledgement.serverId} acknowledged`);
			})
			.catch((error) =>
				setStatus(
					error instanceof Error ? error.message : 'MCP control failed',
				),
			);
	};
	return (
		<section aria-label="Mobile MCP server controls">
			<h1>MCP servers</h1>
			<button type="button" onClick={load}>
				Load MCP servers
			</button>
			<ul aria-label="MCP server list">
				{servers.map((server) => (
					<li key={server.id}>
						<strong>{server.label}</strong> <span>{server.state}</span>
						{server.detail === undefined ? null : <span>{server.detail}</span>}
						<button
							type="button"
							onClick={() =>
								control(
									server.id,
									server.state === 'failed' ? 'retry' : 'start',
								)
							}
						>
							{server.state === 'failed' ? 'Retry' : 'Start'} {server.label}
						</button>
					</li>
				))}
			</ul>
			<output aria-label="Mobile MCP status">{status}</output>
		</section>
	);
}

function MobileFileViewerWorkflow() {
	const [sessionId, setSessionId] = useState('');
	const [text, setText] = useState('');
	const [status, setStatus] = useState('Closed');
	const [largeMode, setLargeMode] = useState('');
	const [binaryMode, setBinaryMode] = useState('');
	return (
		<section aria-label="Mobile file viewer workflow">
			<h1>Mobile file viewer</h1>
			<button
				type="button"
				onClick={() =>
					void mobileFileClient
						.openFile('README.md', 'project:test')
						.then(async (session) => {
							const content = await mobileFileClient.readSessionText(
								session.sessionId,
								0,
								1024,
							);
							setSessionId(session.sessionId);
							setText(content.text);
							setStatus('Synced');
						})
				}
			>
				Open README
			</button>
			<label>
				File text
				<textarea
					value={text}
					onChange={(event) => {
						setText(event.target.value);
						setStatus('Unsaved changes');
					}}
				/>
			</label>
			<button
				type="button"
				disabled={sessionId === ''}
				onClick={() =>
					void mobileFileClient
						.editSession(sessionId, text, 1)
						.then(() => mobileFileClient.saveSession(sessionId, 1, 1))
						.then(() => setStatus('Synced'))
						.catch(() => setStatus('Conflict: external revision'))
				}
			>
				Save file
			</button>
			<button
				type="button"
				onClick={() => {
					mobileFileConflict = true;
					setStatus('External change detected');
				}}
			>
				Simulate external conflict
			</button>
			<button
				type="button"
				onClick={() =>
					void mobileFileClient
						.getContentCapabilities('large.txt', 'project:test')
						.then((value) =>
							setLargeMode(
								value.isLarge && value.canText
									? 'Performant ranged text'
									: 'Unsupported',
							),
						)
				}
			>
				Open large file
			</button>
			<button
				type="button"
				onClick={() =>
					void mobileFileClient
						.getContentCapabilities('payload.bin', 'project:test')
						.then((value) => {
							if (value.canText || !value.canHex)
								throw new Error('unsafe binary mode');
							return mobileFileClient.readContentHex(
								'payload.bin',
								0,
								64,
								16,
								'project:test',
							);
						})
						.then((value) => setBinaryMode(`HEX ${value.rows[0]?.hex ?? ''}`))
				}
			>
				Open binary file
			</button>
			<output aria-label="Mobile file status">{status}</output>
			<output aria-label="Large file mode">{largeMode}</output>
			<output aria-label="Binary file mode">{binaryMode}</output>
		</section>
	);
}

function MobileRecordingsWorkflow() {
	const [deleted, setDeleted] = useState(false);
	const [selected, setSelected] = useState(false);
	const [replay, setReplay] = useState('');
	const recordingsClient = useMemo(
		() =>
			new RecordingsClient({
				query: async (operation: string) => {
					mobileRecordingActions.push(operation);
					if (operation === 'recordings.list') {
						return {
							items: deleted ? [] : [recordingItem],
							total: deleted ? 0 : 1,
							offset: 0,
							limit: 100,
						};
					}
					return {
						recordingId: recordingItem.recordingId,
						start: 0,
						nextOffset: 18,
						totalSize: 18,
						content: 'mobile replay text',
						eof: true,
						incompleteTail: false,
					};
				},
				command: async (operation: string) => {
					mobileRecordingActions.push(operation);
					return null;
				},
			} as never),
		[deleted],
	);
	const [items, setItems] = useState<(typeof recordingItem)[]>([]);
	useEffect(() => {
		void recordingsClient.list({ limit: 100 }).then((result) => {
			setItems(result.items as (typeof recordingItem)[]);
		});
	}, [recordingsClient]);
	return (
		<SharedRecordingsRouteBody
			library={
				<aside aria-label="Mobile recordings library">
					<h1>Recordings</h1>
					{items.length === 0 ? <p>No recordings yet.</p> : null}
					{items.map((item) => (
						<button
							key={item.recordingId}
							type="button"
							aria-pressed={selected}
							onClick={() => setSelected(true)}
						>
							{item.title}
						</button>
					))}
				</aside>
			}
		>
			{selected && !deleted ? (
				<section aria-label="Mobile recording detail">
					<h2>{recordingItem.title}</h2>
					<p>{recordingItem.eventCount} events</p>
					<button
						type="button"
						onClick={() =>
							void recordingsClient
								.replay(recordingItem.recordingId, { maxBytes: 1024 })
								.then((chunk) => setReplay(chunk.content))
						}
					>
						Replay
					</button>
					<button
						type="button"
						onClick={() =>
							void recordingsClient
								.delete(recordingItem.recordingId)
								.then(() => {
									setDeleted(true);
									setSelected(false);
								})
						}
					>
						Delete
					</button>
					<output aria-label="Replay output">{replay}</output>
				</section>
			) : (
				<p>Select a recording to view its details.</p>
			)}
		</SharedRecordingsRouteBody>
	);
}

const mobileWorkspaceActions: string[] = [];
(
	window as unknown as { __mobileWorkspaceActions: string[] }
).__mobileWorkspaceActions = mobileWorkspaceActions;

function MobileWorkspaceWorkflow() {
	const [projectCreated, setProjectCreated] = useState(false);
	const [projectSelected, setProjectSelected] = useState(false);
	const [panelCreated, setPanelCreated] = useState(false);
	const [panelSelected, setPanelSelected] = useState(false);
	const [panelMoved, setPanelMoved] = useState(false);
	const [panelClosed, setPanelClosed] = useState(false);
	const client = useMemo(
		() =>
			new WorkspaceClient({
				command: async (
					_operation: string,
					payload: { command: { type: string } },
				) => {
					mobileWorkspaceActions.push(payload.command.type);
					return { result: null };
				},
			} as never),
		[],
	);
	return (
		<section aria-label="Mobile workspace workflow">
			<WorkspaceSplitLayout
				navigation={
					<nav aria-label="Mobile projects">
						<button
							type="button"
							onClick={() =>
								void client
									.createProject({
										projectId: 'project:mobile',
										viewId: 'view:mobile',
										root: '/workspace/mobile',
										name: 'Mobile project',
									})
									.then(() => setProjectCreated(true))
							}
						>
							Create project
						</button>
						{projectCreated ? (
							<button
								type="button"
								aria-pressed={projectSelected}
								onClick={() => {
									mobileWorkspaceActions.push('project.select');
									setProjectSelected(true);
								}}
							>
								Mobile project
							</button>
						) : null}
					</nav>
				}
				content={
					<section aria-label="Mobile panels">
						{projectSelected ? (
							<button
								type="button"
								onClick={() =>
									void client
										.createPanel({
											panel: {
												id: 'panel:mobile',
												projectId: 'project:mobile',
												type: 'file',
												path: 'README.md',
												createdAt: 1,
											},
										})
										.then(() => setPanelCreated(true))
								}
							>
								Create panel
							</button>
						) : null}
						{panelCreated && !panelClosed ? (
							<button
								type="button"
								aria-pressed={panelSelected}
								onClick={() =>
									void client
										.activatePanel({
											projectId: 'project:mobile',
											panelId: 'panel:mobile',
										})
										.then(() => setPanelSelected(true))
								}
							>
								README.md
							</button>
						) : null}
						{panelSelected && !panelMoved ? (
							<button
								type="button"
								onClick={() =>
									void client
										.movePanel({
											panelId: 'panel:mobile',
											targetProjectId: 'project:archive',
											index: 0,
										})
										.then(() => setPanelMoved(true))
								}
							>
								Move panel
							</button>
						) : null}
						{panelMoved && !panelClosed ? (
							<button
								type="button"
								onClick={() =>
									void client
										.closePanel('panel:mobile')
										.then(() => setPanelClosed(true))
								}
							>
								Close panel
							</button>
						) : null}
						{panelClosed ? <p>Panel closed.</p> : null}
					</section>
				}
			/>
		</section>
	);
}

function MobileSettingsWorkflow() {
	const [activeCategoryId, setActiveCategoryId] = useState('appearance');
	const [fontSize, setFontSize] = useState('14');
	const [query, setQuery] = useState('');
	const [status, setStatus] = useState('Saved');
	return (
		<SharedSettingsRouteBody
			title="Mobile workflow"
			query={query}
			categories={[
				{ id: 'appearance', label: 'Appearance' },
				{ id: 'terminal', label: 'Terminal' },
			]}
			activeCategoryId={activeCategoryId}
			status={status}
			onQueryChange={setQuery}
			onCategorySelect={setActiveCategoryId}
			onResetAll={() => {
				setFontSize('14');
				setStatus('Saved');
				mobileSettingsActions.push('reset');
			}}
		>
			<label>
				Terminal font size
				<input
					aria-label="Terminal font size"
					inputMode="numeric"
					value={fontSize}
					onChange={(event) => {
						setFontSize(event.target.value);
						setStatus('Not saved');
					}}
				/>
			</label>
			<button
				type="button"
				onClick={() => {
					mobileSettingsActions.push(`save:${fontSize}`);
					setStatus('Saved');
				}}
			>
				Save terminal settings
			</button>
		</SharedSettingsRouteBody>
	);
}

const mobileMacroActions: string[] = [];
(window as unknown as { __mobileMacroActions: string[] }).__mobileMacroActions =
	mobileMacroActions;
const defaultMacro = {
	id: 'macro:default',
	title: 'Default macro',
	description: 'Default',
	fields: [],
	steps: [],
};
let mobileMacroState = {
	schemaVersion: 1,
	revision: 1,
	cursor: '1',
	macros: [defaultMacro],
};

function MobileMacrosWorkflow() {
	const client = useMemo(
		() =>
			new MacroClient({
				query: async () => mobileMacroState,
				command: async (
					operation: string,
					payload: { macro?: typeof defaultMacro; macroId?: string },
				) => {
					mobileMacroActions.push(operation);
					const revision = mobileMacroState.revision + 1;
					if (operation === 'macros.upsert' && payload.macro !== undefined) {
						mobileMacroState = {
							schemaVersion: 1,
							revision,
							cursor: String(revision),
							macros: [
								...mobileMacroState.macros.filter(
									(item) => item.id !== payload.macro!.id,
								),
								payload.macro,
							],
						};
					} else if (operation === 'macros.remove') {
						mobileMacroState = {
							schemaVersion: 1,
							revision,
							cursor: String(revision),
							macros: mobileMacroState.macros.filter(
								(item) => item.id !== payload.macroId,
							),
						};
					} else if (operation === 'macros.reset') {
						mobileMacroState = {
							schemaVersion: 1,
							revision,
							cursor: String(revision),
							macros: [defaultMacro],
						};
					}
					return mobileMacroState;
				},
				subscribe: () => () => undefined,
			} as never),
		[],
	);
	const [state, setState] = useState(mobileMacroState);
	const apply = (promise: Promise<typeof mobileMacroState>) =>
		void promise.then(setState);
	const created = state.macros.find((macro) => macro.id === 'macro:mobile');
	return (
		<SharedMacroRouteBody
			sidebar={
				<aside aria-label="Mobile macro library">
					<h1>Macros</h1>
					{state.macros.map((macro) => (
						<p key={macro.id}>{macro.title}</p>
					))}
				</aside>
			}
		>
			<section aria-label="Mobile macro editor">
				<button
					type="button"
					onClick={() =>
						apply(
							client.upsert({
								id: 'macro:mobile',
								title: 'Mobile macro',
								description: 'Created',
								fields: [],
								steps: [],
							}) as Promise<typeof mobileMacroState>,
						)
					}
				>
					Create macro
				</button>
				{created !== undefined ? (
					<button
						type="button"
						onClick={() =>
							apply(
								client.upsert({
									...created,
									title: 'Edited mobile macro',
								}) as Promise<typeof mobileMacroState>,
							)
						}
					>
						Edit macro
					</button>
				) : null}
				{created !== undefined ? (
					<button
						type="button"
						onClick={() =>
							apply(
								client.remove(created.id) as Promise<typeof mobileMacroState>,
							)
						}
					>
						Delete macro
					</button>
				) : null}
				<button
					type="button"
					onClick={() =>
						apply(client.reset() as Promise<typeof mobileMacroState>)
					}
				>
					Reset macros
				</button>
				<output aria-label="Macro revision">{state.revision}</output>
			</section>
		</SharedMacroRouteBody>
	);
}
const terminalClient = {
	list: async () => ({
		serverId: 'server:test',
		projectId: 'project:test',
		sessions: [terminalSession],
	}),
	create: async () => {
		terminalActions.push('create');
		return { ...terminalSession, sessionId: 'terminal:created' };
	},
} as unknown as TerminayTerminalClient;
const emptyTerminalClient = {
	list: async () => ({
		serverId: 'server:test',
		projectId: 'project:test',
		sessions: [],
	}),
} as unknown as TerminayTerminalClient;
const failedTerminalClient = {
	list: async () => {
		throw new Error('Terminal catalog failed');
	},
} as unknown as TerminayTerminalClient;
const panelClient = {
	attach: async () => {
		terminalActions.push('attach');
		let detached = false;
		return {
			attachmentId: 'attachment:test',
			identity: terminalSession,
			initialEvents: [
				{
					...terminalSession,
					type: 'output',
					position: 0,
					nextPosition: 15,
					bytes: new TextEncoder().encode('replayed output\n'),
					replay: true,
				},
			],
			position: 15,
			closed: false,
			onOutput: () => () => undefined,
			onExit: () => () => undefined,
			onResync: () => () => undefined,
			ack: async (position: number) => {
				terminalActions.push(`ack:${position}`);
			},
			write: async (data: Uint8Array | string) => {
				terminalActions.push(`write:${String(data)}`);
			},
			resize: async ({ cols, rows }: { cols: number; rows: number }) => {
				terminalActions.push(`resize:${cols}x${rows}`);
			},
			kill: async () => undefined,
			detach: async () => {
				if (detached) return;
				detached = true;
				terminalActions.push('detach');
			},
		} satisfies TerminalPanelAttachment;
	},
} as unknown as TerminayTerminalPanelClient;

createRoot(document.getElementById('root')!).render(
	<>
		<SharedConnectionsRouteBody
			state="ready"
			profileStore={connectionProfiles}
			canPair
			canRevoke
			canExpose
			onSelect={async (profile) => {
				connectionActions.push(`select:${profile.id}`);
			}}
			onRevoke={async (profile) => {
				connectionActions.push(`revoke:${profile.id}`);
			}}
			onExpose={async (profile) => {
				connectionActions.push(`expose:${profile.id}`);
			}}
			onPairingHandoff={async () => {
				connectionActions.push('pair');
			}}
		/>
		<section aria-label="Empty Connections state">
			<SharedConnectionsRouteBody
				state="empty"
				profileStore={emptyConnectionStateStore}
				canPair
				onPairingHandoff={(pairingUrl) => {
					connectionActions.push(`empty-pair:${pairingUrl}`);
				}}
			/>
		</section>
		{canonicalConnectionStateStores.map(({ label, store }) => (
			<section key={label} aria-label={`${label} Connections state`}>
				<SharedConnectionsRouteBody
					state="ready"
					profileStore={store}
					canPair
					onSelect={() => undefined}
					onPairingHandoff={(pairingUrl) => {
						connectionActions.push(`${label}-pair:${pairingUrl}`);
					}}
				/>
			</section>
		))}
		<SharedConnectionsRouteBody state="loading" connections={[]} />
		<SharedConnectionsRouteBody state="empty" connections={[]} />
		<SharedConnectionsRouteBody state="unavailable" connections={[]} />
		<SharedConnectionsRouteBody
			state="failed"
			connections={[]}
			error="Connection profiles failed"
			onRetry={() => undefined}
		/>
		<MobileServerLifecycleWorkflow />
		<SharedGitRouteBody capabilityAvailable={false} />
		<SharedGitRouteBody
			capabilityAvailable
			gitClient={failedGitClient}
			projectId="project:test"
		/>
		<SharedGitRouteBody capabilityAvailable />
		<SharedGitRouteBody
			capabilityAvailable
			gitClient={readyGitClient}
			projectId="project:test"
		/>
		<SharedAgentRouteBody loading />
		<SharedAgentRouteBody />
		<SharedAgentRouteBody client={agentClient} />
		<SharedFolderRouteBody loading />
		<SharedFolderRouteBody />
		<SharedFolderRouteBody client={emptyFiles} projectId="project:test" />
		<SharedFolderRouteBody client={failedFiles} projectId="project:test" />
		<SharedFolderRouteBody
			client={readyFiles}
			projectId="project:test"
			onOpenEntry={(entry) => {
				mobileFileActions.push(`open:${entry.relativePath}`);
			}}
		/>
		<SharedTerminalRouteBody loading />
		<SharedTerminalRouteBody />
		<SharedTerminalRouteBody
			terminalClient={emptyTerminalClient}
			panelClient={panelClient}
			serverId="server:test"
			projectId="project:test"
			clientId="client:test"
		/>
		<SharedTerminalRouteBody
			terminalClient={failedTerminalClient}
			panelClient={panelClient}
			serverId="server:test"
			projectId="project:test"
			clientId="client:test"
		/>
		<SharedTerminalRouteBody
			terminalClient={terminalClient}
			panelClient={panelClient}
			serverId="server:test"
			projectId="project:test"
			clientId="client:test"
		/>
		<MobileSettingsWorkflow />
		<MobileMcpWorkflow />
		<MobileMacrosWorkflow />
		<MobileFileViewerWorkflow />
		<MobileRecordingsWorkflow />
		<MobileWorkspaceWorkflow />
	</>,
);
