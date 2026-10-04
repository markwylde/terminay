/**
 * Renders every terminal's app windows (terminal-app-windows).
 *
 * The host is mounted once, outside the docking layout, and positions each
 * window over the pane of the terminal that owns it. A window and its
 * minimised tab are one element that is restyled and moved, never re-parented,
 * so a view keeps its state through minimise, terminal switches, and project
 * switches. Only the client that controls a terminal runs its views.
 */

import type { AppWindow, AppWindowClient } from '@terminay/client-core';
import {
	type PointerEvent as ReactPointerEvent,
	type ReactElement,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { openExternalUrl } from '../../host/nativeActions';
import {
	APP_VIEW_SANDBOX,
	appViewAvailable,
	appViewProxyUrl,
} from './appViewAvailability';
import {
	type AppWindowPane,
	appWindowPanesSnapshot,
	isPaneVisible,
	markAppWindowSeen,
	markAppWindowUnseen,
	retainAppWindowUnseen,
	subscribeAppWindowPanes,
} from './appWindowPanes';
import {
	AppWindowsContext,
	appWindowPaneKey,
} from './useServerAppWindows';
import { AppViewBridge, type ViewHostContext } from './viewBridge';
import { buildViewDocument } from './viewDocument';
import {
	layoutAppWindows,
	type PlacedWindow,
	TAB_MAX_WIDTH,
	tabOffsetAfterDrag,
	WINDOW_HEADER_HEIGHT,
	WINDOW_HEADER_HEIGHT_NARROW,
} from './windowLayout';
import './AppWindowHost.css';

/** Fired by the workspace when the docking layout or active project changes. */
export const APP_WINDOW_LAYOUT_EVENT = 'terminay-app-window-layout';
const RAIL_VARIABLE = '--app-window-rail';

type PaneFrame = Readonly<{
	left: number;
	top: number;
	width: number;
	height: number;
	visible: boolean;
}>;

type WindowEntry = Readonly<{
	key: string;
	paneKey: string;
	serverId: string;
	window: AppWindow;
	client: AppWindowClient;
}>;

const sameFrame = (left: PaneFrame | undefined, right: PaneFrame): boolean =>
	left !== undefined &&
	left.left === right.left &&
	left.top === right.top &&
	left.width === right.width &&
	left.height === right.height &&
	left.visible === right.visible;

/** A tab's width for its title, without measuring the DOM. */
function tabWidthFor(title: string): number {
	return Math.min(TAB_MAX_WIDTH, 46 + Math.ceil([...title].length * 7.4));
}

export function AppWindowHost(): ReactElement | null {
	const byServer = useContext(AppWindowsContext);
	const panes = useSyncExternalStore(
		subscribeAppWindowPanes,
		appWindowPanesSnapshot,
		appWindowPanesSnapshot,
	);
	const [available, setAvailable] = useState<boolean | undefined>(undefined);
	const [frames, setFrames] = useState<ReadonlyMap<string, PaneFrame>>(() => new Map());
	const [contentHeights, setContentHeights] = useState<ReadonlyMap<string, number>>(
		() => new Map(),
	);
	const [tabOffsets, setTabOffsets] = useState<ReadonlyMap<string, number>>(() => new Map());
	const [fullscreen, setFullscreen] = useState<ReadonlyMap<string, string>>(() => new Map());

	const entries = useMemo<readonly WindowEntry[]>(() => {
		const list: WindowEntry[] = [];
		for (const server of byServer.values())
			for (const window of server.windows)
				list.push({
					key: `${server.serverId}:${window.id}`,
					paneKey: appWindowPaneKey(server.serverId, window.terminalSessionId),
					serverId: server.serverId,
					window,
					client: server.client,
				});
		return list;
	}, [byServer]);

	// Probe the sandbox proxy the first time any window exists.
	const hasWindows = entries.length > 0;
	useEffect(() => {
		if (!hasWindows || available !== undefined) return;
		let cancelled = false;
		void appViewAvailable().then((value) => {
			if (!cancelled) setAvailable(value);
		});
		return () => {
			cancelled = true;
		};
	}, [hasWindows, available]);

	// --- follow each pane's rectangle ---
	const panesRef = useRef(panes);
	panesRef.current = panes;
	const measure = useCallback(() => {
		setFrames((previous) => {
			let changed = false;
			const next = new Map<string, PaneFrame>();
			for (const [key, pane] of panesRef.current) {
				const rect = pane.element.getBoundingClientRect();
				const frame: PaneFrame = {
					left: Math.round(rect.left),
					top: Math.round(rect.top),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
					visible: isPaneVisible(pane),
				};
				if (!sameFrame(previous.get(key), frame)) changed = true;
				next.set(key, frame);
			}
			return changed || next.size !== previous.size ? next : previous;
		});
	}, []);

	useLayoutEffect(() => {
		if (typeof ResizeObserver === 'undefined') return;
		let queued = false;
		const schedule = (): void => {
			if (queued) return;
			queued = true;
			requestAnimationFrame(() => {
				queued = false;
				measure();
			});
		};
		const observer = new ResizeObserver(schedule);
		for (const pane of panes.values()) observer.observe(pane.element);
		window.addEventListener('resize', schedule);
		window.addEventListener(APP_WINDOW_LAYOUT_EVENT, schedule);
		measure();
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', schedule);
			window.removeEventListener(APP_WINDOW_LAYOUT_EVENT, schedule);
		};
	}, [panes, measure]);

	// --- layout per pane ---
	// A pane that is switched away (an inactive tab, another project) has no
	// size. Its windows stay mounted at their last position, hidden, so their
	// views keep running and keep their state until the pane is shown again.
	const lastFrames = useRef(new Map<string, PaneFrame>());
	const layouts = useMemo(() => {
		const byPane = new Map<string, WindowEntry[]>();
		for (const entry of entries) {
			const list = byPane.get(entry.paneKey) ?? [];
			list.push(entry);
			byPane.set(entry.paneKey, list);
		}
		const placed = new Map<string, PlacedWindow>();
		const rails = new Map<string, number>();
		const narrow = new Map<string, boolean>();
		const effective = new Map<string, PaneFrame>();
		for (const [paneKey, list] of byPane) {
			const measured = frames.get(paneKey);
			const onScreen =
				measured?.visible === true && measured.width > 0 && measured.height > 0;
			const frame = onScreen ? measured : lastFrames.current.get(paneKey);
			if (frame === undefined) continue;
			if (onScreen) lastFrames.current.set(paneKey, frame);
			effective.set(paneKey, { ...frame, visible: onScreen });
			const fullscreenId = fullscreen.get(paneKey);
			const layout = layoutAppWindows({
				paneWidth: frame.width,
				paneHeight: frame.height,
				windows: list.map(({ key, window }) => ({
					id: key,
					state: window.state,
					contentHeight: contentHeights.get(key),
					tabOffset: tabOffsets.get(key),
					tabWidth: tabWidthFor(window.title),
				})),
				...(fullscreenId === undefined ? {} : { fullscreenId }),
			});
			for (const item of layout.windows) placed.set(item.id, item);
			rails.set(paneKey, layout.railHeight);
			narrow.set(paneKey, layout.narrow);
		}
		for (const paneKey of [...lastFrames.current.keys()])
			if (!byPane.has(paneKey)) lastFrames.current.delete(paneKey);
		return { placed, rails, narrow, frames: effective };
	}, [entries, frames, contentHeights, tabOffsets, fullscreen]);

	// The pane reserves the rail under its terminal, so the terminal ends above
	// the tabs. The variable is all the pane needs to know about windows.
	const railed = useRef(new Set<string>());
	useLayoutEffect(() => {
		const next = new Set<string>();
		for (const [paneKey, pane] of panes) {
			if (layouts.frames.get(paneKey)?.visible === false) {
				if (railed.current.has(paneKey)) next.add(paneKey);
				continue;
			}
			const height = layouts.rails.get(paneKey) ?? 0;
			if (height > 0) {
				pane.element.style.setProperty(RAIL_VARIABLE, `${height}px`);
				next.add(paneKey);
			} else if (railed.current.has(paneKey)) {
				pane.element.style.removeProperty(RAIL_VARIABLE);
			}
		}
		railed.current = next;
	}, [panes, layouts]);

	// --- attention: a window that arrived while its terminal was off screen ---
	const known = useRef(new Map<string, Set<string>>());
	useEffect(() => {
		const paneKeys = new Set<string>();
		for (const server of byServer.values()) {
			const seenIds = known.current.get(server.serverId);
			const ids = new Set(server.windows.map((window) => window.id));
			for (const window of server.windows) {
				const paneKey = appWindowPaneKey(server.serverId, window.terminalSessionId);
				paneKeys.add(paneKey);
				// The first list a server sends is what already existed, not news.
				if (
					seenIds !== undefined &&
					!seenIds.has(window.id) &&
					!isPaneVisible(panesRef.current.get(paneKey))
				)
					markAppWindowUnseen(paneKey);
			}
			if (server.loaded) known.current.set(server.serverId, ids);
		}
		retainAppWindowUnseen(paneKeys);
	}, [byServer]);
	useEffect(() => {
		for (const [paneKey, frame] of frames) if (frame.visible) markAppWindowSeen(paneKey);
	}, [frames]);

	// Forget local state for windows that no longer exist.
	useEffect(() => {
		const live = new Set(entries.map((entry) => entry.key));
		const prune = <T,>(map: ReadonlyMap<string, T>): ReadonlyMap<string, T> => {
			if ([...map.keys()].every((key) => live.has(key))) return map;
			return new Map([...map].filter(([key]) => live.has(key)));
		};
		setContentHeights(prune);
		setTabOffsets(prune);
		setFullscreen((previous) => {
			if ([...previous.values()].every((key) => live.has(key))) return previous;
			return new Map([...previous].filter(([, key]) => live.has(key)));
		});
	}, [entries]);

	const onResized = useCallback((key: string, height: number) => {
		setContentHeights((previous) =>
			Math.abs((previous.get(key) ?? 0) - height) < 1
				? previous
				: new Map(previous).set(key, height),
		);
	}, []);
	const onTabOffset = useCallback((key: string, offset: number) => {
		setTabOffsets((previous) => new Map(previous).set(key, offset));
	}, []);
	const onFullscreen = useCallback((paneKey: string, key: string | undefined) => {
		setFullscreen((previous) => {
			const next = new Map(previous);
			if (key === undefined) next.delete(paneKey);
			else next.set(paneKey, key);
			return next;
		});
	}, []);

	if (entries.length === 0) return null;
	return (
		<div className="app-window-host">
			{entries.map((entry) => {
				const frame = layouts.frames.get(entry.paneKey);
				const placed = layouts.placed.get(entry.key);
				const pane = panes.get(entry.paneKey);
				if (frame === undefined || placed === undefined || pane === undefined)
					return null;
				return (
					<AppWindowCard
						key={entry.key}
						entry={entry}
						pane={pane}
						frame={frame}
						placed={placed}
						narrow={layouts.narrow.get(entry.paneKey) === true}
						available={available}
						isFullscreen={fullscreen.get(entry.paneKey) === entry.key}
						onResized={onResized}
						onTabOffset={onTabOffset}
						onFullscreen={onFullscreen}
					/>
				);
			})}
		</div>
	);
}

type CardProps = Readonly<{
	entry: WindowEntry;
	pane: AppWindowPane;
	frame: PaneFrame;
	placed: PlacedWindow;
	narrow: boolean;
	available: boolean | undefined;
	isFullscreen: boolean;
	onResized: (key: string, height: number) => void;
	onTabOffset: (key: string, offset: number) => void;
	onFullscreen: (paneKey: string, key: string | undefined) => void;
}>;

function AppWindowCard(props: CardProps): ReactElement {
	const { entry, pane, frame, placed, narrow, available } = props;
	const { window: appWindow, client } = entry;
	const isTab = placed.placement === 'tab';
	const hidden = !frame.visible || placed.placement === 'hidden';
	const drag = useRef<{ startX: number; offset: number; moved: boolean } | null>(null);
	const [dragging, setDragging] = useState(false);
	// The host sits outside the pane, so the window borrows the pane's colours
	// explicitly: it should look like part of the terminal it belongs to.
	const colours = useMemo(() => {
		const style = getComputedStyle(pane.element);
		const background = style.backgroundColor || '#111316';
		const text = style.color || '#e6e6e6';
		return {
			color: text,
			'--app-window-surface': `color-mix(in srgb, ${text} 7%, ${background})`,
			'--app-window-border': `color-mix(in srgb, ${text} 24%, ${background})`,
		};
	}, [pane.element, frame.visible]);

	const restore = (): void => void client.setState(appWindow.id, 'open').catch(() => {});
	const minimise = (): void => {
		props.onFullscreen(entry.paneKey, undefined);
		void client.setState(appWindow.id, 'minimised').catch(() => {});
		pane.focusTerminal();
	};
	const close = (): void => {
		void client.close(appWindow.id).catch(() => {});
		pane.focusTerminal();
	};

	// Only a minimised window can be dragged, and only along the bottom edge.
	const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
		if (!isTab || (event.target as HTMLElement).closest('button') !== null) return;
		drag.current = { startX: event.clientX, offset: placed.rect.x, moved: false };
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// A pointer that is already gone cannot be captured; the drag still
			// works while it stays over the tab.
		}
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
		const state = drag.current;
		if (state === null) return;
		const delta = event.clientX - state.startX;
		if (!state.moved && Math.abs(delta) < 5) return;
		state.moved = true;
		setDragging(true);
		props.onTabOffset(
			entry.key,
			tabOffsetAfterDrag(state.offset, delta, placed.rect.width, frame.width),
		);
	};
	const onPointerUp = (): void => {
		const state = drag.current;
		drag.current = null;
		setDragging(false);
		if (state !== null && !state.moved) restore();
	};

	const source =
		appWindow.source.kind === 'agent'
			? 'Agent'
			: `${appWindow.source.server} · ${appWindow.source.tool}`;
	return (
		<section
			className={`app-window${dragging ? ' app-window--dragging' : ''}`}
			data-placement={placed.placement}
			data-narrow={narrow ? 'true' : undefined}
			data-hidden={hidden ? 'true' : undefined}
			aria-label={`${appWindow.title} window`}
			style={{
				...colours,
				left: frame.left + placed.rect.x,
				top: frame.top + placed.rect.y,
				width: placed.rect.width,
				height: placed.rect.height,
			}}
		>
			<header
				className="app-window__header"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={() => {
					drag.current = null;
					setDragging(false);
				}}
				{...(isTab
					? {
							role: 'button',
							tabIndex: 0,
							'aria-label': `Open ${appWindow.title}`,
							onKeyDown: (event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									restore();
								}
							},
						}
					: {})}
			>
				<span className="app-window__glyph" aria-hidden="true">
					▣
				</span>
				<span className="app-window__title">{appWindow.title}</span>
				{isTab ? null : (
					<>
						<span className="app-window__source">{source}</span>
						<span className="app-window__spacer" />
						<button type="button" aria-label="Minimise window" onClick={minimise}>
							–
						</button>
						<button
							type="button"
							aria-label={props.isFullscreen ? 'Restore window size' : 'Fill the pane'}
							onClick={() =>
								props.onFullscreen(
									entry.paneKey,
									props.isFullscreen ? undefined : entry.key,
								)
							}
						>
							⤢
						</button>
						<button type="button" aria-label="Close window" onClick={close}>
							×
						</button>
					</>
				)}
			</header>
			<div className="app-window__body">
				{available === false ? (
					<p className="app-window__notice">
						App windows cannot be shown on this connection.
					</p>
				) : !pane.isController ? (
					<div className="app-window__notice">
						<p>This window runs on the device controlling the terminal.</p>
						<button type="button" onClick={pane.takeControl}>
							Take control
						</button>
					</div>
				) : available === true ? (
					<AppWindowView
						entry={entry}
						pane={pane}
						placed={placed}
						narrow={narrow}
						onResized={props.onResized}
						onFullscreen={props.onFullscreen}
					/>
				) : null}
			</div>
		</section>
	);
}

type ViewProps = Readonly<{
	entry: WindowEntry;
	pane: AppWindowPane;
	placed: PlacedWindow;
	narrow: boolean;
	onResized: (key: string, height: number) => void;
	onFullscreen: (paneKey: string, key: string | undefined) => void;
}>;

/** One running view: the sandbox proxy frame and its bridge. */
function AppWindowView(props: ViewProps): ReactElement {
	const { entry, pane, placed, narrow } = props;
	const { window: appWindow, client } = entry;
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const bridgeRef = useRef<AppViewBridge | null>(null);
	const [allow, setAllow] = useState<string | undefined>(undefined);
	// An agent may replace its document, which is a new view; an MCP App's
	// revision only means its tool result arrived.
	const documentKey =
		appWindow.source.kind === 'agent'
			? `${appWindow.id}:${appWindow.contentRevision}`
			: appWindow.id;

	const latest = useRef({ placed, narrow, pane, entry, props });
	latest.current = { placed, narrow, pane, entry, props };

	const hostContext = useCallback((): ViewHostContext => {
		const { placed: place, narrow: isNarrow, pane: currentPane } = latest.current;
		const style = getComputedStyle(currentPane.element);
		const fill = place.placement === 'fullscreen';
		return {
			displayMode: fill ? 'fullscreen' : 'pip',
			platform: isNarrow ? 'mobile' : 'desktop',
			touch: isNarrow || matchMedia('(pointer: coarse)').matches,
			width: place.bodyWidth,
			...(fill ? { height: place.bodyHeight ?? 0 } : { maxHeight: place.bodyMaxHeight }),
			theme: 'dark',
			variables: themeVariables(style),
		};
	}, []);

	const asController = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
		try {
			return await work();
		} catch (error) {
			if ((error as { code?: unknown } | null)?.code !== 'forbidden') throw error;
			await latest.current.pane.renewControl();
			return work();
		}
	}, []);

	// Fetch the content, then start (or update) the view.
	useEffect(() => {
		let cancelled = false;
		void client
			.content(appWindow.id)
			.then((content) => {
				if (cancelled) return;
				const kind = content.window.source.kind;
				const built = buildViewDocument({
					html: content.html,
					source: { kind },
					...(content.csp === undefined ? {} : { csp: content.csp }),
					...(content.permissions === undefined
						? {}
						: { permissions: content.permissions }),
				});
				const bridgeContent = {
					html: built.html,
					allow: built.allow,
					source: kind,
					...(content.tool === undefined ? {} : { tool: content.tool }),
					...(content.toolInput === undefined ? {} : { toolInput: content.toolInput }),
					...(content.toolResult === undefined ? {} : { toolResult: content.toolResult }),
					...(content.toolCancelled === undefined
						? {}
						: { toolCancelled: content.toolCancelled }),
				} as const;
				if (bridgeRef.current !== null) {
					bridgeRef.current.updateContent(bridgeContent);
					return;
				}
				bridgeRef.current = new AppViewBridge(bridgeContent, {
					post: (message) => frameRef.current?.contentWindow?.postMessage(message, '*'),
					context: hostContext,
					resized: (height) => {
						const place = latest.current.placed.placement;
						// Only meaningful while the view controls its own height.
						if (place === 'window' || place === 'sheet')
							latest.current.props.onResized(latest.current.entry.key, height);
					},
					// The server honours a view only from the client controlling its
					// terminal. This client is that one, but its lease may have lapsed
					// while its timers were paused, so it renews its own lease first.
					sendMessage: (text) =>
						asController(() => client.sendMessage(appWindow.id, text)),
					updateContext: (text) =>
						asController(() => client.updateContext(appWindow.id, text)),
					viewRequest: (method, params) =>
						asController(() =>
							client.viewRequest(appWindow.id, method, params as never),
						),
					openLink: (url) => void openExternalUrl(url),
					requestDisplayMode: (mode) => {
						const current = latest.current;
						current.props.onFullscreen(
							current.entry.paneKey,
							mode === 'fullscreen' ? current.entry.key : undefined,
						);
						return mode;
					},
					close: () => void client.close(appWindow.id).catch(() => {}),
				});
				setAllow(built.allow);
			})
			.catch(() => {
				// The window ended, or this client may not read it.
			});
		return () => {
			cancelled = true;
		};
		// The revision is what changes the content; the key decides whether the
		// view is new.
	}, [client, appWindow.id, appWindow.contentRevision, hostContext, asController]);

	// A new document is a new view: the old bridge goes with the old frame.
	useEffect(() => {
		return () => {
			bridgeRef.current?.teardown('closed');
			bridgeRef.current = null;
			setAllow(undefined);
		};
	}, [documentKey]);

	useEffect(() => {
		const onMessage = (event: MessageEvent): void => {
			if (frameRef.current === null || event.source !== frameRef.current.contentWindow)
				return;
			void bridgeRef.current?.handle(event.data);
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	// Tell the view when its container changes.
	const contextKey = `${placed.placement}:${placed.bodyWidth}:${placed.bodyHeight ?? ''}:${placed.bodyMaxHeight ?? ''}:${narrow}`;
	useEffect(() => {
		bridgeRef.current?.contextChanged();
	}, [contextKey]);

	if (allow === undefined) return <div className="app-window__loading" aria-busy="true" />;
	return (
		<iframe
			key={documentKey}
			ref={frameRef}
			className="app-window__frame"
			title={appWindow.title}
			src={appViewProxyUrl()}
			sandbox={APP_VIEW_SANDBOX}
			referrerPolicy="no-referrer"
			{...(allow === '' ? {} : { allow })}
		/>
	);
}

/** The standard MCP Apps theme variables, taken from the pane the view is in. */
function themeVariables(style: CSSStyleDeclaration): Record<string, string> {
	const background = style.backgroundColor || '#111316';
	const text = style.color || '#e6e6e6';
	return {
		'--color-background-primary': background,
		'--color-background-secondary': `color-mix(in srgb, ${text} 6%, ${background})`,
		'--color-background-tertiary': `color-mix(in srgb, ${text} 11%, ${background})`,
		'--color-text-primary': text,
		'--color-text-secondary': `color-mix(in srgb, ${text} 68%, ${background})`,
		'--color-text-tertiary': `color-mix(in srgb, ${text} 48%, ${background})`,
		'--color-border-primary': `color-mix(in srgb, ${text} 22%, ${background})`,
		'--color-border-secondary': `color-mix(in srgb, ${text} 13%, ${background})`,
		'--color-ring-primary': style.getPropertyValue('--accent-color').trim() || '#8fb7e8',
		'--font-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
		'--font-mono': 'ui-monospace, Menlo, Consolas, monospace',
		'--border-radius-sm': '4px',
		'--border-radius-md': '6px',
		'--border-radius-lg': '10px',
	};
}

export const APP_WINDOW_HEADER_HEIGHTS = {
	desktop: WINDOW_HEADER_HEIGHT,
	narrow: WINDOW_HEADER_HEIGHT_NARROW,
} as const;
