/**
 * A browser host for the app-window layer, without a server.
 *
 * It mounts the real window host over a stand-in terminal pane and feeds it
 * from an in-page fake of the server's window store, so a browser test can be
 * a client that controls the terminal, one that only observes it, or one on a
 * host where the sandbox proxy is missing. The page is served over HTTP under
 * the real workspace content security policy.
 */
import type { AppWindow, AppWindowClient, AppWindowContent } from '@terminay/client-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppWindowHost } from '../../src/workspace/appWindows/AppWindowHost';
import { TerminalAppWindowBadge } from '../../src/workspace/appWindows/AppWindowBadge';
import { registerAppWindowPane } from '../../src/workspace/appWindows/appWindowPanes';
import {
	AppWindowsContext,
	appWindowPaneKey,
	type ServerAppWindows,
} from '../../src/workspace/appWindows/useServerAppWindows';

const SERVER = 'harness-server';
const SESSION = 'session-a';

type Spec = {
	title: string;
	html: string;
	kind?: 'agent' | 'mcp-app';
	toolInput?: unknown;
	toolResult?: unknown;
	csp?: AppWindowContent['csp'];
};

type Harness = {
	calls: unknown[][];
	addWindow(spec: Spec): string;
	replaceWindow(id: string, html: string): void;
	setController(value: boolean): void;
	setPaneSize(width: number, height: number): void;
	windows(): { id: string; title: string; state: string }[];
};

function App() {
	const [windows, setWindows] = useState<AppWindow[]>([]);
	const [controller, setController] = useState(true);
	const [size, setSize] = useState({ width: 900, height: 600 });
	const contents = useRef(new Map<string, Omit<AppWindowContent, 'window'>>());
	const calls = useRef<unknown[][]>([]);
	const paneRef = useRef<HTMLDivElement | null>(null);
	const sequence = useRef(0);
	const latest = useRef(windows);
	latest.current = windows;

	const client = useMemo(() => {
		const change = (id: string, patch: Partial<AppWindow>, minimiseOthers = false) =>
			setWindows((current) =>
				current.map((window) =>
					window.id === id
						? { ...window, ...patch }
						: minimiseOthers
							? { ...window, state: 'minimised' }
							: window,
				),
			);
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
				change(id, { state }, state === 'open');
			},
			close: async (id: string) => {
				calls.current.push(['close', id]);
				setWindows((current) => current.filter((window) => window.id !== id));
			},
			// As the server does: only the controlling client may speak for a
			// view, and a delivered message minimises its window.
			sendMessage: async (id: string, text: string) => {
				calls.current.push(['sendMessage', id, text]);
				change(id, { state: 'minimised' });
			},
			updateContext: async (id: string, text: string) => {
				calls.current.push(['updateContext', id, text]);
			},
			viewRequest: async (id: string, method: string, params: unknown) => {
				calls.current.push(['viewRequest', id, method, params]);
				return { content: [{ type: 'text', text: 'polled' }], structuredContent: { polled: true } };
			},
			onChanged: () => () => {},
		};
		return fake as unknown as AppWindowClient;
	}, []);

	useEffect(() => {
		const harness: Harness = {
			calls: calls.current,
			addWindow: (spec) => {
				sequence.current += 1;
				const id = `win_${sequence.current}`;
				const kind = spec.kind ?? 'agent';
				contents.current.set(id, {
					html: spec.html,
					...(spec.csp === undefined ? {} : { csp: spec.csp }),
					...(spec.toolInput === undefined ? {} : { toolInput: spec.toolInput as never }),
					...(spec.toolResult === undefined ? {} : { toolResult: spec.toolResult as never }),
					...(kind === 'mcp-app' ? { tool: { name: 'draw' } as never } : {}),
				});
				setWindows((current) => [
					...current.map((window) => ({ ...window, state: 'minimised' as const })),
					{
						id,
						terminalSessionId: SESSION,
						projectId: 'project-a',
						title: spec.title,
						source:
							kind === 'agent'
								? { kind: 'agent' }
								: { kind: 'mcp-app', server: 'diagrams', tool: 'draw', resourceUri: 'ui://diagrams/draw' },
						state: 'open',
						contentRevision: 1,
						createdAt: sequence.current,
					},
				]);
				return id;
			},
			replaceWindow: (id, html) => {
				const content = contents.current.get(id);
				if (content !== undefined) contents.current.set(id, { ...content, html });
				setWindows((current) =>
					current.map((window) =>
						window.id === id ? { ...window, contentRevision: window.contentRevision + 1 } : window,
					),
				);
			},
			setController,
			setPaneSize: (width, height) => setSize({ width, height }),
			windows: () => latest.current.map(({ id, title, state }) => ({ id, title, state })),
		};
		(window as unknown as { harness: Harness }).harness = harness;
	}, []);

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
				setController(true);
			},
			renewControl: async () => {
				calls.current.push(['renewControl']);
			},
			focusTerminal: () => calls.current.push(['focusTerminal']),
		});
	}, [controller]);

	const byServer = useMemo(
		() =>
			new Map<string, ServerAppWindows>([
				[SERVER, { serverId: SERVER, windows, client, loaded: true }],
			]),
		[windows, client],
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
