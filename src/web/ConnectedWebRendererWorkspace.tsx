import {
	RecordingsClient,
	SettingsClient,
	ShellProfilesClient,
	TerminayAiClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import type { TerminayHostContext } from '@terminay/protocol';
import type { AppCommand } from '../types/terminay';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'dockview/dist/styles/dockview.css';
import '@xterm/xterm/css/xterm.css';
import '../index.css';
import { MacrosWindow } from '../components/MacrosWindow';
import { RecordingsWindow } from '../components/RecordingsWindow';
import { SettingsWindow } from '../components/SettingsWindow';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';
import {
	createServerTerminalSettingsClient,
	TerminalSettingsClientProvider,
} from '../hooks/useTerminalSettings';
import { ProjectEnvironmentsWindow } from '../projectEnvironments/ProjectEnvironmentSurfaces';
import type { RemoteAccessStatusClient } from '../services/remoteAccessStatusClient';
import {
	type AuxiliaryRouteRequest,
	type AuxiliaryRouteRequestHandler,
	createAuxiliaryRouteController,
} from '../shared/auxiliaryRoutes';
import { ConnectedRendererWorkspace } from '../shared/ConnectedRendererWorkspace';
import {
	SharedConnectionsRouteBody,
	type SharedConnectionsRouteBodyProps,
} from '../shared/SharedConnectionsRouteBody';
import {
	type SharedEditTabResult,
	SharedEditTabRouteBody,
} from '../shared/SharedEditTabRouteBody';
import { defaultTerminalSettings } from '../terminalSettings';
import type { RemoteAccessStatus } from '../types/terminay';
import {
	createBrowserMacroSettingsClient,
	createBrowserTerminalSettingsClient,
} from './browserRendererHostAdapters';
import './connectedRendererWorkspace.css';

export type ConnectedWebRendererWorkspaceProps = Readonly<{
	terminalClientContext: Omit<TerminalPanelClientContextValue, 'projectId'>;
	connectionRoute: Omit<SharedConnectionsRouteBodyProps, 'state'>;
	onBack: () => void;
	hostContext?: TerminayHostContext;
	subscribeAppCommands?: (
		listener: (command: AppCommand) => Promise<void> | void,
	) => () => void;
}>;

type BrowserAuxiliaryRoute = 'settings' | 'macros' | 'recordings';

function initialAuxiliaryRoute(): AuxiliaryRouteRequest | null {
	const params = new URLSearchParams(window.location.search);
	switch (params.get('auxiliary')) {
		case 'settings': {
			const sectionId = params.get('section');
			return {
				kind: 'settings',
				...(sectionId === null ? {} : { sectionId }),
			};
		}
		case 'macros':
			return { kind: 'macros' };
		case 'recordings':
			return { kind: 'recordings' };
		case 'project-environments': {
			const providerId = params.get('provider');
			const mode = params.get('mode');
			const profileId = params.get('profile');
			return {
				kind: 'project-environments',
				...(providerId !== null &&
				(mode === 'profile' || mode === 'environment')
					? {
							intent: {
								providerId,
								mode,
								...(profileId === null ? {} : { profileId }),
							},
						}
					: {}),
			};
		}
		default:
			return null;
	}
}

function nativeAuxiliaryRoute(request: AuxiliaryRouteRequest): string | null {
	const params = new URLSearchParams();
	switch (request.kind) {
		case 'settings':
			params.set('auxiliary', 'settings');
			if (request.sectionId !== undefined)
				params.set('section', request.sectionId);
			break;
		case 'macros':
		case 'recordings':
			params.set('auxiliary', request.kind);
			break;
		case 'project-environments':
			params.set('auxiliary', 'project-environments');
			if (request.intent !== undefined) {
				params.set('provider', request.intent.providerId);
				params.set('mode', request.intent.mode);
				if (request.intent.profileId !== undefined)
					params.set('profile', request.intent.profileId);
			}
			break;
		case 'edit-tab':
			return null;
	}
	return `/?${params.toString()}`;
}

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
	hostContext,
	subscribeAppCommands,
	onBack,
	terminalClientContext,
}: ConnectedWebRendererWorkspaceProps) {
	const hasNativeMenus = hostContext?.capabilities.nativeMenus !== undefined;
	const hasNativeWindowControls =
		hostContext?.capabilities.nativeWindows !== undefined;
	const [isConnectionManagerOpen, setIsConnectionManagerOpen] = useState(false);
	const nativeAuxiliaryDocument = useMemo(initialAuxiliaryRoute, []);
	const [auxiliaryRoute, setAuxiliaryRoute] =
		useState<AuxiliaryRouteRequest | null>(nativeAuxiliaryDocument);
	const pendingEditResolveRef = useRef<
		((result: SharedEditTabResult | null) => void) | null
	>(null);
	const auxiliaryFocusReturnRef = useRef<HTMLElement | null>(null);
	const settingsClient = useMemo(createBrowserTerminalSettingsClient, []);
	const applicationClient = terminalClientContext.applicationClient;
	const macroSettingsClient = useMemo(() => {
		if (applicationClient === undefined) {
			throw new Error(
				'Connected browser workspace requires its canonical application client',
			);
		}
		return createBrowserMacroSettingsClient(applicationClient);
	}, [applicationClient]);
	const recordingsClient = useMemo(() => {
		if (applicationClient === undefined) {
			throw new Error(
				'Connected browser workspace requires its canonical application client',
			);
		}
		return new RecordingsClient(new TerminayClientFacade(applicationClient));
	}, [applicationClient]);
	const aiMetadataClient = useMemo(() => {
		if (applicationClient === undefined) {
			throw new Error(
				'Connected browser workspace requires its canonical application client',
			);
		}
		const client = new TerminayAiClient(
			new TerminayClientFacade(applicationClient),
		);
		return Object.freeze({
			async listModels(provider: 'codex' | 'claudeCode') {
				return client.listModels(
					provider === 'claudeCode' ? 'claude-code' : provider,
				);
			},
		});
	}, [applicationClient]);
	const serverSettingsClient = useMemo(() => {
		if (applicationClient === undefined) {
			throw new Error(
				'Connected browser workspace requires its canonical application client',
			);
		}
		return createServerTerminalSettingsClient(
			new SettingsClient(new TerminayClientFacade(applicationClient)),
		);
	}, [applicationClient]);
	const shellProfilesClient = useMemo(() => {
		if (applicationClient === undefined)
			throw new Error(
				'Connected browser workspace requires its canonical application client',
			);
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
				onRequest: async (request) => {
					const route = nativeAuxiliaryRoute(request);
					if (
						hasNativeWindowControls &&
						route !== null &&
						hostContext !== undefined &&
						window.terminayHost !== undefined
					) {
						await window.terminayHost.requestAction({
							bridgeVersion: hostContext.hostBridgeVersion,
							profileId: hostContext.profileId,
							schemaVersion: hostContext.schemaVersion,
							serverId: hostContext.serverId,
							sourceId: hostContext.sourceId,
							userGesture: true,
							windowId: hostContext.windowId,
							action: {
								disposition: 'native-window',
								logicalViewId: request.kind,
								route,
								type: 'route.present',
							},
						});
						return undefined;
					}
					return handleAuxiliaryRouteRequest(request);
				},
			}),
		[handleAuxiliaryRouteRequest, hasNativeWindowControls, hostContext],
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
	const auxiliaryContent = (route: AuxiliaryRouteRequest) =>
		route.kind === 'edit-tab' ? (
			<SharedEditTabRouteBody
				state={route.state}
				onCancel={cancelAuxiliaryRoute}
				onSubmit={submitEditTabRoute}
			/>
		) : route.kind === 'project-environments' ? (
			<ProjectEnvironmentsWindow
				applicationClient={terminalClientContext.applicationClient}
				initialIntent={route.intent}
				serverName={
					terminalClientContext.connectionLabel ??
					terminalClientContext.serverId
				}
			/>
		) : (
			<TerminalSettingsClientProvider client={settingsClient}>
			<>
					{route.kind === 'settings' ? (
						<SettingsWindow
							applicationClient={applicationClient}
							aiTabMetadataClient={aiMetadataClient}
							initialSectionId={route.sectionId}
							remoteAccessStatusClient={remoteAccessStatusClient}
							settingsClient={serverSettingsClient}
							shellProfilesClient={shellProfilesClient}
							serverIdentity={
								terminalClientContext.connectionLabel ??
								terminalClientContext.serverId
							}
						/>
					) : route.kind === 'macros' ? (
						<MacrosWindow macroSettingsClient={macroSettingsClient} />
					) : (
						<RecordingsWindow client={recordingsClient} />
					)}
			</>
			</TerminalSettingsClientProvider>
		);

	if (nativeAuxiliaryDocument !== null) {
		return (
			<main
				className="connected-web-native-auxiliary"
				data-connected-native-auxiliary-route={nativeAuxiliaryDocument.kind}
			>
				{auxiliaryContent(nativeAuxiliaryDocument)}
			</main>
		);
	}

	return (
		<div className="connected-web-renderer-workspace">
			<TerminalSettingsClientProvider client={settingsClient}>
				<>
					{hasNativeMenus ? null : (
						<ConnectedBrowserMenuBar
							onBack={onBack}
							onOpenAuxiliaryRoute={requestBrowserAuxiliaryRoute}
							onOpenConnectionManager={() => setIsConnectionManagerOpen(true)}
						/>
					)}
					<ConnectedRendererWorkspace
						host={Object.freeze({
							auxiliaryRoutes,
							onDisconnect: onBack,
							onOpenConnectionManager: () => setIsConnectionManagerOpen(true),
							presentation: Object.freeze({
								nativeMenus: hasNativeMenus,
								nativeWindowControls: hasNativeWindowControls,
							}),
							subscribeAppCommands,
						})}
						terminalClientContext={terminalClientContext}
					/>
				</>
			</TerminalSettingsClientProvider>
			{auxiliaryRoute === null ? null : (
				<ConnectedBrowserAuxiliaryDialog
					route={auxiliaryRoute}
					onClose={cancelAuxiliaryRoute}
				>
					{auxiliaryContent(auxiliaryRoute)}
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

	const dispatchShortcut = useCallback(
		(key: string, options: KeyboardEventInit = {}) => {
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
		},
		[isMac],
	);

	const menuItems = useMemo<
		Readonly<Record<BrowserMenuId, readonly BrowserMenuItem[]>>
	>(
		() => ({
			edit: [
				{
					id: 'undo',
					label: 'Undo',
					onSelect: () => document.execCommand('undo'),
				},
				{
					id: 'redo',
					label: 'Redo',
					onSelect: () => document.execCommand('redo'),
				},
				{
					id: 'cut',
					label: 'Cut',
					onSelect: () => document.execCommand('cut'),
				},
				{
					id: 'copy',
					label: 'Copy',
					onSelect: () => document.execCommand('copy'),
				},
				{
					id: 'paste',
					label: 'Paste',
					onSelect: () => document.execCommand('paste'),
				},
				{
					id: 'select-all',
					label: 'Select All',
					onSelect: () => document.execCommand('selectAll'),
				},
			],
			file: [
				{
					id: 'new-terminal',
					label: 'New Terminal',
					onSelect: () => dispatchShortcut('t'),
				},
				{
					id: 'new-project',
					label: 'New Project',
					onSelect: () => dispatchShortcut('p'),
				},
				{
					id: 'project-environments',
					label: 'Project Environments…',
					onSelect: () =>
						window.dispatchEvent(
							new Event('terminay-open-project-environments'),
						),
				},
				{
					id: 'extensions',
					label: 'Extensions…',
					onSelect: () =>
						window.dispatchEvent(new Event('terminay-open-extensions')),
				},
				{ id: 'save', label: 'Save', onSelect: () => dispatchShortcut('s') },
				{
					id: 'settings',
					label: 'Settings',
					onSelect: () => onOpenAuxiliaryRoute('settings'),
				},
				{
					id: 'macros',
					label: 'Macros',
					onSelect: () => onOpenAuxiliaryRoute('macros'),
				},
				{
					id: 'recordings',
					label: 'Recordings',
					onSelect: () => onOpenAuxiliaryRoute('recordings'),
				},
				{
					id: 'connections',
					label: 'Connections',
					onSelect: onOpenConnectionManager,
				},
				{
					id: 'close-terminal',
					label: 'Close Terminal',
					onSelect: () => dispatchShortcut('w'),
				},
				{ id: 'disconnect', label: 'Disconnect', onSelect: onBack },
			],
			help: [
				{
					id: 'documentation',
					label: 'Documentation',
					onSelect: () =>
						window.open('https://github.com', '_blank', 'noopener,noreferrer'),
				},
				{
					id: 'about',
					label: 'About Terminay',
					onSelect: () => onOpenAuxiliaryRoute('settings'),
				},
			],
			view: [
				{
					id: 'set-project-root',
					label: 'Set Project Root to Working Directory',
					onSelect: () => dispatchShortcut('r'),
				},
				{
					id: 'toggle-file-explorer',
					label: 'Toggle File Explorer Sidebar',
					onSelect: () => dispatchShortcut('o'),
				},
			],
		}),
		[dispatchShortcut, onBack, onOpenAuxiliaryRoute, onOpenConnectionManager],
	);

	const focusMenuButton = useCallback((menuId: BrowserMenuId) => {
		menuButtonRefs.current.get(menuId)?.focus();
	}, []);

	const focusFirstMenuItem = useCallback(
		(menuId: BrowserMenuId) => {
			const first = menuItems[menuId][0];
			if (first) itemRefs.current.get(`${menuId}:${first.id}`)?.focus();
		},
		[menuItems],
	);

	const moveMenuFocus = useCallback(
		(current: BrowserMenuId, delta: number) => {
			const index = menuOrder.indexOf(current);
			const next =
				menuOrder[(index + delta + menuOrder.length) % menuOrder.length];
			setOpenMenu(next);
			focusMenuButton(next);
			return next;
		},
		[focusMenuButton],
	);

	const activateItem = useCallback(
		(menuId: BrowserMenuId, item: BrowserMenuItem) => {
			setOpenMenu(null);
			menuButtonRefs.current.get(menuId)?.focus();
			item.onSelect();
		},
		[],
	);

	const onMenuButtonKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>, menuId: BrowserMenuId) => {
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
		},
		[focusFirstMenuItem, focusMenuButton, moveMenuFocus],
	);

	const onMenuItemKeyDown = useCallback(
		(
			event: ReactKeyboardEvent<HTMLButtonElement>,
			menuId: BrowserMenuId,
			itemIndex: number,
		) => {
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
					window.requestAnimationFrame(() =>
						focusFirstMenuItem(moveMenuFocus(menuId, -1)),
					);
					break;
				case 'ArrowRight':
					event.preventDefault();
					window.requestAnimationFrame(() =>
						focusFirstMenuItem(moveMenuFocus(menuId, 1)),
					);
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
		},
		[focusFirstMenuItem, menuItems, moveMenuFocus],
	);

	useEffect(() => {
		if (openMenu === null) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest('.connected-web-menubar'))
				return;
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
							onClick={() =>
								setOpenMenu((current) => (current === menuId ? null : menuId))
							}
							onKeyDown={(event) => onMenuButtonKeyDown(event, menuId)}
						>
							{menuLabels[menuId]}
						</button>
						{openMenu === menuId ? (
							<div
								className="connected-web-menu__popup"
								role="menu"
								aria-label={menuLabels[menuId]}
							>
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
										onKeyDown={(event) =>
											onMenuItemKeyDown(event, menuId, index)
										}
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
		case 'project-environments':
			return 'Project Environments';
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
		toggleDirectListener: getStatus,
	});
}
