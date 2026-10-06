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
	type MouseEvent as ReactMouseEvent,
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
import { AppWindowMirror } from './AppWindowMirror';
import { isNotControllerError } from './controlErrors.ts';
import { MIRROR_RECORDER_SCRIPT } from './mirror/bundles.generated.ts';
import type { AppWindowMirrorHub } from './mirror/mirrorHub.ts';
import { MIRROR_MESSAGE_KEY, type MirrorLoaderControl } from './mirror/mirrorProtocol.ts';
import { ViewRecorderLink } from './mirror/recorderLink.ts';
import { AppViewBridge, type ViewHostContext } from './viewBridge';
import { buildViewDocument } from './viewDocument';
import {
	layoutAppWindows,
	NARROW_PANE_WIDTH,
	type PlacedWindow,
	type ResizeEdges,
	rectAfterResize,
	TAB_MAX_WIDTH,
	tabOffsetAfterDrag,
	WINDOW_HEADER_HEIGHT,
	WINDOW_HEADER_HEIGHT_NARROW,
	type WindowPoint,
	type WindowRect,
	type WindowSize,
} from './windowLayout';
import './AppWindowHost.css';

/** Fired by the workspace when the docking layout or active project changes. */
export const APP_WINDOW_LAYOUT_EVENT = 'terminay-app-window-layout';
const RAIL_VARIABLE = '--app-window-rail';
const RAIL_SELECTOR = ':scope > .terminal-app-window-rail';
const TERMINAL_SELECTOR = ':scope > .terminal-panel-root';
/** A phone or tablet: focusing the terminal there raises the software keyboard. */
const TOUCH_DEVICE_QUERY = '(hover: none) and (pointer: coarse)';
/**
 * How long a view that is about to be removed is kept after it has been told,
 * so that it hears. A frame that is removed at once never receives the message.
 */
const VIEW_TEARDOWN_GRACE_MS = 150;
/** Messages between a view's sandbox proxy and the workspace; never relayed for a view. */
const PROXY_KEY = 'terminayProxy';
/** A Tab pressed in the workspace this recently is what moved the focus into a view. */
const FOCUS_BY_TAB_MS = 500;

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
	/** Present when this server mirrors views to clients not in control. */
	mirror?: AppWindowMirrorHub;
	/** Whether a message from this window may carry files. */
	attachments: boolean;
}>;

const sameFrame = (left: PaneFrame | undefined, right: PaneFrame): boolean =>
	left !== undefined &&
	left.left === right.left &&
	left.top === right.top &&
	left.width === right.width &&
	left.height === right.height &&
	left.visible === right.visible;

/**
 * A tab's width for its title and its close control, without measuring the
 * DOM. On a phone the control is finger-sized and the title keeps its room, so
 * that a tap meant to open the window does not land on the control.
 */
function tabWidthFor(title: string, narrow: boolean): number {
	const letters = [...title].length;
	return Math.min(
		TAB_MAX_WIDTH,
		narrow ? 86 + Math.ceil(letters * 8) : 68 + Math.ceil(letters * 7.4),
	);
}

/** Where the user put an open window and how big they made it, on this client. */
type WindowGeometry = Readonly<{ position?: WindowPoint; size?: WindowSize }>;

/** A pointer must travel this far before a press on a title bar is a drag. */
const DRAG_THRESHOLD = 4;

const RESIZE_HANDLES: readonly (readonly [string, ResizeEdges])[] = [
	['n', { x: 0, y: -1 }],
	['s', { x: 0, y: 1 }],
	['w', { x: -1, y: 0 }],
	['e', { x: 1, y: 0 }],
	['nw', { x: -1, y: -1 }],
	['ne', { x: 1, y: -1 }],
	['sw', { x: -1, y: 1 }],
	['se', { x: 1, y: 1 }],
];

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
	const [geometry, setGeometry] = useState<ReadonlyMap<string, WindowGeometry>>(() => new Map());
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
					attachments: server.attachments,
					...(server.mirror === undefined ? {} : { mirror: server.mirror }),
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
				// Windows and tabs end where the rail ends. A pane may put rows of
				// its own under the rail (on a phone, the keyboard's command bar),
				// and nothing of a window may cover those.
				const rail = pane.element.querySelector(RAIL_SELECTOR)?.getBoundingClientRect();
				const bottom =
					rail !== undefined && rail.bottom > rect.top
						? Math.min(rail.bottom, rect.bottom)
						: rect.bottom;
				const frame: PaneFrame = {
					left: Math.round(rect.left),
					top: Math.round(rect.top),
					width: Math.round(rect.width),
					height: Math.round(bottom - rect.top),
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
		for (const pane of panes.values()) {
			observer.observe(pane.element);
			// The rail moves, without the pane changing size, when a row appears
			// under it. The terminal above it changes size whenever that happens.
			const terminal = pane.element.querySelector(TERMINAL_SELECTOR);
			if (terminal !== null) observer.observe(terminal);
		}
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
					tabWidth: tabWidthFor(window.title, frame.width < NARROW_PANE_WIDTH),
					...geometry.get(key),
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
	}, [entries, frames, contentHeights, tabOffsets, geometry, fullscreen]);

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
		setGeometry(prune);
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
	const onGeometry = useCallback((key: string, change: WindowGeometry) => {
		setGeometry((previous) => new Map(previous).set(key, { ...previous.get(key), ...change }));
	}, []);
	const onFullscreen = useCallback((paneKey: string, key: string | undefined) => {
		setFullscreen((previous) => {
			const next = new Map(previous);
			if (key === undefined) next.delete(paneKey);
			else next.set(paneKey, key);
			return next;
		});
	}, []);

	// A window that has ended is kept, hidden, for a moment after it leaves the
	// server's list, so that its view can be told it is going before its frame
	// is removed. This is worked out while rendering: a window dropped for even
	// one render would lose its frame at once.
	const liveKeys = new Set(entries.map((entry) => entry.key));
	const previousEntries = useRef<readonly WindowEntry[]>([]);
	const leaving = useRef(new Map<string, WindowEntry>());
	for (const entry of previousEntries.current)
		if (!liveKeys.has(entry.key) && !leaving.current.has(entry.key))
			leaving.current.set(entry.key, entry);
	for (const key of liveKeys) leaving.current.delete(key);
	previousEntries.current = entries;
	const [, forget] = useState(0);
	// Which windows are leaving, not how many: one returning as another leaves
	// is a change, though the count is the same.
	const leavingKeys = [...leaving.current.keys()].join('\n');
	useEffect(() => {
		if (leavingKeys === '') return;
		const keys = leavingKeys.split('\n');
		const timer = setTimeout(() => {
			for (const key of keys) leaving.current.delete(key);
			forget((count) => count + 1);
		}, VIEW_TEARDOWN_GRACE_MS * 2);
		return () => clearTimeout(timer);
	}, [leavingKeys]);
	const departing = [...leaving.current.values()];
	const lastShown = useRef(
		new Map<string, { frame: PaneFrame; placed: PlacedWindow; pane: AppWindowPane; narrow: boolean }>(),
	);

	if (entries.length === 0 && departing.length === 0) return null;
	for (const key of [...lastShown.current.keys()])
		if (!liveKeys.has(key) && !leaving.current.has(key)) lastShown.current.delete(key);
	return (
		<div className="app-window-host">
			{[...entries, ...departing].map((entry) => {
				const isLeaving = !liveKeys.has(entry.key);
				const shown = isLeaving
					? lastShown.current.get(entry.key)
					: (() => {
							const frame = layouts.frames.get(entry.paneKey);
							const placed = layouts.placed.get(entry.key);
							const pane = panes.get(entry.paneKey);
							if (frame === undefined || placed === undefined || pane === undefined)
								return undefined;
							const next = {
								frame,
								placed,
								pane,
								narrow: layouts.narrow.get(entry.paneKey) === true,
							};
							lastShown.current.set(entry.key, next);
							return next;
						})();
				if (shown === undefined) return null;
				return (
					<AppWindowCard
						key={entry.key}
						entry={entry}
						pane={shown.pane}
						frame={isLeaving ? { ...shown.frame, visible: false } : shown.frame}
						placed={shown.placed}
						narrow={shown.narrow}
						available={available}
						isFullscreen={fullscreen.get(entry.paneKey) === entry.key}
						leaving={isLeaving}
						onResized={onResized}
						onTabOffset={onTabOffset}
						onGeometry={onGeometry}
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
	/** The window has ended and is kept only until its view has been told. */
	leaving: boolean;
	onResized: (key: string, height: number) => void;
	onTabOffset: (key: string, offset: number) => void;
	onGeometry: (key: string, change: WindowGeometry) => void;
	onFullscreen: (paneKey: string, key: string | undefined) => void;
}>;

function AppWindowCard(props: CardProps): ReactElement {
	const { entry, pane, frame, placed, narrow, available } = props;
	const { window: appWindow, client } = entry;
	const isTab = placed.placement === 'tab';
	// Only a floating window is moved and resized: not a sheet, not one that
	// fills the pane.
	const isFloating = placed.placement === 'window';
	const hidden = !frame.visible || placed.placement === 'hidden';
	const drag = useRef<{ startX: number; startY: number; rect: WindowRect; moved: boolean } | null>(null);
	const resize = useRef<{ startX: number; startY: number; rect: WindowRect; edges: ResizeEdges } | null>(null);
	/**
	 * Where a finger actually came down, when the press was a touch. A browser
	 * aims a tap at a small control near the finger, so both the press and its
	 * click can arrive on a control the finger was not on.
	 */
	const touched = useRef<WindowPoint | undefined>(undefined);
	/** The press that just ended moved the tab, so its click is not an activation. */
	const dragged = useRef(false);
	const [dragging, setDragging] = useState(false);
	// A view runs here while this client controls the terminal. When that stops
	// being so (control moves, the window is closing) the view is told, and its
	// frame is kept for a moment so that it hears.
	const teardownRef = useRef<((reason: string) => void) | null>(null);
	const wantView = available === true && pane.isController && !props.leaving;
	const [showView, setShowView] = useState(wantView);
	// A view that has been told it is going does go, even if the reason passes
	// before its frame is removed: it is then started afresh, not left running
	// after being told it was over.
	const told = useRef(false);
	useEffect(() => {
		if (!showView) {
			told.current = false;
			if (wantView) setShowView(true);
			return;
		}
		if (wantView && !told.current) return;
		if (!told.current) {
			told.current = true;
			teardownRef.current?.('closed');
		}
		const timer = setTimeout(() => setShowView(false), VIEW_TEARDOWN_GRACE_MS);
		return () => clearTimeout(timer);
	}, [wantView, showView]);
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
	// On a touch device the focus stays where it was: focusing the terminal
	// would raise the software keyboard over what the user is looking at.
	const returnFocus = (): void => {
		if (!matchMedia(TOUCH_DEVICE_QUERY).matches) pane.focusTerminal();
	};
	const minimise = (): void => {
		props.onFullscreen(entry.paneKey, undefined);
		void client.setState(appWindow.id, 'minimised').catch(() => {});
		returnFocus();
	};
	const close = (): void => {
		void client.close(appWindow.id).catch(() => {});
		returnFocus();
	};

	// A minimised window is dragged along the bottom edge only; a floating one
	// anywhere its title bar stays inside the pane.
	const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
		touched.current =
			event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : undefined;
		if ((event.target as HTMLElement).closest('button') !== null) {
			// A tapped control does not take the focus, so a terminal that has the
			// keyboard up keeps it.
			if (event.pointerType === 'touch') event.preventDefault();
			return;
		}
		if (!isTab && !isFloating) return;
		dragged.current = false;
		drag.current = {
			startX: event.clientX,
			startY: event.clientY,
			rect: placed.rect,
			moved: false,
		};
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
		const deltaX = event.clientX - state.startX;
		const deltaY = event.clientY - state.startY;
		if (
			!state.moved &&
			Math.abs(deltaX) < DRAG_THRESHOLD &&
			(isTab || Math.abs(deltaY) < DRAG_THRESHOLD)
		)
			return;
		state.moved = true;
		setDragging(true);
		if (isTab)
			props.onTabOffset(
				entry.key,
				tabOffsetAfterDrag(state.rect.x, deltaX, placed.rect.width, frame.width),
			);
		else
			props.onGeometry(entry.key, {
				position: { x: state.rect.x + deltaX, y: state.rect.y + deltaY },
			});
	};
	const onPointerUp = (): void => {
		const state = drag.current;
		drag.current = null;
		setDragging(false);
		dragged.current = state?.moved === true;
	};
	// A tab opens on the click, not on the pointer's release. The click comes
	// after the release, so opening on the release would leave that click to
	// land on whatever the opening window had put under the pointer by then:
	// on a phone, its minimise control.
	const onTabClick = (event: ReactMouseEvent<HTMLElement>): void => {
		if ((event.target as HTMLElement).closest('button') !== null) return;
		if (dragged.current) dragged.current = false;
		else restore();
	};

	const closeFromTab = (event: ReactMouseEvent<HTMLElement>): void => {
		const finger = touched.current;
		touched.current = undefined;
		const control = event.currentTarget.getBoundingClientRect();
		// A click from the keyboard has no press behind it. A finger that came
		// down beside the control meant the tab: closing is not undone, opening is.
		const beside =
			event.detail !== 0 &&
			finger !== undefined &&
			(finger.x < control.left ||
				finger.x > control.right ||
				finger.y < control.top ||
				finger.y > control.bottom);
		if (beside) restore();
		else close();
	};

	const onResizeDown = (event: ReactPointerEvent<HTMLElement>, edges: ResizeEdges): void => {
		event.preventDefault();
		resize.current = { startX: event.clientX, startY: event.clientY, rect: placed.rect, edges };
		setDragging(true);
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// As for a drag: the resize still works while the pointer stays over the handle.
		}
	};
	const onResizeMove = (event: ReactPointerEvent<HTMLElement>): void => {
		const state = resize.current;
		if (state === null) return;
		const rect = rectAfterResize(
			state.rect,
			state.edges,
			event.clientX - state.startX,
			event.clientY - state.startY,
			WINDOW_HEADER_HEIGHT,
		);
		props.onGeometry(entry.key, {
			position: { x: rect.x, y: rect.y },
			size: { width: rect.width, height: rect.height },
		});
	};
	const onResizeEnd = (): void => {
		resize.current = null;
		setDragging(false);
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
				// A floating window belongs to its pane: what the user has moved
				// or stretched past the pane's edge is cut off there.
				...(isFloating
					? {
							clipPath: `inset(${-placed.rect.y}px ${placed.rect.x + placed.rect.width - frame.width}px ${placed.rect.y + placed.rect.height - frame.height}px ${-placed.rect.x}px)`,
						}
					: {}),
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
							onClick: onTabClick,
							onKeyDown: (event) => {
								if (event.target !== event.currentTarget) return;
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
				{isTab ? (
					<>
						<span className="app-window__spacer" />
						<button type="button" aria-label={`Close ${appWindow.title}`} onClick={closeFromTab}>
							×
						</button>
					</>
				) : (
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
				) : showView ? (
					<AppWindowView
						entry={entry}
						pane={pane}
						placed={placed}
						narrow={narrow}
						teardownRef={teardownRef}
						onResized={props.onResized}
						onFullscreen={props.onFullscreen}
					/>
				) : props.leaving ? null : !pane.isController &&
					entry.mirror !== undefined &&
					available === true ? (
					// A minimised window shows only its tab, so it mirrors nothing.
					isTab ? null : (
						<AppWindowMirror
							windowKey={entry.key}
							window={appWindow}
							client={client}
							mirror={entry.mirror}
							pane={pane}
							bodyWidth={placed.bodyWidth}
							autoHeight={
								placed.bodyHeight === undefined &&
								(placed.placement === 'window' || placed.placement === 'sheet')
							}
							onResized={props.onResized}
						/>
					)
				) : !pane.isController ? (
					<div className="app-window__notice">
						<p>This window runs on the device controlling the terminal.</p>
						<button type="button" onClick={pane.takeControl}>
							Take control
						</button>
					</div>
				) : null}
			</div>
			{isFloating
				? RESIZE_HANDLES.map(([name, edges]) => (
						<div
							key={name}
							className="app-window__resize"
							data-edge={name}
							aria-hidden="true"
							onPointerDown={(event) => onResizeDown(event, edges)}
							onPointerMove={onResizeMove}
							onPointerUp={onResizeEnd}
							onPointerCancel={onResizeEnd}
						/>
					))
				: null}
		</section>
	);
}

type ViewProps = Readonly<{
	entry: WindowEntry;
	pane: AppWindowPane;
	placed: PlacedWindow;
	narrow: boolean;
	/** Set by the view: tells it that it is about to be removed. */
	teardownRef: { current: ((reason: string) => void) | null };
	onResized: (key: string, height: number) => void;
	onFullscreen: (paneKey: string, key: string | undefined) => void;
}>;

/** One running view: the sandbox proxy frame and its bridge. */
function AppWindowView(props: ViewProps): ReactElement {
	const { entry, pane, placed, narrow } = props;
	const { window: appWindow, client } = entry;
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const bridgeRef = useRef<AppViewBridge | null>(null);
	const recorderRef = useRef<ViewRecorderLink | null>(null);
	/** The view's own document has spoken, so it is running and can be recorded. */
	const viewAliveRef = useRef(false);
	const [allow, setAllow] = useState<string | undefined>(undefined);
	const [recorderCount, setRecorderCount] = useState(0);
	// A message with files that is waiting on the person, or on its way.
	const [sending, setSending] = useState<AttachmentSend | undefined>(undefined);
	const sendingRef = useRef<AbortController | null>(null);
	const mirror = entry.mirror;
	const attachments = entry.attachments;
	// An agent may replace its document, which is a new view; an MCP App's
	// revision only means its tool result arrived.
	const documentKey =
		appWindow.source.kind === 'agent'
			? `${appWindow.id}:${appWindow.contentRevision}`
			: appWindow.id;
	// The document actually on screen. It follows `documentKey` a moment late,
	// so the view being replaced is told before its frame is taken away.
	const [activeKey, setActiveKey] = useState(documentKey);
	const [failed, setFailed] = useState(false);
	// The view's frame was removed by its proxy: the page tried to become another.
	const [gone, setGone] = useState(false);

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
			// A window that fills the pane, or that the user resized, has a height
			// of its own; otherwise the view's content decides, up to a limit.
			...(place.bodyHeight !== undefined
				? { height: place.bodyHeight }
				: fill
					? { height: 0 }
					: { maxHeight: place.bodyMaxHeight }),
			theme: 'dark',
			variables: themeVariables(style),
		};
	}, []);

	const asController = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
		try {
			return await work();
		} catch (error) {
			// Only a lapsed lease is worth a second try. A permission the user
			// declined is an answer, and asking again would prompt them again.
			if (!isNotControllerError(error)) throw error;
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
					...(content.data === undefined ? {} : { data: content.data }),
					attachments,
					source: { kind },
					...(content.csp === undefined ? {} : { csp: content.csp }),
					...(content.permissions === undefined
						? {}
						: { permissions: content.permissions }),
				});
				const bridgeContent = {
					attachments,
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
				// While another client watches this terminal, the view is recorded
				// for it (ADR-0039). The recorder is sent only then. A view that
				// started before this server offered a mirror gets its link now.
				const ensureRecorder = (): void => {
					if (recorderRef.current !== null || mirror === undefined) return;
					recorderRef.current = new ViewRecorderLink({
						post: (message) =>
							frameRef.current?.contentWindow?.postMessage(message, '*'),
						recorderScript: MIRROR_RECORDER_SCRIPT,
						publish: (batch) =>
							asController(() => mirror.publish(appWindow.id, batch)),
					});
					if (viewAliveRef.current) recorderRef.current.viewAlive();
					setRecorderCount((count) => count + 1);
				};
				if (bridgeRef.current !== null) {
					bridgeRef.current.updateContent(bridgeContent);
					ensureRecorder();
					return;
				}
				bridgeRef.current = new AppViewBridge(bridgeContent, {
					post: (message) => frameRef.current?.contentWindow?.postMessage(message, '*'),
					context: hostContext,
					resized: (height) => {
						const place = latest.current.placed.placement;
						// Only meaningful while the view controls its own height.
						if (
							latest.current.placed.bodyHeight === undefined &&
							(place === 'window' || place === 'sheet')
						)
							latest.current.props.onResized(latest.current.entry.key, height);
					},
					// The server honours a view only from the client controlling its
					// terminal. This client is that one, but its lease may have lapsed
					// while its timers were paused, so it renews its own lease first.
					sendMessage: (text) =>
						asController(() => client.sendMessage(appWindow.id, text)),
					sendAttachments: async (text, files, readPart) => {
						if (sendingRef.current !== null)
							throw new Error('This window is already sending a message');
						const stop = new AbortController();
						sendingRef.current = stop;
						const total = files.reduce((sum, file) => sum + file.size, 0);
						const notSent = new Error('The message was not sent');
						try {
							// A large upload is the person's decision, and it is asked for
							// out here in the frame, where a view can neither draw the
							// question nor answer it.
							if (total > LARGE_ATTACHMENT_BYTES) {
								const agreed = await new Promise<boolean>((resolve) => {
									stop.signal.addEventListener('abort', () => resolve(false), { once: true });
									setSending({ phase: 'confirm', count: files.length, total, answer: resolve });
								});
								if (!agreed) throw notSent;
							}
							setSending({ phase: 'upload', count: files.length, total, sent: 0, cancel: () => stop.abort() });
							// A view that stops answering must not hold the upload open
							// past the person cancelling it.
							const read: typeof readPart = (file, offset, length) =>
								new Promise((resolve, reject) => {
									stop.signal.addEventListener('abort', () => reject(notSent), { once: true });
									readPart(file, offset, length).then(resolve, reject);
								});
							await asController(() =>
								client.sendMessageWithAttachments(appWindow.id, text, files, read, {
									signal: stop.signal,
									onProgress: (sent) =>
										setSending((current) =>
											current?.phase === 'upload' ? { ...current, sent } : current,
										),
								}),
							);
						} catch (error) {
							throw stop.signal.aborted ? notSent : error;
						} finally {
							sendingRef.current = null;
							setSending(undefined);
						}
					},
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
				ensureRecorder();
				setAllow(built.allow);
			})
			.catch(() => {
				// The window ended, this client may not read it, or its content
				// could not be carried. Say so; an empty box explains nothing.
				if (!cancelled && bridgeRef.current === null) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
		// The revision is what changes the content; the active key decides
		// whether the view is new.
	}, [client, appWindow.id, appWindow.contentRevision, activeKey, hostContext, asController, mirror, attachments]);

	// A new document is a new view. The old view is told it is going, given a
	// moment to hear it, and only then is its frame replaced.
	useEffect(() => {
		if (documentKey === activeKey) return;
		const replace = (): void => {
			// What the old document was sending is not sent for the new one.
			sendingRef.current?.abort();
			bridgeRef.current = null;
			recorderRef.current = null;
			viewAliveRef.current = false;
			setAllow(undefined);
			setFailed(false);
			setGone(false);
			setActiveKey(documentKey);
		};
		if (bridgeRef.current === null) {
			replace();
			return;
		}
		bridgeRef.current.teardown('replaced');
		const timer = setTimeout(replace, VIEW_TEARDOWN_GRACE_MS);
		return () => clearTimeout(timer);
	}, [documentKey, activeKey]);

	// Whoever removes this view (the window closing, control moving) tells it
	// first through this.
	const { teardownRef } = props;
	useEffect(() => {
		teardownRef.current = (reason) => {
			sendingRef.current?.abort();
			bridgeRef.current?.teardown(reason);
		};
		return () => {
			// The view is leaving with its window: stop what it was sending.
			sendingRef.current?.abort();
			bridgeRef.current?.abandonParts();
			teardownRef.current = null;
		};
	}, [teardownRef]);

	// Offer this view to the mirror for as long as it runs. Each new view has
	// its own recorder; the count is what tells this effect one was made.
	useEffect(() => {
		const recorder = recorderRef.current;
		if (recorderCount === 0 || mirror === undefined || recorder === null) return;
		return mirror.registerRecorder(appWindow.terminalSessionId, appWindow.id, recorder);
	}, [recorderCount, mirror, appWindow.terminalSessionId, appWindow.id]);

	useEffect(() => {
		const onMessage = (event: MessageEvent): void => {
			if (frameRef.current === null || event.source !== frameRef.current.contentWindow)
				return;
			// What the proxy itself says about the view, which a view cannot send.
			const proxy = (event.data as { [PROXY_KEY]?: { type?: unknown; id?: unknown; active?: unknown } } | null)?.[PROXY_KEY];
			if (typeof proxy === 'object' && proxy !== null) {
				if (proxy.type === 'view-gone') setGone(true);
				else if (proxy.type === 'activation' && proxy.id === focusQuestion.current && proxy.active !== true) {
					// The view has the keyboard and nobody gave it: it took the focus
					// itself. Keys meant for the terminal would go to it, and one of
					// them would count as the gesture that lets it type back. The
					// focus goes back where it was.
					if (document.activeElement === frameRef.current) {
						frameRef.current?.blur();
						latest.current.pane.focusTerminal();
					}
				}
				return;
			}
			const recorder = recorderRef.current;
			if (recorder?.handle(event.data) === true) return;
			// Anything a view says other than its proxy announcing itself shows
			// that the view's own document is running and can be recorded.
			const method = (event.data as { method?: unknown } | null)?.method;
			if (typeof method !== 'string' || !method.startsWith('ui/notifications/sandbox-'))
{
				if (!viewAliveRef.current) {
					// This client was mirroring the window until it took control.
					// What the mirror showed a person had typed, ticked and chosen
					// goes into the view that has just started in its place.
					const { entry: current } = latest.current;
					const state = current.mirror?.takeState(
						current.window.terminalSessionId,
						current.window.id,
					);
					if (state !== undefined) {
						const restore: MirrorLoaderControl = { type: 'restore', state };
						frameRef.current?.contentWindow?.postMessage({ [MIRROR_MESSAGE_KEY]: restore }, '*');
					}
				}
				viewAliveRef.current = true;
				recorder?.viewAlive();
			}
			void bridgeRef.current?.handle(event.data);
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	// A view can take the keyboard focus by itself. When the focus moves into
	// this view's frame, the proxy is asked whether a person has just acted in
	// it; the answer is handled with the proxy's other messages above. Tabbing
	// in from the workspace is a person's doing and needs no asking.
	const focusQuestion = useRef(0);
	useEffect(() => {
		let lastTab = 0;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Tab') lastTab = Date.now();
		};
		const onBlur = (): void => {
			// The focused element is settled once the event has been dispatched.
			setTimeout(() => {
				const frame = frameRef.current;
				if (frame === null || document.activeElement !== frame) return;
				if (Date.now() - lastTab < FOCUS_BY_TAB_MS) return;
				focusQuestion.current += 1;
				frame.contentWindow?.postMessage(
					{ [PROXY_KEY]: { type: 'activation?', id: focusQuestion.current } },
					'*',
				);
			}, 0);
		};
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('blur', onBlur);
		return () => {
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('blur', onBlur);
		};
	}, []);

	// Tell the view when its container changes.
	const contextKey = `${placed.placement}:${placed.bodyWidth}:${placed.bodyHeight ?? ''}:${placed.bodyMaxHeight ?? ''}:${narrow}`;
	useEffect(() => {
		bridgeRef.current?.contextChanged();
	}, [contextKey]);

	if (failed)
		return <p className="app-window__notice">This window could not be loaded.</p>;
	if (gone)
		return (
			<p className="app-window__notice">
				This window stopped because its page tried to leave or replace itself.
			</p>
		);
	if (allow === undefined) return <div className="app-window__loading" aria-busy="true" />;
	return (
		<div className="app-window__view">
			<iframe
				key={activeKey}
				ref={frameRef}
				className="app-window__frame"
				title={appWindow.title}
				src={appViewProxyUrl()}
				sandbox={APP_VIEW_SANDBOX}
				referrerPolicy="no-referrer"
				{...(allow === '' ? {} : { allow })}
			/>
			{sending === undefined ? null : <AttachmentSendBar sending={sending} />}
		</div>
	);
}

/** Attachments above this total are sent only after the person confirms. */
export const LARGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

type AttachmentSend =
	| Readonly<{
			phase: 'confirm';
			count: number;
			total: number;
			answer: (send: boolean) => void;
	  }>
	| Readonly<{
			phase: 'upload';
			count: number;
			total: number;
			sent: number;
			cancel: () => void;
	  }>;

/** A file size for a person to read. */
export function formatAttachmentSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * The strip under a view while a message with files waits on the person or is
 * on its way. It is the workspace's own, outside the sandbox: a view cannot
 * draw it, press its buttons, or hide it.
 */
function AttachmentSendBar(props: { sending: AttachmentSend }): ReactElement {
	const { sending } = props;
	const files = sending.count === 1 ? '1 file' : `${sending.count} files`;
	if (sending.phase === 'confirm')
		return (
			<div className="app-window__send" role="alertdialog" aria-label="Send large attachments?">
				<span className="app-window__send-text">
					Send {files} ({formatAttachmentSize(sending.total)}) to this terminal's server?
				</span>
				<button type="button" onClick={() => sending.answer(false)}>
					Don't send
				</button>
				<button
					type="button"
					className="app-window__send-primary"
					onClick={() => sending.answer(true)}
				>
					Send
				</button>
			</div>
		);
	const percent =
		sending.total === 0 ? 100 : Math.min(100, Math.floor((sending.sent / sending.total) * 100));
	return (
		<div className="app-window__send" role="status">
			<span className="app-window__send-text">
				Sending {files}: {formatAttachmentSize(sending.sent)} of{' '}
				{formatAttachmentSize(sending.total)}
			</span>
			<progress className="app-window__send-progress" max={100} value={percent} />
			<button type="button" onClick={sending.cancel}>
				Cancel
			</button>
		</div>
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
