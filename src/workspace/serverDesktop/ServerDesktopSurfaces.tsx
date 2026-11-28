/**
 * The places that show the server desktop: a tab, and the header's dropdown.
 * Each registers with the hub. The tab focused last holds the live viewer;
 * every other place draws a copy of its picture while it is on screen.
 */

import { ChevronLeft, ExternalLink, MousePointer2 } from 'lucide-react';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from 'react';
import { writeClipboardText } from '../../host/nativeActions';
import type { DesktopTabPlace } from './desktopTabs.ts';
import {
	type ServerDesktopHubValue,
	useServerDesktopHub,
} from './ServerDesktopHub';
import {
	ServerDesktopBar,
	type ServerDesktopMoveTarget,
	ServerDesktopOverlay,
	type ServerDesktopSharing,
	ServerDesktopStateView,
} from './ServerDesktopViews';
import { controlLine, serverDesktopTitle } from './serverDesktopModel.ts';

/** Where a desktop tab is: Home, or one folder of a project. */
export type DesktopTabLocation = 'home' | DesktopTabPlace;

/** How the window moves a desktop tab between Home and its projects. */
export type ServerDesktopPlaces = Readonly<{
	/** Everywhere a tab could go from `from`. */
	targets: (from: DesktopTabLocation) => readonly ServerDesktopMoveTarget[];
	/** Move a tab. `closeHere` closes it where it is, when that is Home. */
	move: (
		tabId: string,
		from: DesktopTabLocation,
		to: ServerDesktopMoveTarget,
		closeHere: () => void,
	) => void;
	/** Open a new desktop tab wherever the window is showing now. */
	openHere: () => void;
}>;

export const ServerDesktopPlacesContext =
	createContext<ServerDesktopPlaces | null>(null);

/** Copies a few times a second are plenty for a thumbnail or a second tab. */
const MIRROR_INTERVAL_MS = 1000 / 15;

/**
 * A copy of the live viewer's picture, drawn to fit, only while this element
 * is on screen and the page is visible.
 */
export function ServerDesktopMirror({
	hub,
	className,
	onActivate,
	label,
}: Readonly<{
	hub: ServerDesktopHubValue;
	className?: string;
	onActivate?: () => void;
	label: string;
}>) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const { picture } = hub;
	useEffect(() => {
		const target = canvas.current;
		if (target === null) return;
		let onScreen = false;
		let frame = 0;
		let last = 0;
		const draw = (now: number) => {
			frame = 0;
			if (!onScreen || document.visibilityState !== 'visible') return;
			frame = requestAnimationFrame(draw);
			if (now - last < MIRROR_INTERVAL_MS) return;
			last = now;
			const source = picture();
			const context = target.getContext('2d');
			if (context === null) return;
			const ratio = window.devicePixelRatio || 1;
			const width = Math.max(1, Math.round(target.clientWidth * ratio));
			const height = Math.max(1, Math.round(target.clientHeight * ratio));
			if (target.width !== width) target.width = width;
			if (target.height !== height) target.height = height;
			context.fillStyle = '#0d0f12';
			context.fillRect(0, 0, width, height);
			if (source === null || source.width === 0 || source.height === 0) return;
			const scale = Math.min(width / source.width, height / source.height);
			const w = source.width * scale;
			const h = source.height * scale;
			context.imageSmoothingQuality = 'high';
			context.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
		};
		const start = () => {
			if (frame === 0 && onScreen) frame = requestAnimationFrame(draw);
		};
		const observer = new IntersectionObserver((entries) => {
			onScreen = entries.some((entry) => entry.isIntersecting);
			start();
		});
		observer.observe(target);
		const onVisibility = () => start();
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			observer.disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
			if (frame !== 0) cancelAnimationFrame(frame);
		};
	}, [picture]);
	return (
		<canvas
			ref={canvas}
			className={`server-desktop__mirror${className ? ` ${className}` : ''}`}
			role={onActivate === undefined ? 'img' : 'button'}
			aria-label={label}
			tabIndex={onActivate === undefined ? -1 : 0}
			onClick={onActivate}
			onKeyDown={(event) => {
				if (
					onActivate !== undefined &&
					(event.key === 'Enter' || event.key === ' ')
				) {
					event.preventDefault();
					onActivate();
				}
			}}
			data-server-desktop-mirror="true"
		/>
	);
}

/**
 * Whether an element takes up room on screen. A tab's own visibility events
 * can lag or be missed when tabs are added, moved, or reordered; its size
 * cannot, and a place with no size must never be the one the desktop fits.
 */
function useHasSize(): [(element: HTMLDivElement | null) => void, boolean] {
	const [hasSize, setHasSize] = useState(false);
	const observer = useRef<ResizeObserver | undefined>(undefined);
	const ref = useCallback((element: HTMLDivElement | null) => {
		observer.current?.disconnect();
		observer.current = undefined;
		if (element === null) {
			setHasSize(false);
			return;
		}
		const measure = () => {
			const box = element.getBoundingClientRect();
			setHasSize(box.width > 0 && box.height > 0);
		};
		measure();
		if (typeof ResizeObserver === 'undefined') return;
		observer.current = new ResizeObserver(measure);
		observer.current.observe(element);
	}, []);
	return [ref, hasSize];
}

/** Register a place with the hub for as long as it is mounted. */
function useSurface(
	hub: ServerDesktopHubValue | null,
	kind: 'tab' | 'dropdown',
	visible: boolean,
) {
	const id = useId();
	const register = hub?.register;
	const update = hub?.update;
	// A ref callback runs before effects, so before the place is registered:
	// keep the element and hand it over once registration exists.
	const element = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const unregister = register?.(id, kind);
		if (element.current !== null) update?.(id, { slot: element.current });
		return unregister;
	}, [register, update, id, kind]);
	useEffect(() => update?.(id, { visible }), [update, id, visible]);
	const slot = useCallback(
		(next: HTMLDivElement | null) => {
			element.current = next;
			update?.(id, { slot: next });
		},
		[update, id],
	);
	return { id, slot };
}

/** The menu of a desktop toolbar, open or not. */
function useMenu() {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const element = root.current;
		const items = () =>
			Array.from(
				element?.querySelectorAll<HTMLElement>(
					'[data-server-desktop-menu] [role="menuitem"]:not(:disabled)',
				) ?? [],
			);
		items()[0]?.focus();
		const onPointer = (event: PointerEvent) => {
			const anchor = element?.querySelector('.server-desktop__menu-anchor');
			if (!anchor?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			const list = items();
			const at = list.indexOf(document.activeElement as HTMLElement);
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				setOpen(false);
				element
					?.querySelector<HTMLElement>('[data-server-desktop-menu-button]')
					?.focus();
			} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const step = event.key === 'ArrowDown' ? 1 : -1;
				list[(at + step + list.length) % list.length]?.focus();
			} else if (event.key === 'Tab') setOpen(false);
		};
		window.addEventListener('pointerdown', onPointer, true);
		element?.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerdown', onPointer, true);
			element?.removeEventListener('keydown', onKey);
		};
	}, [open]);
	return { open, setOpen, root };
}

function barProps(
	hub: ServerDesktopHubValue,
	menu: ReturnType<typeof useMenu>,
) {
	const display = hub.status?.state === 'ready' ? hub.status.display : 0;
	return {
		mode: hub.mode,
		controller: hub.controller,
		display,
		state: hub.viewer,
		busy: hub.busy,
		sharing: hub.sharing as ServerDesktopSharing,
		menuOpen: menu.open,
		onToggleMenu: () => menu.setOpen((was) => !was),
		...(hub.notice === undefined ? {} : { notice: hub.notice }),
		...(hub.confirmingTurnOff === undefined
			? {}
			: { confirmingTurnOff: hub.confirmingTurnOff }),
		onTakeControl: hub.takeControl,
		onReleaseControl: hub.releaseControl,
		onReconnect: () => {
			menu.setOpen(false);
			hub.reconnect();
		},
		onTurnOff: () => {
			menu.setOpen(false);
			hub.turnOff(false);
		},
		onConfirmTurnOff: () => hub.turnOff(true),
		onCancelTurnOff: hub.cancelTurnOff,
	};
}

/** What a place shows while the desktop is not running. */
function NotRunning({ hub }: Readonly<{ hub: ServerDesktopHubValue }>) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const clear = setTimeout(() => setCopied(false), 2_000);
		return () => clearTimeout(clear);
	}, [copied]);
	const { status } = hub;
	if (status === undefined)
		return (
			<div
				className="server-desktop__state"
				data-server-desktop-state="loading"
			>
				{hub.error === undefined ? (
					<p className="server-desktop__faint">Asking the server…</p>
				) : (
					<p className="server-desktop__reason" role="alert">
						{hub.error}
					</p>
				)}
			</div>
		);
	if (status.state === 'ready') return null;
	return (
		<ServerDesktopStateView
			status={status}
			busy={hub.busy}
			copied={copied}
			{...(hub.error === undefined ? {} : { error: hub.error })}
			actions={{
				onSetup: hub.setup,
				onCheckAgain: hub.checkAgain,
				onTurnOn: hub.turnOn,
				onCopyCommand: (command) => {
					void writeClipboardText(command).then(
						() => setCopied(true),
						() => undefined,
					);
				},
			}}
		/>
	);
}

/**
 * The desktop as a tab: the toolbar, then the desktop edge to edge. The tab
 * that was focused last holds the live viewer; another shows a copy, and
 * holds the viewer as soon as it is pressed.
 */
export function ServerDesktopTabView({
	tabId,
	serverId,
	location,
	isVisible,
	isActive,
	closeHere,
	setTitle,
	onBack,
}: Readonly<{
	tabId: string;
	/** The server the tab was opened for. */
	serverId: string;
	location: DesktopTabLocation;
	isVisible: boolean;
	/** The tab is the active one of its group. */
	isActive: boolean;
	/** Close this tab where it is. */
	closeHere: () => void;
	/** Name the tab, where its host lets it. */
	setTitle?: (title: string) => void;
	/**
	 * Close the tab from inside it. Given where no tab strip is drawn and
	 * nothing else lists the tab: Home at phone width.
	 */
	onBack?: () => void;
}>) {
	const hub = useServerDesktopHub();
	const label = hub?.serverId === serverId ? hub.serverLabel : undefined;
	useEffect(() => {
		if (label !== undefined) setTitle?.(serverDesktopTitle(label));
	}, [label, setTitle]);
	const places = useContext(ServerDesktopPlacesContext);
	const sameServer = hub !== null && hub.serverId === serverId;
	const [frame, frameHasSize] = useHasSize();
	const onScreen = isVisible && frameHasSize;
	const { id, slot } = useSurface(sameServer ? hub : null, 'tab', onScreen);
	const menu = useMenu();
	const focus = hub?.focus;
	// Becoming the active tab on screen makes this the place in use.
	useEffect(() => {
		if (sameServer && onScreen && isActive) focus?.(id);
	}, [sameServer, onScreen, isActive, focus, id]);

	// Drawn above every state: the tab's menu exists only once the desktop is
	// running, and a tab opened during setup must still close.
	const back =
		onBack === undefined ? null : (
			<div className="server-desktop__back-bar">
				<button
					type="button"
					className="server-desktop__back"
					onClick={onBack}
					aria-label="Close desktop tab"
					data-server-desktop-back="true"
				>
					<ChevronLeft size={15} aria-hidden="true" />
					Back
				</button>
				<span className="server-desktop__back-title">
					{label === undefined ? 'Desktop' : serverDesktopTitle(label)}
				</span>
			</div>
		);

	if (!sameServer || hub === null) {
		const elsewhere = (
			<div
				className="server-desktop__state"
				data-server-desktop-state="elsewhere"
			>
				<div className="server-desktop__card">
					<h3>This desktop is on another server</h3>
					<p>
						Switch this window to that server to see its desktop, or close the
						tab.
					</p>
				</div>
			</div>
		);
		return back === null ? (
			elsewhere
		) : (
			<div className="server-desktop server-desktop--tab">
				{back}
				{elsewhere}
			</div>
		);
	}
	if (hub.status?.state !== 'ready')
		return (
			<div
				className="server-desktop server-desktop--tab"
				data-server-desktop-tab={tabId}
			>
				{back}
				<NotRunning hub={hub} />
			</div>
		);
	const holdsViewer = hub.primaryId === id;
	const targets = places?.targets(location) ?? [];
	return (
		<div
			ref={menu.root}
			className="server-desktop server-desktop--tab"
			data-server-desktop-state="ready"
			data-server-desktop-viewer={hub.viewer}
			data-server-desktop-tab={tabId}
			data-server-desktop-live={holdsViewer ? 'true' : 'false'}
		>
			{back}
			<ServerDesktopBar
				{...barProps(hub, menu)}
				moveTargets={targets}
				onMove={(target) => {
					menu.setOpen(false);
					places?.move(tabId, location, target, closeHere);
				}}
			/>
			<div ref={frame} className="server-desktop__frame">
				<div
					ref={slot}
					className="server-desktop__slot"
					hidden={!holdsViewer}
				/>
				{holdsViewer ? null : (
					<ServerDesktopMirror
						hub={hub}
						label="Desktop. Press to use it here."
						onActivate={() => hub.focus(id)}
					/>
				)}
				<ServerDesktopOverlay
					state={hub.viewer}
					{...(hub.failure === undefined ? {} : { failure: hub.failure })}
					onReconnect={hub.reconnect}
				/>
			</div>
		</div>
	);
}

/**
 * The header's dropdown: a live thumbnail of the desktop and what to do with
 * it, or setup while it is not running.
 */
export function ServerDesktopDropdown({
	onOpenTab,
	onDismiss,
}: Readonly<{
	onOpenTab: () => void;
	/** Close it: a press outside it and its button, or Escape. */
	onDismiss: () => void;
}>) {
	const hub = useServerDesktopHub();
	useSurface(hub, 'dropdown', true);
	const menu = useMenu();
	const dismiss = useRef(onDismiss);
	dismiss.current = onDismiss;
	useEffect(() => {
		// The dropdown sits inside its button's wrapper: a press there is ours.
		const anchor = menu.root.current?.parentElement;
		const onPointer = (event: PointerEvent) => {
			if (!anchor?.contains(event.target as Node)) dismiss.current();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || event.defaultPrevented) return;
			dismiss.current();
			anchor
				?.querySelector<HTMLElement>('[data-server-desktop-button]')
				?.focus();
		};
		window.addEventListener('pointerdown', onPointer, true);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerdown', onPointer, true);
			window.removeEventListener('keydown', onKey);
		};
	}, [menu.root]);
	if (hub === null) return null;
	const ready = hub.status?.state === 'ready';
	return (
		<div
			ref={menu.root}
			className="server-desktop server-desktop-dropdown"
			role="dialog"
			aria-label={`Desktop of ${hub.serverLabel}`}
			data-server-desktop-dropdown="true"
			{...(ready
				? {
						'data-server-desktop-state': 'ready',
						'data-server-desktop-viewer': hub.viewer,
					}
				: {})}
		>
			<div className="server-desktop-dropdown__head">
				<span className="server-desktop-dropdown__title">
					{serverDesktopTitle(hub.serverLabel)}
				</span>
				{ready ? (
					<span className="server-desktop-dropdown__mode">
						<MousePointer2 size={12} aria-hidden="true" />
						{hub.viewer === 'open' || hub.viewer === 'connecting'
							? controlLine(hub.mode, hub.controller)
							: hub.viewer === 'closed'
								? 'Disconnected.'
								: 'The desktop could not open.'}
					</span>
				) : null}
			</div>
			{ready ? (
				<>
					<div className="server-desktop-dropdown__preview">
						<ServerDesktopMirror
							hub={hub}
							label="Open the desktop in a tab"
							onActivate={onOpenTab}
						/>
						<ServerDesktopOverlay
							state={hub.viewer}
							{...(hub.failure === undefined ? {} : { failure: hub.failure })}
							onReconnect={hub.reconnect}
						/>
					</div>
					<ServerDesktopBar
						{...barProps(hub, menu)}
						compact
						leading={
							<button
								type="button"
								className="server-desktop__accent"
								onClick={onOpenTab}
								data-server-desktop-action="open-tab"
							>
								<ExternalLink size={13} aria-hidden="true" /> Open in tab
							</button>
						}
					/>
				</>
			) : (
				<NotRunning hub={hub} />
			)}
		</div>
	);
}
