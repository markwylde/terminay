import {
	RecordingsClient,
	SettingsClient,
	ShellProfilesClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useState } from 'react';
import 'dockview/dist/styles/dockview.css';
import '@xterm/xterm/css/xterm.css';
import '../index.css';
import { MacrosWindow } from '../components/MacrosWindow';
import { RecordingsWindow } from '../components/RecordingsWindow';
import { SettingsWindow } from '../components/SettingsWindow';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';
import {
	LegacyMacroSettingsProvider,
} from '../hooks/useMacroSettings';
import {
	createServerTerminalSettingsClient,
	TerminalSettingsClientProvider,
} from '../hooks/useTerminalSettings';
import { ConnectedRendererWorkspace } from '../shared/ConnectedRendererWorkspace';
import {
	createAuxiliaryRouteController,
	type AuxiliaryRouteRequest,
	type AuxiliaryRouteRequestHandler,
} from '../shared/auxiliaryRoutes';
import {
	SharedConnectionsRouteBody,
	type SharedConnectionsRouteBodyProps,
} from '../shared/SharedConnectionsRouteBody';
import {
	SharedEditTabRouteBody,
	type SharedEditTabResult,
} from '../shared/SharedEditTabRouteBody';
import type { RemoteAccessStatusClient } from '../services/remoteAccessStatusClient';
import { defaultTerminalSettings } from '../terminalSettings';
import type { RemoteAccessStatus } from '../types/terminay';
import {
	createBrowserMacroSettingsCapability,
	createBrowserTerminalSettingsClient,
} from './browserRendererHostAdapters';
import './connectedRendererWorkspace.css';

export type ConnectedWebRendererWorkspaceProps = Readonly<{
	terminalClientContext: Omit<TerminalPanelClientContextValue, 'projectId'>;
	connectionRoute: Omit<SharedConnectionsRouteBodyProps, 'state'>;
	onBack: () => void;
}>;

type BrowserAuxiliaryRoute = 'settings' | 'macros' | 'recordings';

type BrowserMenuId = 'file' | 'edit' | 'view' | 'help';

type BrowserMenuItem = Readonly<{
	id: string;
	label: string;
	onSelect: () => void;
}>;

const menuOrder: readonly BrowserMenuId[] = ['file', 'edit', 'view', 'help'];

const menuLabels: Readonly<Record<BrowserMenuId, string>> = Object.freeze({
	edit: 'Edit',
	file: 'File',
	help: 'Help',
	view: 'View',
});

/** Browser composition for the real connected renderer feature tree.
 * Native Desktop capabilities are omitted rather than emulated on `window`. */
export function ConnectedWebRendererWorkspace({
	connectionRoute,
	onBack,
	terminalClientContext,
}: ConnectedWebRendererWorkspaceProps) {
	const [isConnectionManagerOpen, setIsConnectionManagerOpen] = useState(false);
	const [auxiliaryRoute, setAuxiliaryRoute] =
		useState<AuxiliaryRouteRequest | null>(null);
	const pendingEditResolveRef = useRef<
		((result: SharedEditTabResult | null) => void) | null
	>(null);
	const auxiliaryFocusReturnRef = useRef<HTMLElement | null>(null);
	const settingsClient = useMemo(createBrowserTerminalSettingsClient, []);
	const applicationClient = terminalClientContext.applicationClient;
	const macroCapability = useMemo(
		() => {
			if (applicationClient === undefined) {
				throw new Error(
					'Connected browser workspace requires its canonical application client',
				);
			}
			return createBrowserMacroSettingsCapability(applicationClient);
		},
		[applicationClient],
	);
	const recordingsClient = useMemo(
		() => {
			if (applicationClient === undefined) {
				throw new Error(
					'Connected browser workspace requires its canonical application client',
				);
			}
			return new RecordingsClient(new TerminayClientFacade(applicationClient));
		},
		[applicationClient],
	);
	const serverSettingsClient = useMemo(
		() => {
			if (applicationClient === undefined) {
				throw new Error(
					'Connected browser workspace requires its canonical application client',
				);
			}
			return createServerTerminalSettingsClient(
				new SettingsClient(new TerminayClientFacade(applicationClient)),
				settingsClient,
			);
		},
		[applicationClient, settingsClient],
	);
	const shellProfilesClient = useMemo(() => {
		if (applicationClient === undefined) throw new Error('Connected browser workspace requires its canonical application client');
		return new ShellProfilesClient(new TerminayClientFacade(applicationClient));
	}, [applicationClient]);
	const remoteAccessStatusClient = useMemo(
		createUnavailableRemoteAccessClient,
		[],
	);
	const handleAuxiliaryRouteRequest = useCallback<AuxiliaryRouteRequestHandler>(
		async (request) => {
			pendingEditResolveRef.current?.(null);
			pendingEditResolveRef.current = null;
			auxiliaryFocusReturnRef.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			setAuxiliaryRoute(request);
			if (request.kind !== 'edit-tab') return undefined;
			return new Promise((resolve) => {
				pendingEditResolveRef.current = resolve;
			});
		},
		[],
	);
	const auxiliaryRoutes = useMemo(
		() =>
			createAuxiliaryRouteController({
				getWindow: () => undefined,
				onRequest: handleAuxiliaryRouteRequest,
			}),
		[handleAuxiliaryRouteRequest],
	);
	const restoreAuxiliaryFocus = useCallback(() => {
		const target = auxiliaryFocusReturnRef.current;
		auxiliaryFocusReturnRef.current = null;
		window.requestAnimationFrame(() => {
			if (target?.isConnected) target.focus();
		});
	}, []);
	const requestBrowserAuxiliaryRoute = useCallback(
		(route: BrowserAuxiliaryRoute) => {
			switch (route) {
				case 'settings':
					void auxiliaryRoutes.openSettings();
					break;
				case 'macros':
					void auxiliaryRoutes.openMacros();
					break;
				case 'recordings':
					void auxiliaryRoutes.openRecordings();
					break;
			}
		},
		[auxiliaryRoutes],
	);
	const cancelAuxiliaryRoute = useCallback(() => {
		pendingEditResolveRef.current?.(null);
		pendingEditResolveRef.current = null;
		setAuxiliaryRoute(null);
		restoreAuxiliaryFocus();
	}, [restoreAuxiliaryFocus]);
	const submitEditTabRoute = useCallback(
		async (result: SharedEditTabResult) => {
			pendingEditResolveRef.current?.(result);
			pendingEditResolveRef.current = null;
			setAuxiliaryRoute(null);
			restoreAuxiliaryFocus();
		},
		[restoreAuxiliaryFocus],
	);

	return (
		<div className="connected-web-renderer-workspace">
			<TerminalSettingsClientProvider client={settingsClient}>
				<LegacyMacroSettingsProvider capability={macroCapability}>
					<ConnectedBrowserMenuBar
						onBack={onBack}
						onOpenAuxiliaryRoute={requestBrowserAuxiliaryRoute}
						onOpenConnectionManager={() => setIsConnectionManagerOpen(true)}
					/>
					<ConnectedRendererWorkspace
						host={Object.freeze({
							auxiliaryRoutes,
							onDisconnect: onBack,
							onOpenConnectionManager: () =>
								setIsConnectionManagerOpen(true),
						})}
						terminalClientContext={terminalClientContext}
					/>
				</LegacyMacroSettingsProvider>
			</TerminalSettingsClientProvider>
			{auxiliaryRoute === null ? null : (
				<ConnectedBrowserAuxiliaryDialog
					route={auxiliaryRoute}
					onClose={cancelAuxiliaryRoute}
				>
					{auxiliaryRoute.kind === 'edit-tab' ? (
						<SharedEditTabRouteBody
							state={auxiliaryRoute.state}
							onCancel={cancelAuxiliaryRoute}
							onSubmit={submitEditTabRoute}
						/>
					) : (
						<TerminalSettingsClientProvider client={settingsClient}>
							<LegacyMacroSettingsProvider capability={macroCapability}>
								{auxiliaryRoute.kind === 'settings' ? (
									<SettingsWindow
										initialSectionId={auxiliaryRoute.sectionId}
										remoteAccessStatusClient={remoteAccessStatusClient}
										settingsClient={serverSettingsClient}
										shellProfilesClient={shellProfilesClient}
										serverIdentity={terminalClientContext.connectionLabel ?? terminalClientContext.serverId}
									/>
								) : auxiliaryRoute.kind === 'macros' ? (
									<MacrosWindow macroSettingsClient={macroCapability} />
								) : (
									<RecordingsWindow client={recordingsClient} />
								)}
							</LegacyMacroSettingsProvider>
						</TerminalSettingsClientProvider>
					)}
				</ConnectedBrowserAuxiliaryDialog>
			)}
			{isConnectionManagerOpen ? (
				<div
					className="connected-web-connection-backdrop"
					role="presentation"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget)
							setIsConnectionManagerOpen(false);
					}}
				>
					<section
						aria-label="Browser connections"
						aria-modal="true"
						className="connected-web-connection-dialog"
						role="dialog"
					>
						<header>
							<h2>Connections</h2>
							<button
								type="button"
								onClick={() => setIsConnectionManagerOpen(false)}
							>
								Close
							</button>
						</header>
						<SharedConnectionsRouteBody state="ready" {...connectionRoute} />
					</section>
				</div>
			) : null}
		</div>
	);
}

function ConnectedBrowserMenuBar({
	onBack,
	onOpenAuxiliaryRoute,
	onOpenConnectionManager,
}: Readonly<{
	onBack: () => void;
	onOpenAuxiliaryRoute: (route: BrowserAuxiliaryRoute) => void;
	onOpenConnectionManager: () => void;
}>) {
	const [openMenu, setOpenMenu] = useState<BrowserMenuId | null>(null);
	const menuButtonRefs = useRef(new Map<BrowserMenuId, HTMLButtonElement>());
	const itemRefs = useRef(new Map<string, HTMLButtonElement>());
	const isMac = useMemo(() => navigator.userAgent.includes('Mac'), []);

	const dispatchShortcut = useCallback((key: string, options: KeyboardEventInit = {}) => {
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				bubbles: true,
				cancelable: true,
				ctrlKey: !isMac,
				key,
				metaKey: isMac,
				...options,
			}),
		);
	}, [isMac]);

	const menuItems = useMemo<Readonly<Record<BrowserMenuId, readonly BrowserMenuItem[]>>>(
		() => ({
			edit: [
				{ id: 'undo', label: 'Undo', onSelect: () => document.execCommand('undo') },
				{ id: 'redo', label: 'Redo', onSelect: () => document.execCommand('redo') },
				{ id: 'cut', label: 'Cut', onSelect: () => document.execCommand('cut') },
				{ id: 'copy', label: 'Copy', onSelect: () => document.execCommand('copy') },
				{ id: 'paste', label: 'Paste', onSelect: () => document.execCommand('paste') },
				{ id: 'select-all', label: 'Select All', onSelect: () => document.execCommand('selectAll') },
			],
			file: [
					{ id: 'new-terminal', label: 'New Terminal', onSelect: () => dispatchShortcut('t') },
					{ id: 'new-project', label: 'New Project', onSelect: () => dispatchShortcut('p') },
					{ id: 'save', label: 'Save', onSelect: () => dispatchShortcut('s') },
				{ id: 'settings', label: 'Settings', onSelect: () => onOpenAuxiliaryRoute('settings') },
				{ id: 'macros', label: 'Macros', onSelect: () => onOpenAuxiliaryRoute('macros') },
				{ id: 'recordings', label: 'Recordings', onSelect: () => onOpenAuxiliaryRoute('recordings') },
				{ id: 'connections', label: 'Connections', onSelect: onOpenConnectionManager },
					{ id: 'close-terminal', label: 'Close Terminal', onSelect: () => dispatchShortcut('w') },
				{ id: 'disconnect', label: 'Disconnect', onSelect: onBack },
			],
			help: [
				{
					id: 'documentation',
					label: 'Documentation',
					onSelect: () => window.open('https://github.com', '_blank', 'noopener,noreferrer'),
				},
				{ id: 'about', label: 'About Terminay', onSelect: () => onOpenAuxiliaryRoute('settings') },
			],
			view: [
					{ id: 'set-project-root', label: 'Set Project Root to Working Directory', onSelect: () => dispatchShortcut('r') },
					{ id: 'toggle-file-explorer', label: 'Toggle File Explorer Sidebar', onSelect: () => dispatchShortcut('o') },
			],
		}),
		[dispatchShortcut, onBack, onOpenAuxiliaryRoute, onOpenConnectionManager],
	);

	const focusMenuButton = useCallback((menuId: BrowserMenuId) => {
		menuButtonRefs.current.get(menuId)?.focus();
	}, []);

	const focusFirstMenuItem = useCallback((menuId: BrowserMenuId) => {
		const first = menuItems[menuId][0];
		if (first) itemRefs.current.get(`${menuId}:${first.id}`)?.focus();
	}, [menuItems]);

	const moveMenuFocus = useCallback((current: BrowserMenuId, delta: number) => {
		const index = menuOrder.indexOf(current);
		const next = menuOrder[(index + delta + menuOrder.length) % menuOrder.length];
		setOpenMenu(next);
		focusMenuButton(next);
		return next;
	}, [focusMenuButton]);

	const activateItem = useCallback((menuId: BrowserMenuId, item: BrowserMenuItem) => {
		setOpenMenu(null);
		menuButtonRefs.current.get(menuId)?.focus();
		item.onSelect();
	}, []);

	const onMenuButtonKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, menuId: BrowserMenuId) => {
		switch (event.key) {
			case 'ArrowDown':
			case 'Enter':
			case ' ':
				event.preventDefault();
				setOpenMenu(menuId);
				window.requestAnimationFrame(() => focusFirstMenuItem(menuId));
				break;
			case 'ArrowLeft':
				event.preventDefault();
				moveMenuFocus(menuId, -1);
				break;
			case 'ArrowRight':
				event.preventDefault();
				moveMenuFocus(menuId, 1);
				break;
			case 'Home':
				event.preventDefault();
				focusMenuButton(menuOrder[0]);
				break;
			case 'End':
				event.preventDefault();
				focusMenuButton(menuOrder[menuOrder.length - 1]);
				break;
			case 'Escape':
				setOpenMenu(null);
				break;
			default:
				break;
		}
	}, [focusFirstMenuItem, focusMenuButton, moveMenuFocus]);

	const onMenuItemKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, menuId: BrowserMenuId, itemIndex: number) => {
		const items = menuItems[menuId];
		const focusItem = (index: number) => {
			const next = items[index];
			if (next) itemRefs.current.get(`${menuId}:${next.id}`)?.focus();
		};
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				focusItem((itemIndex + 1) % items.length);
				break;
			case 'ArrowUp':
				event.preventDefault();
				focusItem((itemIndex - 1 + items.length) % items.length);
				break;
			case 'ArrowLeft':
				event.preventDefault();
				window.requestAnimationFrame(() => focusFirstMenuItem(moveMenuFocus(menuId, -1)));
				break;
			case 'ArrowRight':
				event.preventDefault();
				window.requestAnimationFrame(() => focusFirstMenuItem(moveMenuFocus(menuId, 1)));
				break;
			case 'Home':
				event.preventDefault();
				focusItem(0);
				break;
			case 'End':
				event.preventDefault();
				focusItem(items.length - 1);
				break;
			case 'Escape':
				event.preventDefault();
				setOpenMenu(null);
				menuButtonRefs.current.get(menuId)?.focus();
				break;
			default:
				break;
		}
	}, [focusFirstMenuItem, menuItems, moveMenuFocus]);

	useEffect(() => {
		if (openMenu === null) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest('.connected-web-menubar')) return;
			setOpenMenu(null);
		};
		window.addEventListener('pointerdown', onPointerDown);
		return () => window.removeEventListener('pointerdown', onPointerDown);
	}, [openMenu]);

	return (
		<nav className="connected-web-menubar" aria-label="Application menu">
			<div className="connected-web-menubar__menus" role="menubar">
				{menuOrder.map((menuId) => (
					<div className="connected-web-menu" key={menuId}>
						<button
							ref={(node) => {
								if (node) menuButtonRefs.current.set(menuId, node);
								else menuButtonRefs.current.delete(menuId);
							}}
							type="button"
							className="connected-web-menu__button"
							role="menuitem"
							aria-haspopup="menu"
							aria-expanded={openMenu === menuId}
							onClick={() => setOpenMenu((current) => current === menuId ? null : menuId)}
							onKeyDown={(event) => onMenuButtonKeyDown(event, menuId)}
						>
							{menuLabels[menuId]}
						</button>
						{openMenu === menuId ? (
							<div className="connected-web-menu__popup" role="menu" aria-label={menuLabels[menuId]}>
								{menuItems[menuId].map((item, index) => (
									<button
										ref={(node) => {
											const key = `${menuId}:${item.id}`;
											if (node) itemRefs.current.set(key, node);
											else itemRefs.current.delete(key);
										}}
										key={item.id}
										type="button"
										className="connected-web-menu__item"
										role="menuitem"
										onClick={() => activateItem(menuId, item)}
										onKeyDown={(event) => onMenuItemKeyDown(event, menuId, index)}
									>
										{item.label}
									</button>
								))}
							</div>
						) : null}
					</div>
				))}
			</div>
		</nav>
	);
}

function ConnectedBrowserAuxiliaryDialog({
	children,
	onClose,
	route,
}: Readonly<{
	children: ReactNode;
	onClose: () => void;
	route: AuxiliaryRouteRequest;
}>) {
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const title = getAuxiliaryRouteTitle(route);

	useEffect(() => {
		closeButtonRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onClose]);

	return (
		<div
			className="connected-web-auxiliary-backdrop"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<section
				aria-label={title}
				aria-modal="true"
				className={`connected-web-auxiliary-dialog connected-web-auxiliary-dialog--${route.kind}`}
				data-connected-web-auxiliary-route={route.kind}
				role="dialog"
			>
				<header className="connected-web-auxiliary-dialog__header">
					<h2>{title}</h2>
					<button ref={closeButtonRef} type="button" onClick={onClose}>
						Close
					</button>
				</header>
				<div className="connected-web-auxiliary-dialog__body">{children}</div>
			</section>
		</div>
	);
}

function getAuxiliaryRouteTitle(route: AuxiliaryRouteRequest): string {
	switch (route.kind) {
		case 'settings':
			return route.sectionId === undefined
				? 'Settings'
				: `Settings: ${route.sectionId}`;
		case 'macros':
			return 'Macros';
		case 'recordings':
			return 'Recordings';
		case 'edit-tab':
			return route.state.kind === 'project'
				? 'Edit Project Tab'
				: 'Edit Terminal Tab';
	}
}

function createUnavailableRemoteAccessClient(): RemoteAccessStatusClient {
	const status: RemoteAccessStatus = {
		activeConnectionCount: 0,
		pendingWebRtcConnectionCount: 0,
		auditEvents: [],
		connections: [],
		availableAddresses: [],
		configurationIssue: 'Remote Access is managed by Terminay Desktop.',
		configurationPath: '',
		errorMessage: 'Remote Access is unavailable in the browser host.',
		isRunning: false,
		lanPairingExpiresAt: null,
		lanPairingQrCodeDataUrl: null,
		lanPairingQrCodePath: null,
		lanPairingUrl: null,
		origin: null,
		pairedDeviceCount: 0,
		pairedDevices: [],
		pairingMode: defaultTerminalSettings.remoteAccess.pairingMode,
		pairingExpiresAt: null,
		pairingQrCodeDataUrl: null,
		pairingQrCodePath: null,
		pairingUrl: null,
		webRtcPairingExpiresAt: null,
		webRtcPairingQrCodeDataUrl: null,
		webRtcPairingUrl: null,
		webRtcRoomId: null,
		webRtcStatus: 'not-configured',
		webRtcStatusMessage: 'Remote Access is unavailable in the browser host.',
	};
	const getStatus = async () => status;
	return Object.freeze({
		closeConnection: getStatus,
		getStatus,
		revokeDevice: getStatus,
		setPairingAddress: getStatus,
		subscribe: () => () => undefined,
		toggleServer: getStatus,
	});
}
