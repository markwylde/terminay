/**
 * A browser host for the app-window layer, without a server.
 *
 * It mounts the real window host over a stand-in terminal pane and feeds it
 * from an in-page fake of the server's window store, so a browser test can be
 * a client that controls the terminal, one that only observes it, or one on a
 * host where the sandbox proxy is missing. The page is served over HTTP under
 * the real workspace content security policy.
 *
 * With `?mirror` in the address, pages of one browser context share that store
 * and a relay over a BroadcastChannel, standing in for the server between a
 * controlling client and its observers (ADR-0039). `?role=observer` starts a
 * page without control.
 */
import type {
	AppWindow,
	AppWindowClient,
	AppWindowContent,
	AppWindowMirrorBatch,
	AppWindowMirrorData,
} from '@terminay/client-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppWindowHost } from '../../src/workspace/appWindows/AppWindowHost';
import { TerminalAppWindowBadge } from '../../src/workspace/appWindows/AppWindowBadge';
import { registerAppWindowPane } from '../../src/workspace/appWindows/appWindowPanes';
import { AppWindowMirrorHub } from '../../src/workspace/appWindows/mirror/mirrorHub';
import {
	AppWindowsContext,
	appWindowPaneKey,
	type ServerAppWindows,
} from '../../src/workspace/appWindows/useServerAppWindows';

const SERVER = 'harness-server';
const SESSION = 'session-a';
const PARAMS = new URLSearchParams(location.search);
const MIRROR = PARAMS.has('mirror');
const ME = `${PARAMS.get('role') ?? 'controller'}-${Math.random().toString(36).slice(2)}`;

type Spec = {
	title: string;
	html: string;
	kind?: 'agent' | 'mcp-app';
	toolInput?: unknown;
	toolResult?: unknown;
	csp?: AppWindowContent['csp'];
};

/** Everything that changes the shared store or crosses the relay. */
type Action =
	| { type: 'add'; id: string; spec: Spec }
	| { type: 'replace'; id: string; html: string }
	| { type: 'state'; id: string; state: AppWindow['state'] }
	| { type: 'close'; id: string }
	| { type: 'control'; holder: string }
	| { type: 'watch'; from: string; watching: boolean }
	| { type: 'resync'; from: string }
	| { type: 'data'; from: string; data: AppWindowMirrorData }
	/** A page that has just loaded asks for the store; the controlling page answers. */
	| { type: 'hello' }
	| { type: 'sync'; windows: AppWindow[]; contents: [string, Omit<AppWindowContent, 'window'>][] };

type Harness = {
	calls: unknown[][];
	/** Mirror batches this page published or received, without their recordings. */
	mirrorLog: { direction: 'out' | 'in'; windowId: string; epoch: number; seq: number; kind: string; bytes: number }[];
	addWindow(spec: Spec): string;
	replaceWindow(id: string, html: string): void;
	setController(value: boolean): void;
	setPaneSize(width: number, height: number): void;
	/** Make this page's connection lose part of every large snapshot. */
	setLossy(value: boolean): void;
	windows(): { id: string; title: string; state: string }[];
};

function App() {
	const [windows, setWindows] = useState<AppWindow[]>([]);
	const [controller, setController] = useState(PARAMS.get('role') !== 'observer');
	const [size, setSize] = useState({ width: 900, height: 600 });
	const contents = useRef(new Map<string, Omit<AppWindowContent, 'window'>>());
	const calls = useRef<unknown[][]>([]);
	const mirrorLog = useRef<Harness['mirrorLog']>([]);
	const lossy = useRef(false);
	const paneRef = useRef<HTMLDivElement | null>(null);
	const sequence = useRef(0);
	const latest = useRef(windows);
	latest.current = windows;
	const isController = useRef(controller);
	isController.current = controller;

	const shared = useMemo(() => {
		const channel = MIRROR ? new BroadcastChannel('app-windows-harness') : undefined;
		const watchers = new Set<string>();
		const dataListeners = new Set<(data: AppWindowMirrorData) => void>();
		const wantedListeners = new Set<(sessionId: string, wanted: boolean) => void>();
		let watching = false;
		const tellHolder = (wanted: boolean) => {
			if (isController.current) for (const listener of wantedListeners) listener(SESSION, wanted);
		};
		const apply = (action: Action, local: boolean): void => {
			switch (action.type) {
				case 'add': {
					const kind = action.spec.kind ?? 'agent';
					sequence.current = Math.max(sequence.current, Number(action.id.split('_')[1]));
					contents.current.set(action.id, {
						html: action.spec.html,
						...(action.spec.csp === undefined ? {} : { csp: action.spec.csp }),
						...(action.spec.toolInput === undefined ? {} : { toolInput: action.spec.toolInput as never }),
						...(action.spec.toolResult === undefined ? {} : { toolResult: action.spec.toolResult as never }),
						...(kind === 'mcp-app' ? { tool: { name: 'draw' } as never } : {}),
					});
					setWindows((current) => [
						...current.map((window) => ({ ...window, state: 'minimised' as const })),
						{
							id: action.id,
							terminalSessionId: SESSION,
							projectId: 'project-a',
							title: action.spec.title,
							source:
								kind === 'agent'
									? { kind: 'agent' }
									: { kind: 'mcp-app', server: 'diagrams', tool: 'draw', resourceUri: 'ui://diagrams/draw' },
							state: 'open',
							contentRevision: 1,
							createdAt: Number(action.id.split('_')[1]),
						},
					]);
					return;
				}
				case 'replace': {
					const content = contents.current.get(action.id);
					if (content !== undefined) contents.current.set(action.id, { ...content, html: action.html });
					setWindows((current) =>
						current.map((window) =>
							window.id === action.id ? { ...window, contentRevision: window.contentRevision + 1 } : window,
						),
					);
					return;
				}
				case 'state':
					setWindows((current) =>
						current.map((window) =>
							window.id === action.id
								? { ...window, state: action.state }
								: action.state === 'open'
									? { ...window, state: 'minimised' }
									: window,
						),
					);
					return;
				case 'close':
					setWindows((current) => current.filter((window) => window.id !== action.id));
					return;
				case 'control':
					setController(action.holder === ME);
					isController.current = action.holder === ME;
					return;
				case 'watch': {
					if (local) return;
					const before = watchers.size;
					if (action.watching) watchers.add(action.from);
					else watchers.delete(action.from);
					// As the server does: a new watcher needs a snapshot; the last one leaving stops the recording.
					if (action.watching) tellHolder(true);
					else if (before > 0 && watchers.size === 0) tellHolder(false);
					return;
				}
				case 'resync':
					if (!local) tellHolder(true);
					return;
				case 'hello':
					if (!local && isController.current && latest.current.length > 0)
						channel?.postMessage({ type: 'sync', windows: latest.current, contents: [...contents.current] } satisfies Action);
					return;
				case 'sync':
					if (local || latest.current.length > 0) return;
					for (const [id, content] of action.contents) contents.current.set(id, content);
					sequence.current = action.windows.length;
					setWindows(action.windows);
					return;
				case 'data':
					if (local || !watching) return;
					// A connection that cannot keep up: the second part of every
					// multi-part snapshot never arrives.
					if (lossy.current && action.data.kind === 'snapshot' && action.data.seq === 1) return;
					mirrorLog.current.push({
						direction: 'in',
						windowId: action.data.windowId,
						epoch: action.data.epoch,
						seq: action.data.seq,
						kind: action.data.kind,
						bytes: action.data.data.length,
					});
					for (const listener of dataListeners) listener(action.data);
					return;
			}
		};
		const dispatch = (action: Action): void => {
			apply(action, true);
			channel?.postMessage(action);
		};
		channel?.addEventListener('message', (event) => apply(event.data as Action, false));
		channel?.postMessage({ type: 'hello' } satisfies Action);

		const change = (id: string, state: AppWindow['state']) => dispatch({ type: 'state', id, state });
		const fake = {
			list: async () => latest.current,
			content: async (id: string) => {
				calls.current.push(['content', id]);
				const window = latest.current.find((entry) => entry.id === id);
				const content = contents.current.get(id);
				if (window === undefined || content === undefined) throw new Error('gone');
				return { window, ...content };
			},
			setState: async (id: string, state: AppWindow['state']) => {
				calls.current.push(['setState', id, state]);
				change(id, state);
			},
			close: async (id: string) => {
				calls.current.push(['close', id]);
				dispatch({ type: 'close', id });
			},
			// As the server does: only the controlling client may speak for a
			// view, and a delivered message minimises its window.
			sendMessage: async (id: string, text: string) => {
				calls.current.push(['sendMessage', id, text]);
				change(id, 'minimised');
			},
			updateContext: async (id: string, text: string) => {
				calls.current.push(['updateContext', id, text]);
			},
			viewRequest: async (id: string, method: string, params: unknown) => {
				calls.current.push(['viewRequest', id, method, params]);
				return { content: [{ type: 'text', text: 'polled' }], structuredContent: { polled: true } };
			},
			onChanged: () => () => {},
			mirrorWanted: async () => watchers.size > 0,
			watchMirror: async () => {
				calls.current.push(['watchMirror']);
				watching = true;
				dispatch({ type: 'watch', from: ME, watching: true });
			},
			unwatchMirror: async () => {
				calls.current.push(['unwatchMirror']);
				watching = false;
				dispatch({ type: 'watch', from: ME, watching: false });
			},
			resyncMirror: async () => {
				calls.current.push(['resyncMirror']);
				dispatch({ type: 'resync', from: ME });
			},
			publishMirror: async (windowId: string, batch: AppWindowMirrorBatch) => {
				if (!isController.current)
					throw Object.assign(new Error('only the controlling client may publish'), { code: 'forbidden' });
				const window = latest.current.find((entry) => entry.id === windowId);
				if (window === undefined) throw new Error('gone');
				mirrorLog.current.push({
					direction: 'out',
					windowId,
					epoch: batch.epoch,
					seq: batch.seq,
					kind: batch.kind,
					bytes: batch.data.length,
				});
				dispatch({
					type: 'data',
					from: ME,
					data: { ...batch, windowId, terminalSessionId: SESSION, contentRevision: window.contentRevision },
				});
			},
			onMirrorData: (listener: (data: AppWindowMirrorData) => void) => {
				dataListeners.add(listener);
				return () => dataListeners.delete(listener);
			},
			onMirrorWanted: (listener: (sessionId: string, wanted: boolean) => void) => {
				wantedListeners.add(listener);
				return () => wantedListeners.delete(listener);
			},
		};
		const client = fake as unknown as AppWindowClient;
		return { client, dispatch, mirror: MIRROR ? new AppWindowMirrorHub(client) : undefined };
	}, []);
	const { client, dispatch, mirror } = shared;

	useEffect(() => {
		const harness: Harness = {
			calls: calls.current,
			mirrorLog: mirrorLog.current,
			addWindow: (spec) => {
				const id = `win_${sequence.current + 1}`;
				dispatch({ type: 'add', id, spec });
				return id;
			},
			replaceWindow: (id, html) => dispatch({ type: 'replace', id, html }),
			setController,
			setPaneSize: (width, height) => setSize({ width, height }),
			setLossy: (value) => {
				lossy.current = value;
			},
			windows: () => latest.current.map(({ id, title, state }) => ({ id, title, state })),
		};
		(window as unknown as { harness: Harness }).harness = harness;
	}, [dispatch]);

	useEffect(() => {
		const element = paneRef.current;
		if (element === null) return;
		return registerAppWindowPane(appWindowPaneKey(SERVER, SESSION), {
			serverId: SERVER,
			sessionId: SESSION,
			element,
			isController: controller,
			takeControl: () => {
				calls.current.push(['takeControl']);
				if (MIRROR) dispatch({ type: 'control', holder: ME });
				else setController(true);
			},
			renewControl: async () => {
				calls.current.push(['renewControl']);
			},
			focusTerminal: () => calls.current.push(['focusTerminal']),
		});
	}, [controller, dispatch]);

	const byServer = useMemo(
		() =>
			new Map<string, ServerAppWindows>([
				[
					SERVER,
					{ serverId: SERVER, windows, client, loaded: true, ...(mirror === undefined ? {} : { mirror }) },
				],
			]),
		[windows, client, mirror],
	);

	return (
		<AppWindowsContext.Provider value={byServer}>
			<div id="tabs">
				Terminal 1 <TerminalAppWindowBadge serverId={SERVER} sessionId={SESSION} />
			</div>
			<div
				id="pane"
				ref={paneRef}
				className="terminal-panel"
				style={{ width: size.width, height: size.height }}
			>
				<div id="terminal" className="terminal-panel-root">
					terminal output
				</div>
				<div className="terminal-app-window-rail" aria-hidden="true" />
			</div>
			<AppWindowHost />
		</AppWindowsContext.Provider>
	);
}

const root = document.getElementById('root');
if (root !== null) createRoot(root).render(<App />);
