import { foldTranscript } from '../src/workspace/bots/transcriptModel';
/**
 * Home › Bots components against a fake server projection, for
 * scripts/bots-ui.test.mjs. The fake records every call in `window.__calls`
 * and `window.__harness` lets a test push live changes.
 */

import type {
	BotProfile,
	BotMessage,
	BotRuntimeEvent,
	BotSession,
	BotSessionRecord,
	BotSiblingContainer,
} from '@terminay/protocol';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BotsSection } from '../src/workspace/bots/BotsSection';
import { BotTab } from '../src/workspace/bots/BotTab';
import type { BotTabHost } from '../src/workspace/bots/botTabHost';
import type {
	BotAgentOption,
	ServerBots,
} from '../src/workspace/bots/useServerBots';

type Call = { op: string; args: unknown[] };
type Scenario = {
	view: 'dashboard' | 'tab';
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
	settingsRefusal?: string;
	sendRefusal?: string;
	postDelayMs?: number;
	imageDelayMs?: number;
	imageSize?: { width: number; height: number };
};

declare global {
	interface Window {
		__calls: Call[];
		__harness: {
			setSessions: (botId: string, sessions: BotSessionRecord[]) => void;
			setTranscript: (sessionId: string, updates: unknown[]) => void;
			setVisible: (visible: boolean) => void;
		};
		__scenario: Scenario;
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
			const rows = [...(messageRows.get(args.botId) ?? [])].reverse();
			const offset = Number(args.cursor ?? 0),
				items = rows.slice(offset, offset + (args.limit ?? 10));
			return {
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
			};
			messageRows.set(a.botId, [...rows, message]);
			emitMessage(a.botId, 'message.posted', message.id, 1);
			const result = { message, sessionId: crypto.randomUUID() };
			return scenario.postDelayMs
				? new Promise((resolve) =>
						setTimeout(() => resolve(result), scenario.postDelayMs),
					)
				: result;
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
					result: { mime: 'image/png' },
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
	remove: record('remove'),
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
		],
	})),
	triggerFirings: record('triggerFirings', () => []),
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
	overview: record('overview', (botId) => ({
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

		cpuPercent: 12.5,
		memoryBytes: 512 * 1024 ** 2,
		homeBytes: 80 * 1024 ** 2,
		sampledAt: Date.now(),
		log: 'container started\n',
	})),
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
	lifecycle: record('lifecycle'),
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
