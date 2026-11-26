import { foldTranscript } from '../src/workspace/bots/transcriptModel';
/**
 * Home › Bots components against a fake server projection, for
 * scripts/bots-ui.test.mjs. The fake records every call in `window.__calls`
 * and `window.__harness` lets a test push live changes.
 */

import type {
	BotMessage,
	BotProfile,
	BotRuntimeEvent,
	BotSession,
	BotSessionRecord,
	BotSiblingContainer,
} from '@terminay/protocol';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BotsSection } from '../src/workspace/bots/BotsSection';
import { BotsSidebarList } from '../src/workspace/bots/BotsSidebarList';
import { BotTab } from '../src/workspace/bots/BotTab';
import type { BotTabHost } from '../src/workspace/bots/botTabHost';
import type {
	BotAgentOption,
	ServerBots,
} from '../src/workspace/bots/useServerBots';

type Call = { op: string; args: unknown[] };
type Scenario = {
	view: 'dashboard' | 'tab' | 'sidebar';
	platform?: 'mac' | 'linux';
	engine?: Record<string, unknown>;
	bots: BotProfile[];
	sessions: Record<string, BotSessionRecord[]>;
	transcripts?: Record<string, unknown[]>;
	environments?: Record<string, string>;
	agents: BotAgentOption[];
	signIn?: Record<string, unknown>;
	files?: unknown[];
	containers?: BotSiblingContainer[];
	socketShared?: boolean;
	limitsChangePending?: boolean;
	/** Triggers listed after the fixed `tr1`. */
	extraTriggers?: unknown[];
	extraFirings?: unknown[];
	settingsRefusal?: string;
	deleteWarning?: string;
	sendRefusal?: string;
	/** Start outcomes for successive posts and retries: a reason fails that start, null starts it. */
	starts?: (string | null)[];
	postDelayMs?: number;
	imageDelayMs?: number;
	attachmentMime?: string;
	imageSize?: { width: number; height: number };
	/** Delays for the Overview's state-only and full reads. */
	overviewDelayMs?: { state?: number; full?: number };
	/** Refuses the Overview's full read with this message. */
	overviewFullRefusal?: string;
	/** Refuses the lifecycle start command with this message. */
	startRefusal?: string;
	/** Message rows to seed per bot, oldest first, instead of transcripts. */
	messages?: Record<string, Partial<BotMessage>[]>;
};

/** Controls for `bots.messages.list` pages after the first (those with a cursor). */
type OlderControl = {
	/** Each later page waits this long. */
	delayMs: number;
	/** The next this-many later pages are refused. */
	failures: number;
};

declare global {
	interface Window {
		__calls: Call[];
		__harness: {
			setSessions: (botId: string, sessions: BotSessionRecord[]) => void;
			setTranscript: (sessionId: string, updates: unknown[]) => void;
			setVisible: (visible: boolean) => void;
			/** The watched environment state changes, as a projection would. */
			setEnvironment: (botId: string, state: string) => void;
		};
		__older: OlderControl;
		/** The bot posts a top-level message, as another execution would. */
		__botPosts: (botId: string, text: string, threadId?: string) => void;
		/** Another client deletes a message. */
		__deleteElsewhere: (botId: string, messageId: string) => void;
		__scenario: Scenario;
		/** Another client dismisses a start failure. */
		__dismissElsewhere: (botId: string, messageId: string) => void;
		__opened: unknown[];
		__closed: unknown[];
	}
}

if (!crypto.randomUUID)
	Object.defineProperty(crypto, 'randomUUID', {
		value: () =>
			Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
				b.toString(16).padStart(2, '0'),
			).join(''),
	});
const scenario = window.__scenario;
window.__calls = [];
window.__opened = [];
window.__closed = [];
const record =
	(op: string, result: (...args: unknown[]) => unknown = () => undefined) =>
	async (...args: unknown[]) => {
		window.__calls.push({ op, args });
		return result(...args);
	};

const transcripts = new Map<string, unknown[]>(
	Object.entries(scenario.transcripts ?? {}),
);
let sessionsNow = new Map<string, BotSessionRecord[]>(
	Object.entries(scenario.sessions),
);

const messageRows = new Map<string, BotMessage[]>();
const messageEvents: (BotRuntimeEvent & { botId: string })[] = [];
const messageListeners = new Set<() => void>();
for (const [botId, rows] of sessionsNow) {
	const items = rows.flatMap((row) =>
		foldTranscript(transcripts.get(row.id) ?? []).filter(
			(item) => item.kind === 'user' || item.kind === 'agent',
		),
	);
	messageRows.set(
		botId,
		items.map((item, index) => ({
			id: item.key,
			botId,
			sequence: index + 1,
			revision: 1,
			author: item.kind === 'user' ? 'user' : 'bot',
			executionId: null,
			createdAt: 0,
			updatedAt: 0,
			text: item.text,
			attachments: [],
		})),
	);
}
for (const [botId, rows] of Object.entries(scenario.messages ?? {}))
	messageRows.set(
		botId,
		rows.map(
			(row, index) =>
				({
					id: `m${index + 1}`,
					botId,
					sequence: index + 1,
					revision: 1,
					author: 'bot',
					executionId: null,
					createdAt: 0,
					updatedAt: 0,
					text: `Message ${index + 1}`,
					attachments: [],
					...row,
				}) as BotMessage,
		),
	);
window.__older = { delayMs: 0, failures: 0 };
window.__deleteElsewhere = (botId, messageId) => {
	messageRows.set(
		botId,
		(messageRows.get(botId) ?? []).filter((m) => m.id !== messageId),
	);
	emitMessage(botId, 'message.deleted', messageId, 2);
};
window.__botPosts = (botId, text, threadId) => {
	const rows = messageRows.get(botId) ?? [];
	const message = {
		id: crypto.randomUUID(),
		botId,
		...(threadId ? { threadId } : {}),
		sequence: rows.length + 1,
		revision: 1,
		author: 'bot',
		executionId: null,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		text,
		attachments: [],
	} as BotMessage;
	messageRows.set(botId, [...rows, message]);
	emitMessage(botId, 'message.posted', message.id, 1);
};
const emitMessage = (
	botId: string,
	type: string,
	id: string,
	revision: number,
) => {
	messageEvents.push({
		sequence: messageEvents.length + 1,
		type,
		subjectId: id,
		revision,
		at: Date.now(),
		botId,
	});
	for (const listener of messageListeners) listener();
};

const starts = [...(scenario.starts ?? [])];
const nextStart = (): string | null =>
	starts.length ? (starts.shift() ?? null) : null;
window.__dismissElsewhere = (botId, messageId) => {
	const row = messageRows.get(botId)?.find((m) => m.id === messageId);
	if (!row?.dispatch) return;
	Object.assign(row, { dispatch: { ...row.dispatch, dismissed: true } });
	emitMessage(botId, 'message.dispatch', row.id, row.revision);
};

const engineStatus = scenario.engine ?? {
	engine: 'podman',
	available: true,
	reason: null,
	detail: '',
	pinned: { kind: 'podman', address: 'unix:///run/podman.sock' },
	candidates: [],
	runningContainers: 1,
	botContainers: 2,
	image: { state: 'current', fingerprint: 'abc', builtAt: 1, error: null },
};

const transport = {
	query: record('transport.query', (op, payload) => {
		const args = payload as {
			botId: string;
			messageId: string;
			cursor?: string;
			limit?: number;
			revision: number;
			text: string;
		};
		if (op === 'bots.messages.list') {
			const threadId = (payload as { threadId?: string }).threadId;
			const rows = [...(messageRows.get(args.botId) ?? [])]
				.filter((m) => (threadId ? m.threadId === threadId : !m.threadId))
				.reverse();
			const offset = Number(args.cursor ?? 0),
				items = rows.slice(offset, offset + (args.limit ?? 10));
			const page = {
				items: items.map(({ text, attachments, ...rest }) => ({
					...rest,
					excerpt: text.slice(0, 256),
					textBytes: text.length,
					attachmentCount: attachments.length,
				})),
				nextCursor:
					offset + items.length < rows.length
						? String(offset + items.length)
						: null,
				eventsCursor: String(messageEvents.length),
				total: rows.length,
				truncated: false,
			};
			if (args.cursor !== undefined) {
				const older = window.__older;
				return new Promise((resolve, reject) =>
					setTimeout(() => {
						if (older.failures > 0) {
							older.failures--;
							reject(new Error('Older page refused'));
						} else resolve(page);
					}, older.delayMs),
				);
			}
			return page;
		}
		if (op === 'bots.messages.get') {
			const row = messageRows
				.get(args.botId)
				?.find((m) => m.id === args.messageId);
			if (!row) throw new Error('Message missing');
			const { text, ...message } = row;
			return { message, text, nextCursor: null, truncated: false };
		}
		if (op === 'bots.messages.events') {
			const items = messageEvents.filter(
				(e) => e.botId === args.botId && e.sequence > Number(args.cursor ?? 0),
			);
			return {
				items,
				nextCursor: String(messageEvents.length),
				gap: false,
				hasMore: false,
			};
		}
		switch (op) {
			case 'bots.engine.status':
				return engineStatus;
			case 'bots.credentials.options':
				return scenario.signIn ?? { device: null, tokens: [] };
			case 'bots.files.list':
				return { entries: scenario.files ?? [], truncated: false };
			default:
				return null;
		}
	}),
	command: record('transport.command', (op, payload) => {
		const a = payload as {
			botId: string;
			messageId: string;
			cursor?: string;
			limit?: number;
			revision: number;
			text: string;
		};
		const rows = messageRows.get(a.botId) ?? [];
		if (op === 'bots.messages.post') {
			if (scenario.sendRefusal) throw new Error(scenario.sendRefusal);
			const message = {
				id: crypto.randomUUID(),
				botId: a.botId,
				sequence: rows.length + 1,
				revision: 1,
				author: 'user',
				executionId: null,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				text: a.text,
				attachments: [],
				...((payload as { threadId?: string }).threadId
					? { threadId: (payload as { threadId: string }).threadId }
					: {}),
			};
			const outcome = nextStart();
			const executionId = outcome === null ? crypto.randomUUID() : null;
			Object.assign(message, {
				dispatch:
					outcome === null
						? { state: 'started', executionId }
						: { state: 'failed', executionId: null, error: outcome },
			});
			messageRows.set(a.botId, [...rows, message]);
			emitMessage(a.botId, 'message.posted', message.id, 1);
			const result =
				outcome === null
					? { message, sessionId: executionId }
					: { message, error: outcome };
			return scenario.postDelayMs
				? new Promise((resolve) =>
						setTimeout(() => resolve(result), scenario.postDelayMs),
					)
				: result;
		}
		if (op === 'bots.messages.retry' || op === 'bots.messages.dismiss') {
			const p = payload as { attempt: number };
			const row = rows.find((m) => m.id === a.messageId);
			const dispatch = row?.dispatch;
			if (
				!row ||
				row.revision !== a.revision ||
				dispatch?.state !== 'failed' ||
				dispatch.dismissed ||
				(dispatch.attempt ?? 1) !== p.attempt
			)
				throw new Error('Message changed; reload before retrying');
			if (op === 'bots.messages.dismiss') {
				Object.assign(row, { dispatch: { ...dispatch, dismissed: true } });
				emitMessage(a.botId, 'message.dispatch', row.id, row.revision);
				return row;
			}
			const outcome = nextStart(),
				attempt = p.attempt + 1;
			const executionId = outcome === null ? crypto.randomUUID() : null;
			Object.assign(row, {
				dispatch:
					outcome === null
						? { state: 'started', executionId, attempt }
						: { state: 'failed', executionId: null, error: outcome, attempt },
			});
			emitMessage(a.botId, 'message.dispatch', row.id, row.revision);
			return outcome === null
				? { message: row, sessionId: executionId }
				: { message: row, error: outcome };
		}
		if (op === 'bots.messages.edit') {
			const row = rows.find((m) => m.id === a.messageId);
			if (!row || row.revision !== a.revision) throw new Error('Stale message');
			Object.assign(row, { text: a.text, revision: row.revision + 1 });
			emitMessage(a.botId, 'message.edited', row.id, row.revision);
			return null;
		}
		if (op === 'bots.messages.remove') {
			messageRows.set(
				a.botId,
				rows.filter((m) => m.id !== a.messageId),
			);
			emitMessage(a.botId, 'message.deleted', a.messageId, a.revision + 1);
			return null;
		}
		if (op === 'bots.messages.clear') {
			messageRows.set(a.botId, []);
			emitMessage(a.botId, 'messages.cleared', '', 0);
			return null;
		}

		if (
			op === 'bots.files.open' ||
			op === 'bots.shell.open' ||
			op === 'bots.desktop.open'
		)
			return {
				streamId: `s-${op}`,
				botId: scenario.bots[0]?.id,
				generation: 1,
			};
		if (op === 'bots.files.watch')
			return { streamId: 'watch', botId: scenario.bots[0]?.id, generation: 1 };
		return null;
	}),
	commandWithBody: record('transport.commandWithBody', () => null),
	queryWithBody: record(
		'transport.queryWithBody',
		async (op: unknown, payload: { path?: string }) => {
			if (op === 'bots.image.read' || op === 'bots.messages.attachment') {
				if (payload.path === '/tmp/missing.png')
					throw new Error('missing image');
				if (scenario.imageDelayMs)
					await new Promise((resolve) =>
						setTimeout(resolve, scenario.imageDelayMs),
					);
				let base64 =
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD0kAAAAASUVORK5CYII=';
				if (scenario.imageSize) {
					const canvas = document.createElement('canvas');
					canvas.width = scenario.imageSize.width;
					canvas.height = scenario.imageSize.height;
					const context = canvas.getContext('2d')!;
					context.fillStyle = '#4488aa';
					context.fillRect(0, 0, canvas.width, canvas.height);
					base64 = canvas.toDataURL('image/png').split(',')[1]!;
				}
				return {
					result: {
						mime:
							op === 'bots.messages.attachment'
								? (scenario.attachmentMime ?? 'image/png')
								: 'image/png',
					},
					body: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
				};
			}
			return { result: { done: true }, body: new Uint8Array() };
		},
	),
	subscribe: (event: string, listener: (value: unknown) => void) => {
		if (event !== 'bots.messages.changed') return () => {};
		const notify = () => listener({ botId: scenario.bots[0]?.id });
		messageListeners.add(notify);
		return () => messageListeners.delete(notify);
	},
};

const session = (botId: string, id: string): BotSession => {
	const found = (sessionsNow.get(botId) ?? []).find((s) => s.id === id);
	if (found === undefined) throw new Error('no such session');
	return { ...found, updates: transcripts.get(id) ?? [] } as BotSession;
};

const client = {
	get: record('get'),
	save: record('save', (draft) => ({
		...scenario.bots[0],
		...(draft as object),
		updatedAt: Date.now(),
	})),
	remove: record('remove', () => ({ warning: scenario.deleteWarning ?? null })),
	sessions: record('sessions', (botId) => sessionsNow.get(String(botId)) ?? []),
	session: record('session', (botId, id) => session(String(botId), String(id))),
	send: record('send', (botId) => {
		if (scenario.sendRefusal) throw new Error(scenario.sendRefusal);
		return {
			sessionId: (sessionsNow.get(String(botId)) ?? [])[0]?.id ?? 'new',
			queueId: 'q1',
		};
	}),
	newChat: record('newChat'),
	reviseMessage: record(
		'reviseMessage',
		(botId, id, key, expected, replacement) => {
			const items = [...foldTranscript(transcripts.get(String(id)) ?? [])];
			const index = items.findIndex((item) => item.key === key);
			if (
				index < 0 ||
				!('text' in items[index]!) ||
				items[index]!.text !== expected
			)
				throw new Error('stale message');
			if (replacement === null) items.splice(index, 1);
			else
				items[index] = {
					...items[index]!,
					text: String(replacement),
				} as (typeof items)[number];
			window.__harness.setTranscript(
				String(id),
				items.map((item) => ({ kind: 'transcript-item', item })),
			);
			window.__harness.setSessions(
				String(botId),
				(sessionsNow.get(String(botId)) ?? []).map((s) =>
					s.id === id ? { ...s, transcriptBytes: s.transcriptBytes + 1 } : s,
				),
			);
			return { sessionId: String(id) };
		},
	),
	clearChat: record('clearChat', (botId, id) => {
		window.__harness.setSessions(
			String(botId),
			(sessionsNow.get(String(botId)) ?? []).filter((s) => s.id !== id),
		);
		transcripts.delete(String(id));
	}),
	control: record('control'),
	cancelQueued: record('cancelQueued'),
	decide: record('decide'),
	memories: record('memories', () => [
		{
			path: 'deploy-notes.md',
			title: 'Deploy notes',
			modifiedAt: Date.now(),
			pinned: true,
		},
	]),
	memory: record('memory', () => '# Deploy notes\n\nUse blue/green.'),
	writeMemory: record('writeMemory'),
	pinMemory: record('pinMemory'),
	deleteMemory: record('deleteMemory'),
	watchMemories: record('watchMemories', () => async () => {}),
	enableBot: record('enableBot'),
	testSource: record('testSource', () => ({
		diagnostics: 'fixture check',
		events: [{ id: 1 }],
		wouldFire: 1,
	})),
	sourceMemory: record('sourceMemory', () => ({
		total: 0,
		ids: [],
		next: null,
	})),
	resetSource: record('resetSource'),
	retrySource: record('retrySource'),
	resumeTrigger: record('resumeTrigger'),
	triggers: record('triggers', () => ({
		revision: 1,
		triggers: [
			{
				id: 'tr1',
				botId: scenario.bots[0]?.id,
				name: 'Nightly build',
				enabled: false,
				prompt: 'Check the nightly build',
				condition: { kind: 'cron', cron: '0 9 * * 1-5' },
				evaluatedThrough: 0,
				missedCount: 1,
				missedLatest: 1,
			},
			...(scenario.extraTriggers ?? []),
		],
	})),
	triggerFirings: record('triggerFirings', () => scenario.extraFirings ?? []),
	upcomingTriggers: record('upcomingTriggers', () => ({
		firings: [
			{
				triggerId: 'tr1',
				triggerName: 'Nightly build',
				at: Date.now() + 3_600_000,
			},
		],
		next: null,
	})),
	previewTrigger: record('previewTrigger', () => [Date.now() + 60_000]),
	createTrigger: record('createTrigger'),
	updateTrigger: record('updateTrigger'),
	deleteTrigger: record('deleteTrigger'),
	enableTrigger: record('enableTrigger'),
	runTrigger: record('runTrigger'),
	dismissMissedTriggers: record('dismissMissedTriggers'),
};

let settingsNow = {
	botId: '',

	idleStopMs: (30 * 60_000) as number | null,
	limits: { cpus: 2, memoryBytes: 4 * 1024 ** 3, pids: 512 },
	limitsEnforced: true,

	revision: 1,
};

const environment = {
	overview: record('overview', async (botId, _options, read) => {
		const stateOnly =
			(read as { usage?: boolean } | undefined)?.usage === false;
		const delay = stateOnly
			? scenario.overviewDelayMs?.state
			: scenario.overviewDelayMs?.full;
		if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
		if (!stateOnly && scenario.overviewFullRefusal)
			throw new Error(scenario.overviewFullRefusal);
		return {
			botId,
			state: scenario.environments?.[String(botId)] ?? 'running',
			uptimeMs: 3_600_000,
			image: 'terminay-bot:abc',
			fingerprint: 'abc',
			current: false,
			homeVolume: `terminay-bot-${botId}-home`,
			limits: { cpus: 2, memoryBytes: 4 * 1024 ** 3, pids: 512 },
			limitsEnforced: true,

			engineSocket: 'proxy',
			limitsChangePending: scenario.limitsChangePending === true,

			sampledAt: Date.now(),
			// A state-only read carries no usage, as the server returns it.
			...(stateOnly
				? {
						cpuPercent: null,
						memoryBytes: null,
						homeBytes: null,
						log: '',
						usageRead: false,
					}
				: {
						cpuPercent: 12.5,
						memoryBytes: 512 * 1024 ** 2,
						homeBytes: 80 * 1024 ** 2,
						log: 'container started\n',
						usageRead: true,
					}),
		};
	}),
	settings: record('settings', (botId) => ({ ...settingsNow, botId })),
	setSettings: record('setSettings', (input) => {
		const request = input as Record<string, unknown>;
		if (scenario.settingsRefusal === 'conflict') {
			scenario.settingsRefusal = undefined;
			throw Object.assign(new Error('stale revision'), { code: 'conflict' });
		}
		const {
			botId: _b,
			confirmed: _c,
			expectedRevision: _r,
			...patch
		} = request;
		settingsNow = {
			...settingsNow,
			...patch,
			revision: settingsNow.revision + 1,
		};
		return settingsNow;
	}),
	containers: record('containers', () => scenario.containers ?? []),
	lifecycle: record('lifecycle', (_botId, action) => {
		if (action === 'start' && scenario.startRefusal)
			throw new Error(scenario.startRefusal);
	}),
	remove: record('remove-env'),
	containerAction: record('containerAction', () => null),
};

function makeServer(
	sessions: Map<string, BotSessionRecord[]>,
	revision: number,
): ServerBots {
	return {
		serverId: 'local',
		label: 'This Mac',
		client: client as never,
		environment: environment as never,
		transport: transport as never,
		status: 'ready',
		revision,
		bots: scenario.bots,
		sessions,
		environments: new Map(
			Object.entries(scenario.environments ?? {}),
		) as ServerBots['environments'],
		upcoming: new Map(),
		agents: scenario.agents,
		reportWarning: (warning: string) =>
			window.__calls.push({ op: 'warning', args: [warning] }),
		refresh: () => window.__calls.push({ op: 'refresh', args: [] }),
		refreshBot: (botId) =>
			window.__calls.push({ op: 'refreshBot', args: [botId] }),
		wantAgents: () => {},
		refreshAgents: () => {},
	};
}

function Harness() {
	const [sessions, setSessions] = useState(sessionsNow);
	const [revision, setRevision] = useState(1);
	const [visible, setVisible] = useState(true);
	window.__harness = {
		setSessions: (botId, next) => {
			sessionsNow = new Map(sessionsNow).set(botId, next);
			setSessions(sessionsNow);
			setRevision((r) => r + 1);
		},
		setTranscript: (id, updates) => {
			transcripts.set(id, updates);
		},
		setVisible,
		setEnvironment: (botId, state) => {
			scenario.environments = { ...scenario.environments, [botId]: state };
			setRevision((r) => r + 1);
		},
	};
	const server = makeServer(sessions, revision);
	const host: BotTabHost = {
		openBot: (target) => window.__opened.push(target),
		setTitle: () => {},
		close: (why) => window.__closed.push(why ?? null),
		isVisible: visible,
		compact: false,
	};
	return (
		<div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
			{scenario.view === 'dashboard' ? (
				<BotsSection servers={new Map([['local', server]])} host={host} />
			) : scenario.view === 'sidebar' ? (
				<aside className="home-sidebar" style={{ width: 240 }}>
					<BotsSidebarList
						servers={new Map([['local', server]])}
						activeBot={{ serverId: 'local', botId: scenario.bots[0]?.id ?? '' }}
						onOpenBot={(target) => window.__opened.push(target)}
						onNewBot={() => window.__calls.push({ op: 'new-bot', args: [] })}
					/>
				</aside>
			) : (
				<BotTab
					server={server}
					botId={scenario.bots[0]?.id ?? ''}
					host={host}
				/>
			)}
		</div>
	);
}

createRoot(document.getElementById('root') as HTMLElement).render(<Harness />);
