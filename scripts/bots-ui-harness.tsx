/**
 * Home › Bots components against a fake server projection, for
 * scripts/bots-ui.test.mjs. The fake records every call in `window.__calls`
 * and `window.__harness` lets a test push live changes.
 */

import type {
	BotProfile,
	BotSession,
	BotSessionRecord,
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
	socketShared?: boolean;
	limitsChangePending?: boolean;
	settingsRefusal?: string;
	sendRefusal?: string;
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
	command: record('transport.command', (op) => {
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
	queryWithBody: record('transport.queryWithBody', () => ({
		result: { done: true },
		body: new Uint8Array(),
	})),
	subscribe: () => () => {},
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
	shareEngineSocket: scenario.socketShared === true,
	idleStopMs: 30 * 60_000 as number | null,
	limits: { cpus: 2, memoryBytes: 4 * 1024 ** 3, pids: 512 },
	limitsEnforced: true,
	socketWarning: 'root-equivalent',
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
		shareEngineSocket: scenario.socketShared === true,
		socketChangePending: false,
		limitsChangePending: scenario.limitsChangePending === true,
		socketWarning: 'server-account',
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
		const { botId: _b, confirmed: _c, expectedRevision: _r, ...patch } = request;
		settingsNow = { ...settingsNow, ...patch, revision: settingsNow.revision + 1 };
		return settingsNow;
	}),
	containers: record('containers', () => []),
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
