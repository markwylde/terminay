import type {
	ShellProfilesClient,
	TerminayClient,
} from '@terminay/client-core';
import {
	ConnectedServersClient,
	TerminayAiClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import type { ReactNode } from 'react';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	type TerminalSettingsClient,
	useTerminalSettings,
} from '../hooks/useTerminalSettings';
import { setDesktopPerformanceLogging } from '../host/nativeActions';
import { subscribeDesktopPerformanceLogging } from '../host/nativeEvents';
import {
	acceleratorFromKeyboardEvent,
	defaultKeyboardShortcuts,
	getCommandShortcutLabel,
	normalizeAccelerator,
} from '../keyboardShortcuts';
import { type AiTabMetadataClient } from '../services/ai/aiTabMetadataClient';
import type { RemoteAccessStatusClient } from '../services/remoteAccessStatusClient';
import { SettingsMutationCoordinator } from '../settingsMutationCoordinator';
import {
	type MacroSettingsClient,
	MacroSettingsUnavailableError,
} from '../hooks/useMacroSettings';
import {
	type ConnectionsSettingsPresentation,
	REMOTE_ACCESS_EXPOSURE_ID,
} from '../shared/SharedConnectionsRouteBody';
import { useConnections } from '../shared/connections/ConnectionsContext';
import { useSettingsLeaveGuard } from '../shared/settingsLeaveGuard';
import { SharedSettingsRouteBody } from '../shared/SharedSettingsRouteBody';
import { useMacroEditor } from './macros/useMacroEditor';
import { MacrosCategory, type SettingsCategoryParts } from './settings/MacrosCategory';
import { groupSettingsCategories } from './settings/settingsCategoryGroups';
import {
	type CollectionSelection,
	rememberSelection,
} from './settings/settingsSelection';
import type { SettingsFieldDefinition } from '../terminalSettings';
import {
	buildTabThemeHueValue,
	buildTerminalOptions,
	defaultTerminalSettings,
	getTabThemeHueBrightness,
	getTerminalThemeColorFallback,
	isTabThemeHueValue,
	TAB_THEME_HUE_COLOR_VALUE,
	terminalSettingsCategories,
	terminalSettingsSections,
} from '../terminalSettings';
import type {
	FileViewerDefaultMode,
	TerminalSettings,
} from '../types/settings';
import type {
	AppCommand,
	DictationMicrophonePermissionStatus,
	ParakeetRuntimeStatus,
	RemoteAccessStatus,
} from '../types/terminay';

function toParakeetRuntimeStatus(status: {
	readonly state: ParakeetRuntimeStatus['state'];
	readonly model: string;
	readonly message?: string;
	readonly progress?: number;
}): ParakeetRuntimeStatus {
	return {
		state: status.state,
		model: 'mlx-community/parakeet-tdt-0.6b-v3',
		...(status.message === undefined ? {} : { message: status.message }),
		...(status.progress === undefined ? {} : { progress: status.progress }),
	};
}

import '../settings.css';
import { ExtensionSettingsSection } from './ExtensionSettingsSection';
import { ConnectedMcpServersSettings } from './ConnectedMcpServersSettings';
import { ShellProfilesSettings } from './ShellProfilesSettings';
import {
	attachTerminalWebglRenderer,
	createTerminalWebglAddonOptions,
} from './terminalWebglRenderer';

type CategoryId =
	| (typeof terminalSettingsCategories)[number]['id']
	| 'extensions'
	| 'diagnostics'
	| 'macros';

const macrosSettingsCategory = Object.freeze({
	id: 'macros' as const,
	label: 'Macros',
});

const extensionSettingsCategory = Object.freeze({
	id: 'extensions' as const,
	label: 'Extensions',
});

const diagnosticsSettingsCategory = Object.freeze({
	id: 'diagnostics' as const,
	label: 'Diagnostics',
});

/** Stands in when the selected server has no macro client: Macros is then not offered. */
const unavailableMacroSettingsClient: MacroSettingsClient = Object.freeze({
	getMacroLibrary: () => Promise.reject(new MacroSettingsUnavailableError()),
	saveMacroLibrary: () => Promise.reject(new MacroSettingsUnavailableError()),
	resetMacros: () => Promise.reject(new MacroSettingsUnavailableError()),
	onMacrosChanged: () => () => {},
});

const DIAGNOSTICS_SEARCH_TERMS =
	'diagnostics performance logging cpu energy trace stack sample startup timing memory disk slow';

type AiModelOption = { id: string; label: string };
type MicrophoneDeviceOption = { deviceId: string; label: string };

function getValueAtPath(
	settings: TerminalSettings,
	key: string,
): boolean | number | string {
	const segments = key.split('.');
	let current: unknown = settings;

	for (const segment of segments) {
		if (
			typeof current !== 'object' ||
			current === null ||
			!(segment in current)
		) {
			return '';
		}

		current = (current as Record<string, unknown>)[segment];
	}

	return typeof current === 'boolean' ||
		typeof current === 'number' ||
		typeof current === 'string'
		? current
		: '';
}

function getDefaultValueAtPath(key: string): boolean | number | string {
	return getValueAtPath(defaultTerminalSettings, key);
}

function setValueAtPath(
	settings: TerminalSettings,
	key: string,
	value: boolean | number | string,
): TerminalSettings {
	const segments = key.split('.');
	const allowedRoots = new Set([
		'agentIntegration',
		'activityIndicators',
		'aiTabMetadata',
		'dictation',
		'fileViewer',
		'gitPushAgent',
		'keyboardShortcuts',
		'pixel',
		'recording',
		'remoteAccess',
		'shell',
		'sidebar',
		'terminayMcp',
		'theme',
	]);
	const [root] = segments;

	if (!root || (segments.length > 1 && !allowedRoots.has(root))) {
		return settings;
	}

	const setNestedValue = (
		current: unknown,
		remainingSegments: string[],
	): unknown => {
		const [segment, ...rest] = remainingSegments;
		if (!segment) {
			return value;
		}

		if (rest.length === 0) {
			return {
				...(typeof current === 'object' && current !== null ? current : {}),
				[segment]: value,
			};
		}

		const currentObject =
			typeof current === 'object' && current !== null
				? (current as Record<string, unknown>)
				: {};
		return {
			...currentObject,
			[segment]: setNestedValue(currentObject[segment], rest),
		};
	};

	return setNestedValue(settings, segments) as TerminalSettings;
}

function normalizeCustomExtension(value: string): string {
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) {
		return '';
	}

	return `.${trimmed.replace(/^\.+/, '')}`;
}


function TerminalPreview({ settings }: { settings: TerminalSettings }) {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const root = containerRef.current;
		if (!root) {
			return;
		}

		root.innerHTML = '';

		const terminal = new Terminal({
			...buildTerminalOptions(settings),
			cols: 72,
			rows: 18,
			allowProposedApi: true,
		});
		const fitAddon = new FitAddon();
		const unicode11Addon = new Unicode11Addon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(unicode11Addon);
		terminal.unicode.activeVersion = '11';
		terminal.open(root);
		const webglRenderer = attachTerminalWebglRenderer(
			terminal,
			() =>
				new WebglAddon(createTerminalWebglAddonOptions(settings.customGlyphs)),
		);
		fitAddon.fit();

		terminal.writeln('\x1b[1;36mTerminay Settings Preview\x1b[0m');
		terminal.writeln('\x1b[90mPreview updates in real-time.\x1b[0m');
		terminal.writeln('');
		terminal.writeln(`$ echo "Font: ${settings.fontFamily}"`);
		terminal.writeln(`Font: ${settings.fontFamily}`);
		terminal.writeln('');
		terminal.writeln(
			'\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m \x1b[33myellow\x1b[0m \x1b[34mblue\x1b[0m \x1b[35mmagenta\x1b[0m \x1b[36mcyan\x1b[0m',
		);
		terminal.write('$ ');

		const resizeObserver = new ResizeObserver(() => {
			fitAddon.fit();
		});
		resizeObserver.observe(root);

		return () => {
			resizeObserver.disconnect();
			webglRenderer.dispose();
			terminal.dispose();
		};
	}, [settings]);

	return <div className="settings-preview-terminal" ref={containerRef} />;
}

function Switch({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (val: boolean) => void;
	label: string;
}) {
	return (
		<label className="settings-switch" aria-label={label}>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<span className="settings-slider"></span>
		</label>
	);
}

function CustomFileExtensionRow({
	defaultMode,
	extension,
	index,
	onRemove,
	onUpdate,
}: {
	defaultMode: FileViewerDefaultMode;
	extension: string;
	index: number;
	onRemove: (index: number) => void;
	onUpdate: (
		index: number,
		patch: { defaultMode?: FileViewerDefaultMode; extension?: string },
	) => void;
}) {
	const [extensionDraft, setExtensionDraft] = useState(extension);

	useEffect(() => {
		setExtensionDraft(extension);
	}, [extension]);

	const saveExtension = () => {
		onUpdate(index, { extension: extensionDraft });
	};

	return (
		<div className="settings-custom-extensions__item">
			<input
				className="settings-input-text settings-custom-extensions__extension"
				type="text"
				value={extensionDraft}
				placeholder=".log"
				aria-label="File extension"
				onBlur={saveExtension}
				onChange={(event) => setExtensionDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Enter') {
						event.currentTarget.blur();
					}
				}}
			/>
			<select
				className="settings-select settings-custom-extensions__mode"
				value={defaultMode}
				aria-label="Default file viewer tab"
				onChange={(event) =>
					onUpdate(index, {
						defaultMode: event.target.value as FileViewerDefaultMode,
					})
				}
			>
				<option value="preview">Preview</option>
				<option value="text">Text</option>
				<option value="hex">HEX</option>
			</select>
			<button
				type="button"
				className="settings-danger-button settings-danger-button--quiet"
				onClick={() => onRemove(index)}
			>
				Remove
			</button>
		</div>
	);
}

function renderCategoryIcon(title: string, children: ReactNode) {
	return (
		<svg
			width={16}
			height={16}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
		>
			<title>{title}</title>
			{children}
		</svg>
	);
}

function getCategoryIcon(id: CategoryId) {
	switch (id) {
		case 'macros':
			return renderCategoryIcon(
				'Macros',
				<>
					<rect x="3" y="5" width="18" height="14" rx="2" />
					<path d="m7 10 2.5 2L7 14" />
					<path d="M12 14h5" />
				</>,
			);
		case 'remote':
			return renderCategoryIcon(
				'Remote Access',
				<>
					<path d="M5 12a7 7 0 0 1 14 0" />
					<path d="M8.5 12a3.5 3.5 0 0 1 7 0" />
					<circle cx="12" cy="16" r="1.4" />
					<path d="M12 17.5v2.5" />
				</>,
			);
		case 'recording':
			return renderCategoryIcon(
				'Recording',
				<>
					<circle cx="12" cy="12" r="7" />
					<circle cx="12" cy="12" r="2.5" fill="currentColor" />
					<path d="M5 19l14-14" />
				</>,
			);
		case 'ai':
			return renderCategoryIcon(
				'AI',
				<>
					<path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 16l-1.7-5L6 9.3l4.3-1.7z" />
					<path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
					<path d="M5 14l.7 1.6L7 16l-1.3.4L5 18l-.7-1.6L3 16l1.3-.4z" />
				</>,
			);
		case 'shell':
			return renderCategoryIcon(
				'Shell',
				<>
					<path d="M4 7h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
					<path d="M4 7l3-3h10l3 3" />
					<path d="m9 12 2 2-2 2" />
					<line x1="13.5" y1="16" x2="16.5" y2="16" />
				</>,
			);
		case 'files':
			return renderCategoryIcon(
				'Files',
				<>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<path d="M14 2v6h6" />
					<path d="M8 13h8M8 17h5" />
				</>,
			);
		case 'appearance':
			return renderCategoryIcon(
				'Appearance',
				<>
					<circle cx="12" cy="12" r="5" />
					<path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
				</>,
			);
		case 'cursor':
			return renderCategoryIcon(
				'Cursor',
				<path d="m4 4 7.07 17 2.51-7.39L21 11.07z" />,
			);
		case 'interaction':
			return renderCategoryIcon(
				'Interaction',
				<>
					<rect x="2" y="4" width="20" height="16" rx="2" />
					<path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
				</>,
			);
		case 'keyboard':
			return renderCategoryIcon(
				'Shortcuts',
				<>
					<rect x="3" y="5" width="18" height="14" rx="2" />
					<path d="M7 9h.01M11 9h.01M15 9h.01M17 13h.01M13 13H7" />
				</>,
			);
		case 'scrolling':
			return renderCategoryIcon(
				'Scrolling',
				<>
					<line x1="12" y1="5" x2="12" y2="19" />
					<polyline points="19 12 12 19 5 12" />
				</>,
			);
		case 'accessibility':
			return renderCategoryIcon(
				'Accessibility',
				<>
					<circle cx="12" cy="12" r="10" />
					<circle cx="12" cy="10" r="3" />
					<path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
				</>,
			);
		case 'updates':
			return renderCategoryIcon(
				'Updates',
				<>
					<path d="M21 12a9 9 0 1 1-2.64-6.36" />
					<polyline points="21 3 21 9 15 9" />
				</>,
			);
		case 'theme':
			return renderCategoryIcon(
				'Theme',
				<>
					<circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
					<circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
					<circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
					<circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
					<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
				</>,
			);
		case 'diagnostics':
			return renderCategoryIcon(
				'Diagnostics',
				<>
					<circle cx="12" cy="12" r="9" />
					<path d="M12 8v4l2.5 2.5" />
				</>,
			);
		default:
			return renderCategoryIcon('Category', <circle cx="12" cy="12" r="10" />);
	}
}

export function SettingsWindow({
	applicationClient,
	aiTabMetadataClient: aiTabMetadataClientOverride,
	initialSectionId,
	remoteAccessStatusClient,
	settingsClient: settingsClientOverride,
	shellProfilesClient,
	serverIdentity = 'Connected server',
	renderServerSelector,
	macroSettingsClient,
	renderRemoteAccess,
	initialItemId,
}: Readonly<{
	applicationClient?: TerminayClient;
	aiTabMetadataClient?: AiTabMetadataClient;
	initialSectionId?: string;
	remoteAccessStatusClient: RemoteAccessStatusClient;
	settingsClient?: TerminalSettingsClient;
	shellProfilesClient?: ShellProfilesClient;
	serverIdentity?: string;
	/** Draws the server selector above the search field; it calls `beforeSelect` first. */
	renderServerSelector?: (beforeSelect: () => Promise<boolean>) => ReactNode;
	/** The selected server's macros; absent when its connection is unavailable. */
	macroSettingsClient?: MacroSettingsClient;
	/** Draws the Remote Access category; absent where the host cannot manage it. */
	renderRemoteAccess?: (settings: ConnectionsSettingsPresentation) => ReactNode;
	/** The item to select in the initial collection category. */
	initialItemId?: string;
}>) {
	const serverAiClient = useMemo(
		() =>
			applicationClient === undefined
				? undefined
				: new TerminayAiClient(new TerminayClientFacade(applicationClient)),
		[applicationClient],
	);
	const connectedServersClient = useMemo(
		() =>
			applicationClient === undefined
				? undefined
				: new ConnectedServersClient(new TerminayClientFacade(applicationClient)),
		[applicationClient],
	);
	const aiTabMetadataClient = useMemo(() => {
		if (aiTabMetadataClientOverride !== undefined) {
			return aiTabMetadataClientOverride;
		}
		if (serverAiClient !== undefined) {
			return Object.freeze({
				listModels(provider: 'claudeCode' | 'codex') {
					return serverAiClient.listModels(
						provider === 'claudeCode' ? 'claude-code' : provider,
					);
				},
			}) satisfies AiTabMetadataClient;
		}
		return Object.freeze({
			async listModels() {
				return [];
			},
		}) satisfies AiTabMetadataClient;
	}, [aiTabMetadataClientOverride, serverAiClient]);
	const searchParams = new URLSearchParams(window.location.search);
	const initialSectionFromUrl = initialSectionId ?? searchParams.get('section');
	const initialItemFromUrl = initialItemId ?? searchParams.get('item');
	const initialCategoryFromUrl: CategoryId =
		initialSectionFromUrl === 'extensions' ||
		initialSectionFromUrl === 'diagnostics' ||
		initialSectionFromUrl === 'macros' ||
		initialSectionFromUrl === 'remote'
			? initialSectionFromUrl
			: (terminalSettingsSections.find(
						(section) => section.id === initialSectionFromUrl,
					)?.categoryId ?? 'appearance');
	const {
		settings: persistedSettings,
		isLoading,
		settingsClient,
	} = useTerminalSettings(settingsClientOverride);
	const [draft, setDraft] = useState<TerminalSettings>(defaultTerminalSettings);
	const draftRef = useRef<TerminalSettings>(defaultTerminalSettings);
	const mutationCoordinatorRef = useRef(
		new SettingsMutationCoordinator<TerminalSettings>(),
	);
	const [activeCategoryId, setActiveCategoryId] = useState<CategoryId>(
		initialCategoryFromUrl,
	);
	const [activeSectionId, setActiveSectionId] = useState<string>(
		() =>
			initialSectionFromUrl ??
			terminalSettingsSections.find(
				(section) => section.categoryId === initialCategoryFromUrl,
			)?.id ??
			terminalSettingsSections[0]?.id ??
			'',
	);
	const [query, setQuery] = useState('');
	const [collectionSelection, setCollectionSelection] =
		useState<CollectionSelection>(() =>
			initialItemFromUrl === null || initialItemFromUrl === undefined
				? {}
				: { [initialCategoryFromUrl]: initialItemFromUrl },
		);
	const selectCollectionItem = useCallback(
		(categoryId: CategoryId, itemId: string | undefined) =>
			setCollectionSelection((current) =>
				rememberSelection(current, categoryId, itemId),
			),
		[],
	);
	// The macro change set lives as long as Settings, not as long as the
	// Macros category is in view.
	const macroEditor = useMacroEditor(
		macroSettingsClient ?? unavailableMacroSettingsClient,
		activeCategoryId === 'macros',
	);
	// The editor holds the Macros selection itself. A macro named when Settings
	// opened is selected once the library has arrived.
	const pendingMacroId = useRef(
		initialCategoryFromUrl === 'macros' ? (initialItemFromUrl ?? undefined) : undefined,
	);
	const { selectMacro: selectEditorMacro, draft: macroDraft } = macroEditor;
	useEffect(() => {
		const pending = pendingMacroId.current;
		if (pending === undefined) return;
		if (!macroDraft.macros.some((macro) => macro.id === pending)) return;
		pendingMacroId.current = undefined;
		selectEditorMacro(pending);
	}, [macroDraft.macros, selectEditorMacro]);

	// Pending macro edits are confirmed before Settings closes or the server
	// selector moves: save them, discard them, or keep editing.
	const [leaveRequest, setLeaveRequest] = useState<{
		resolve: (proceed: boolean) => void;
	} | null>(null);
	const confirmLeave = useCallback((): Promise<boolean> => {
		if (!macroEditor.isDirty) return Promise.resolve(true);
		setActiveCategoryId('macros');
		setQuery('');
		return new Promise((resolve) => setLeaveRequest({ resolve }));
	}, [macroEditor.isDirty]);
	useSettingsLeaveGuard(confirmLeave);
	const settleLeave = async (choice: 'save' | 'discard' | 'keep') => {
		const request = leaveRequest;
		if (request === null) return;
		if (choice === 'save') {
			const saved = await macroEditor.save();
			setLeaveRequest(null);
			request.resolve(saved);
			return;
		}
		if (choice === 'discard') macroEditor.discard();
		setLeaveRequest(null);
		request.resolve(choice === 'discard');
	};
	// A native window cannot draw the prompt above; it asks the host instead.
	useEffect(() => {
		if (!macroEditor.isDirty) return undefined;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	}, [macroEditor.isDirty]);
	const [diagnosticsAvailable, setDiagnosticsAvailable] = useState(false);
	const [performanceLoggingEnabled, setPerformanceLoggingEnabled] =
		useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [showPreview, setShowPreview] = useState(true);
	const [previewHeight, setPreviewHeight] = useState(240);
	const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(
		null,
	);
	const [listeningShortcutKey, setListeningShortcutKey] = useState<
		string | null
	>(null);
	const [codexModels, setCodexModels] = useState<AiModelOption[]>([]);
	const [isLoadingCodexModels, setIsLoadingCodexModels] = useState(false);
	const [codexModelsError, setCodexModelsError] = useState<string | null>(null);
	const [claudeCodeModels, setClaudeCodeModels] = useState<AiModelOption[]>([]);
	const [isLoadingClaudeCodeModels, setIsLoadingClaudeCodeModels] =
		useState(false);
	const [claudeCodeModelsError, setClaudeCodeModelsError] = useState<
		string | null
	>(null);
	const [dictationOpenAiKeyConfigured, setDictationOpenAiKeyConfigured] =
		useState(false);
	const [dictationOpenAiKeyDraft, setDictationOpenAiKeyDraft] = useState('');
	const [dictationOpenAiKeyError, setDictationOpenAiKeyError] = useState<
		string | null
	>(null);
	const [isSavingDictationOpenAiKey, setIsSavingDictationOpenAiKey] =
		useState(false);
	const [parakeetStatus, setParakeetStatus] =
		useState<ParakeetRuntimeStatus | null>(null);
	const [isInstallingParakeet, setIsInstallingParakeet] = useState(false);
	const [dictationMicrophoneDevices, setDictationMicrophoneDevices] = useState<
		MicrophoneDeviceOption[]
	>([]);
	const [dictationMicrophoneError, setDictationMicrophoneError] = useState<
		string | null
	>(null);
	const [
		dictationMicrophonePermissionStatus,
		setDictationMicrophonePermissionStatus,
	] = useState<DictationMicrophonePermissionStatus>('unknown');
	const [isLoadingDictationMicrophones, setIsLoadingDictationMicrophones] =
		useState(false);

	const handleResizePointerDown = (e: React.PointerEvent) => {
		e.preventDefault();
		const startY = e.clientY;
		const startHeight = previewHeight;

		const onPointerMove = (moveEvent: PointerEvent) => {
			const delta = startY - moveEvent.clientY;
			setPreviewHeight(Math.max(100, Math.min(800, startHeight + delta)));
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	};

	const contentRef = useRef<HTMLDivElement>(null);

	const loadDictationMicrophones = useCallback(
		async (requestPermission = false) => {
			setIsLoadingDictationMicrophones(true);
			setDictationMicrophoneError(null);

			try {
				let permissionStatus: DictationMicrophonePermissionStatus = 'unknown';
				let permissionProbeError: string | null = null;

				if (requestPermission && navigator.mediaDevices?.getUserMedia) {
					let permissionProbeStream: MediaStream | null = null;
					try {
						permissionProbeStream = await navigator.mediaDevices.getUserMedia({
							audio: true,
						});
						permissionStatus = 'granted';
					} catch (error) {
						permissionProbeError =
							error instanceof Error ? error.message : String(error);
						permissionStatus = 'denied';
					} finally {
						permissionProbeStream?.getTracks().forEach((track) => {
							track.stop();
						});
					}
				}

				setDictationMicrophonePermissionStatus(permissionStatus);

				if (!navigator.mediaDevices?.enumerateDevices) {
					setDictationMicrophoneDevices([]);
					setDictationMicrophoneError(
						'Microphone device listing is not available in this browser.',
					);
					return;
				}

				const devices = await navigator.mediaDevices.enumerateDevices();
				const microphones = devices
					.filter((device) => device.kind === 'audioinput')
					.map((device, index) => ({
						deviceId: device.deviceId,
						label: device.label || `Microphone ${index + 1}`,
					}));

				setDictationMicrophoneDevices(microphones);
				if (microphones.length > 0) {
					setDictationMicrophoneError(null);
					if (
						permissionStatus !== 'granted' &&
						microphones.some((device) => device.label.length > 0)
					) {
						setDictationMicrophonePermissionStatus('granted');
					}
				} else if (permissionStatus !== 'granted') {
					setDictationMicrophoneError(
						permissionProbeError ??
							'Microphone access has not been granted yet.',
					);
				} else {
					setDictationMicrophoneError('No microphone devices were found.');
				}
			} catch (error) {
				setDictationMicrophoneDevices([]);
				setDictationMicrophoneError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				setIsLoadingDictationMicrophones(false);
			}
		},
		[],
	);

	useEffect(() => {
		const observed = mutationCoordinatorRef.current.observe(persistedSettings);
		if (observed === null) {
			return;
		}
		setDraft(observed);
		draftRef.current = observed;
	}, [persistedSettings]);

	useEffect(() => {
		draftRef.current = draft;
	}, [draft]);

	useEffect(() => {
		let isMounted = true;

		const credentialStatus = serverAiClient?.dictationCredentialStatus();
		void credentialStatus
			?.then((status) => {
				if (isMounted) {
					setDictationOpenAiKeyConfigured(status.configured);
				}
			})
			.catch((error) => {
				if (isMounted) {
					setDictationOpenAiKeyError(
						error instanceof Error ? error.message : String(error),
					);
				}
			});

		void serverAiClient
			?.dictationRuntimeStatus()
			?.then((status) => {
				if (isMounted) setParakeetStatus(toParakeetRuntimeStatus(status));
			})
			.catch((error) => {
				if (isMounted) {
					setParakeetStatus({
						model: 'mlx-community/parakeet-tdt-0.6b-v3',
						state: 'error',
						message: error instanceof Error ? error.message : String(error),
					});
				}
			});

		void loadDictationMicrophones();

		void remoteAccessStatusClient.getStatus().then((status) => {
			if (isMounted) {
				setRemoteStatus(status);
			}
		});

		const unsubscribe = remoteAccessStatusClient.subscribe((status) => {
			setRemoteStatus(status);
		});

		return () => {
			isMounted = false;
			unsubscribe?.();
		};
	}, [loadDictationMicrophones, serverAiClient]);

	useEffect(() => {
		const host = window.terminayHost;
		if (host === undefined) return undefined;
		let cancelled = false;
		void host
			.getContext()
			.then((context) => {
				if (!cancelled && context.hostKind === 'desktop')
					setDiagnosticsAvailable(true);
			})
			.catch(() => undefined);
		const stop = subscribeDesktopPerformanceLogging((enabled) => {
			setDiagnosticsAvailable(true);
			setPerformanceLoggingEnabled(enabled);
		});
		return () => {
			cancelled = true;
			stop();
		};
	}, []);

	const normalizedQuery = query.trim().toLowerCase();

	const filteredSections = useMemo(() => {
		return terminalSettingsSections.filter((section) => {
			const sectionMatches =
				section.title.toLowerCase().includes(normalizedQuery) ||
				section.description.toLowerCase().includes(normalizedQuery);

			const fieldMatches = section.fields.some((field) => {
				const keywords = field.keywords?.join(' ').toLowerCase() ?? '';
				return (
					field.label.toLowerCase().includes(normalizedQuery) ||
					field.description.toLowerCase().includes(normalizedQuery) ||
					field.key.toLowerCase().includes(normalizedQuery) ||
					keywords.includes(normalizedQuery)
				);
			});

			return !normalizedQuery || sectionMatches || fieldMatches;
		});
	}, [normalizedQuery]);

	const diagnosticsQueryMatches =
		normalizedQuery.length > 0 &&
		DIAGNOSTICS_SEARCH_TERMS.includes(normalizedQuery);
	const extensionsQueryMatches =
		'extensions trusted code npm project connection providers'.includes(
			normalizedQuery,
		);

	const macrosAvailable = macroSettingsClient !== undefined;
	const { profiles: savedServers } = useConnections();
	// Search reaches into collections: macro names, descriptions and script
	// text, and saved server names.
	const macroMatches = useMemo(() => {
		if (!normalizedQuery || !macrosAvailable) return [];
		return macroEditor.draft.macros.filter((macro) =>
			[
				macro.title,
				macro.description,
				...macro.steps.map((step) => (step.type === 'type' ? step.content : '')),
			]
				.join('\n')
				.toLowerCase()
				.includes(normalizedQuery),
		);
	}, [macroEditor.draft.macros, macrosAvailable, normalizedQuery]);
	const serverMatches = useMemo(
		() =>
			!normalizedQuery || renderRemoteAccess === undefined
				? []
				: savedServers.filter((profile) =>
						profile.label.toLowerCase().includes(normalizedQuery),
					),
		[normalizedQuery, renderRemoteAccess, savedServers],
	);
	const macrosQueryMatches =
		'macros automation snippets'.includes(normalizedQuery) ||
		macroMatches.length > 0;

	const visibleCategories = useMemo(() => {
		const extra = [
			...(macrosAvailable ? [macrosSettingsCategory] : []),
			...(diagnosticsAvailable ? [diagnosticsSettingsCategory] : []),
			extensionSettingsCategory,
		];
		if (!normalizedQuery) return [...terminalSettingsCategories, ...extra];
		const categoryIds = new Set(
			filteredSections.map((section) => section.categoryId),
		);
		const settingsCategories = terminalSettingsCategories.filter(
			(category) =>
				categoryIds.has(category.id) ||
				(category.id === 'remote' && serverMatches.length > 0),
		);
		return [
			...settingsCategories,
			...(macrosAvailable && macrosQueryMatches ? [macrosSettingsCategory] : []),
			...(diagnosticsAvailable && diagnosticsQueryMatches
				? [diagnosticsSettingsCategory]
				: []),
			...(extensionsQueryMatches ? [extensionSettingsCategory] : []),
		];
	}, [
		diagnosticsAvailable,
		diagnosticsQueryMatches,
		extensionsQueryMatches,
		filteredSections,
		macrosAvailable,
		macrosQueryMatches,
		normalizedQuery,
		serverMatches.length,
	]);

	const categoryGroups = useMemo(
		() =>
			groupSettingsCategories(
				visibleCategories.map((category) => ({
					id: category.id,
					label: category.label,
					icon: getCategoryIcon(category.id),
				})),
				{
					...(macrosAvailable && macroEditor.isReady
						? { macros: macroEditor.draft.macros.length }
						: {}),
					...(renderRemoteAccess === undefined
						? {}
						: { remote: savedServers.length }),
				},
			),
		[
			macroEditor.draft.macros.length,
			macroEditor.isReady,
			macrosAvailable,
			renderRemoteAccess,
			savedServers.length,
			visibleCategories,
		],
	);

	const displayedCategories = useMemo(() => {
		if (normalizedQuery) {
			return visibleCategories;
		}

		return visibleCategories.filter(
			(category) => category.id === activeCategoryId,
		);
	}, [activeCategoryId, normalizedQuery, visibleCategories]);

	useEffect(() => {
		if (activeCategoryId === 'extensions') {
			if (activeSectionId !== 'extensions') setActiveSectionId('extensions');
			return;
		}
		if (activeCategoryId === 'diagnostics') {
			if (activeSectionId !== 'diagnostics') setActiveSectionId('diagnostics');
			return;
		}
		const eligibleSections = normalizedQuery
			? filteredSections
			: filteredSections.filter(
					(section) => section.categoryId === activeCategoryId,
				);

		if (eligibleSections.some((section) => section.id === activeSectionId)) {
			return;
		}

		setActiveSectionId(eligibleSections[0]?.id ?? '');
	}, [activeCategoryId, activeSectionId, filteredSections, normalizedQuery]);

	useEffect(() => {
		const root = contentRef.current;
		if (!root) {
			return;
		}

		const visibleSectionIds = displayedCategories.flatMap((category) =>
			filteredSections
				.filter((section) => section.categoryId === category.id)
				.map((section) => section.id),
		);
		const sectionElements = visibleSectionIds
			.map((id) => document.getElementById(`section-${id}`))
			.filter(
				(element): element is HTMLElement => element instanceof HTMLElement,
			);

		if (sectionElements.length === 0) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				const visibleEntries = entries
					.filter((entry) => entry.isIntersecting)
					.sort((a, b) => {
						if (b.intersectionRatio !== a.intersectionRatio) {
							return b.intersectionRatio - a.intersectionRatio;
						}

						return a.boundingClientRect.top - b.boundingClientRect.top;
					});

				const nextEntry = visibleEntries[0];
				if (!nextEntry) {
					return;
				}

				const nextSectionId = nextEntry.target.id.replace(/^section-/, '');
				const nextCategoryId = terminalSettingsSections.find(
					(section) => section.id === nextSectionId,
				)?.categoryId;

				setActiveSectionId((current) =>
					current === nextSectionId ? current : nextSectionId,
				);
				if (nextCategoryId) {
					setActiveCategoryId((current) =>
						current === nextCategoryId ? current : nextCategoryId,
					);
				}
			},
			{
				root,
				rootMargin: '0px 0px -55% 0px',
				threshold: [0.1, 0.25, 0.5, 0.75, 1],
			},
		);

		sectionElements.forEach((element) => {
			observer.observe(element);
		});

		return () => {
			observer.disconnect();
		};
	}, [displayedCategories, filteredSections]);

	const runSettingsMutation = useCallback(
		async (
			operation: () => Promise<TerminalSettings>,
			optimisticDraft?: TerminalSettings,
		) => {
			if (optimisticDraft !== undefined) {
				draftRef.current = optimisticDraft;
				setDraft(optimisticDraft);
			}
			setSaveError(null);
			setIsSaving(true);

			const result = await mutationCoordinatorRef.current.run(operation, () =>
				settingsClient.get<TerminalSettings>(),
			);
			if (!result.current) {
				return;
			}
			if (result.snapshot !== null) {
				draftRef.current = result.snapshot;
				setDraft(result.snapshot);
			}
			if (result.error !== undefined) {
				setSaveError(
					result.error instanceof Error
						? result.error.message
						: 'Changes were not saved.',
				);
			}
			setIsSaving(false);
		},
		[settingsClient],
	);

	const saveDraft = useCallback(
		(nextDraft: TerminalSettings, optimistic = true) =>
			runSettingsMutation(
				() =>
					settingsClient.update<TerminalSettings>(
						nextDraft as unknown as import('@terminay/protocol').JsonValue,
					),
				optimistic ? nextDraft : undefined,
			),
		[runSettingsMutation, settingsClient],
	);

	const updateField = async (
		field: SettingsFieldDefinition,
		rawValue: boolean | number | string,
	) => {
		let nextDraft = setValueAtPath(draftRef.current, field.key, rawValue);
		if (field.key === 'dictation.provider') {
			nextDraft = setValueAtPath(
				nextDraft,
				'dictation.model',
				rawValue === 'parakeet'
					? 'mlx-community/parakeet-tdt-0.6b-v3'
					: 'gpt-4o-transcribe',
			);
		}
		await saveDraft(nextDraft);
	};

	const updateShortcut = useCallback(
		async (key: string, value: string) => {
			const normalizedValue =
				value.trim().length === 0 ? '' : normalizeAccelerator(value);
			const nextDraft = setValueAtPath(draftRef.current, key, normalizedValue);
			// A captured accelerator is presented as changed only after both the
			// selected-server mutation and the device-host projection commit. This
			// prevents closing an isolated Settings window from abandoning a save
			// that merely looked complete because its draft was optimistic.
			await saveDraft(nextDraft, false);
		},
		[saveDraft],
	);

	const updateCustomFileExtension = useCallback(
		async (
			index: number,
			patch: { defaultMode?: FileViewerDefaultMode; extension?: string },
		) => {
			const currentEntries = draftRef.current.fileViewer.customFileExtensions;
			const nextEntries = currentEntries
				.map((entry, entryIndex) => {
					if (entryIndex !== index) {
						return entry;
					}

					return {
						...entry,
						...patch,
						extension:
							patch.extension !== undefined
								? normalizeCustomExtension(patch.extension)
								: entry.extension,
					};
				})
				.filter((entry) => entry.extension.length > 1);

			await saveDraft({
				...draftRef.current,
				fileViewer: {
					...draftRef.current.fileViewer,
					customFileExtensions: nextEntries,
				},
			});
		},
		[saveDraft],
	);

	const addCustomFileExtension = useCallback(async () => {
		await saveDraft({
			...draftRef.current,
			fileViewer: {
				...draftRef.current.fileViewer,
				customFileExtensions: [
					...draftRef.current.fileViewer.customFileExtensions,
					{ defaultMode: 'text', extension: '.txt' },
				],
			},
		});
	}, [saveDraft]);

	const removeCustomFileExtension = useCallback(
		async (index: number) => {
			await saveDraft({
				...draftRef.current,
				fileViewer: {
					...draftRef.current.fileViewer,
					customFileExtensions:
						draftRef.current.fileViewer.customFileExtensions.filter(
							(_, entryIndex) => entryIndex !== index,
						),
				},
			});
		},
		[saveDraft],
	);

	const resetShortcut = (field: SettingsFieldDefinition) => {
		const command = field.key.replace('keyboardShortcuts.', '') as AppCommand;
		void updateShortcut(field.key, defaultKeyboardShortcuts[command] ?? '');
	};

	const resetAllShortcuts = async () => {
		const nextDraft: TerminalSettings = {
			...draftRef.current,
			keyboardShortcuts: defaultKeyboardShortcuts,
		};
		setListeningShortcutKey(null);
		await saveDraft(nextDraft);
	};

	const resetAll = async () => {
		if (!confirm('Are you sure you want to reset all settings to default?'))
			return;
		await runSettingsMutation(async () => {
			const saved = await settingsClient.reset<TerminalSettings>();
			setQuery('');
			return saved;
		});
	};

	const resetDiagnostics = async () => {
		if (!confirm('Turn off performance logging?')) return;
		const enabled = await setDesktopPerformanceLogging(false);
		if (enabled !== null) setPerformanceLoggingEnabled(enabled);
	};

	const togglePerformanceLogging = async (enabled: boolean) => {
		const next = await setDesktopPerformanceLogging(enabled);
		if (next !== null) setPerformanceLoggingEnabled(next);
	};

	const saveDictationOpenAiKey = async () => {
		setDictationOpenAiKeyError(null);
		setIsSavingDictationOpenAiKey(true);
		try {
			if (serverAiClient === undefined)
				throw new Error(
					'The selected server does not support dictation credentials.',
				);
			const status = await serverAiClient.setDictationCredential(
				dictationOpenAiKeyDraft,
			);
			setDictationOpenAiKeyConfigured(status.configured);
			setDictationOpenAiKeyDraft('');
		} catch (error) {
			setDictationOpenAiKeyError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setIsSavingDictationOpenAiKey(false);
		}
	};

	const clearDictationOpenAiKey = async () => {
		setDictationOpenAiKeyError(null);
		setIsSavingDictationOpenAiKey(true);
		try {
			if (serverAiClient === undefined)
				throw new Error(
					'The selected server does not support dictation credentials.',
				);
			const status = await serverAiClient.clearDictationCredential();
			setDictationOpenAiKeyConfigured(status.configured);
			setDictationOpenAiKeyDraft('');
		} catch (error) {
			setDictationOpenAiKeyError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setIsSavingDictationOpenAiKey(false);
		}
	};

	const installParakeet = async () => {
		setIsInstallingParakeet(true);
		setParakeetStatus({
			model: 'mlx-community/parakeet-tdt-0.6b-v3',
			state: 'installing',
			progress: 0,
			message: 'Starting on-device setup…',
		});
		let statusPoll: ReturnType<typeof setInterval> | undefined;
		try {
			if (serverAiClient === undefined)
				throw new Error('Dictation runtime management is unavailable.');
			statusPoll = setInterval(() => {
				void serverAiClient
					.dictationRuntimeStatus()
					.then((status) => setParakeetStatus(toParakeetRuntimeStatus(status)))
					.catch(() => {
						// The install request owns final error reporting.
					});
			}, 500);
			setParakeetStatus(
				toParakeetRuntimeStatus(await serverAiClient.installDictationRuntime()),
			);
		} catch (error) {
			setParakeetStatus({
				model: 'mlx-community/parakeet-tdt-0.6b-v3',
				state: 'error',
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			if (statusPoll !== undefined) clearInterval(statusPoll);
			setIsInstallingParakeet(false);
		}
	};

	const renderDictationMicrophoneControl = (
		field: SettingsFieldDefinition,
		value: boolean | number | string,
	) => {
		const selectedValue = String(value);
		const options = [
			{ deviceId: '', label: 'System default' },
			...dictationMicrophoneDevices,
		];
		const selectedDeviceStillAvailable =
			selectedValue.length === 0 ||
			options.some((option) => option.deviceId === selectedValue);

		return (
			<div className="settings-shortcut-editor">
				<div className="settings-shortcut-value">
					<select
						className="settings-select"
						value={selectedDeviceStillAvailable ? selectedValue : ''}
						disabled={
							isLoadingDictationMicrophones ||
							dictationMicrophonePermissionStatus !== 'granted'
						}
						onChange={(event) => void updateField(field, event.target.value)}
					>
						{options.map((device) => (
							<option
								key={device.deviceId || 'default'}
								value={device.deviceId}
							>
								{device.label}
							</option>
						))}
					</select>
					<span
						className={`settings-shortcut-chip${
							dictationMicrophonePermissionStatus === 'granted'
								? ''
								: ' settings-shortcut-chip--muted'
						}`}
					>
						{dictationMicrophonePermissionStatus}
					</span>
				</div>
				{!selectedDeviceStillAvailable ? (
					<span className="settings-shortcut-warning">
						The selected microphone is no longer available.
					</span>
				) : dictationMicrophoneError ? (
					<span className="settings-shortcut-warning">
						{dictationMicrophoneError}
					</span>
				) : null}
				<div className="settings-shortcut-actions">
					{dictationMicrophonePermissionStatus !== 'granted' ? (
						<button
							type="button"
							className="settings-secondary-button settings-secondary-button--small"
							disabled={isLoadingDictationMicrophones}
							onClick={() => void loadDictationMicrophones(true)}
						>
							Allow Access
						</button>
					) : null}
					<button
						type="button"
						className="settings-secondary-button settings-secondary-button--small"
						disabled={isLoadingDictationMicrophones}
						onClick={() => void loadDictationMicrophones(false)}
					>
						{isLoadingDictationMicrophones ? 'Refreshing' : 'Refresh'}
					</button>
				</div>
			</div>
		);
	};

	useEffect(() => {
		const shouldLoadCodexModels =
			draft.aiTabMetadata.title.provider === 'codex' ||
			draft.aiTabMetadata.note.provider === 'codex' ||
			draft.gitPushAgent.provider === 'codex';

		if (!shouldLoadCodexModels || codexModels.length > 0) {
			return;
		}

		let isCurrent = true;
		setIsLoadingCodexModels(true);
		setCodexModelsError(null);

		void aiTabMetadataClient
			.listModels('codex')
			.then((models) => {
				if (!isCurrent) {
					return;
				}

				setCodexModels([...models]);
			})
			.catch((error) => {
				if (!isCurrent) {
					return;
				}

				setCodexModelsError(
					error instanceof Error ? error.message : String(error),
				);
			})
			.finally(() => {
				if (isCurrent) {
					setIsLoadingCodexModels(false);
				}
			});

		return () => {
			isCurrent = false;
		};
	}, [
		codexModels.length,
		aiTabMetadataClient,
		draft.aiTabMetadata.note.provider,
		draft.aiTabMetadata.title.provider,
		draft.gitPushAgent.provider,
	]);

	useEffect(() => {
		const shouldLoadClaudeCodeModels =
			draft.aiTabMetadata.title.provider === 'claudeCode' ||
			draft.aiTabMetadata.note.provider === 'claudeCode' ||
			draft.gitPushAgent.provider === 'claudeCode';

		if (!shouldLoadClaudeCodeModels || claudeCodeModels.length > 0) {
			return;
		}

		let isCurrent = true;
		setIsLoadingClaudeCodeModels(true);
		setClaudeCodeModelsError(null);

		void aiTabMetadataClient
			.listModels('claudeCode')
			.then((models) => {
				if (!isCurrent) {
					return;
				}

				setClaudeCodeModels([...models]);
			})
			.catch((error) => {
				if (!isCurrent) {
					return;
				}

				setClaudeCodeModelsError(
					error instanceof Error ? error.message : String(error),
				);
			})
			.finally(() => {
				if (isCurrent) {
					setIsLoadingClaudeCodeModels(false);
				}
			});

		return () => {
			isCurrent = false;
		};
	}, [
		claudeCodeModels.length,
		aiTabMetadataClient,
		draft.aiTabMetadata.note.provider,
		draft.aiTabMetadata.title.provider,
		draft.gitPushAgent.provider,
	]);

	useEffect(() => {
		const firstModel = codexModels[0]?.id;
		if (!firstModel) {
			return;
		}

		const current = draftRef.current;
		let nextDraft = current;

		if (
			current.aiTabMetadata.title.provider === 'codex' &&
			current.aiTabMetadata.title.codexModel.length === 0
		) {
			nextDraft = setValueAtPath(
				nextDraft,
				'aiTabMetadata.title.codexModel',
				firstModel,
			);
		}

		if (
			current.aiTabMetadata.note.provider === 'codex' &&
			current.aiTabMetadata.note.codexModel.length === 0
		) {
			nextDraft = setValueAtPath(
				nextDraft,
				'aiTabMetadata.note.codexModel',
				firstModel,
			);
		}

		if (
			current.gitPushAgent.provider === 'codex' &&
			current.gitPushAgent.codexModel.length === 0
		) {
			nextDraft = setValueAtPath(
				nextDraft,
				'gitPushAgent.codexModel',
				firstModel,
			);
		}

		if (nextDraft !== current) {
			void saveDraft(nextDraft);
		}
	}, [codexModels, saveDraft]);

	useEffect(() => {
		const firstModel = claudeCodeModels[0]?.id;
		if (!firstModel) {
			return;
		}

		const current = draftRef.current;
		let nextDraft = current;

		if (
			current.aiTabMetadata.title.provider === 'claudeCode' &&
			current.aiTabMetadata.title.claudeCodeModel.length === 0
		) {
			nextDraft = setValueAtPath(
				nextDraft,
				'aiTabMetadata.title.claudeCodeModel',
				firstModel,
			);
		}

		if (
			current.aiTabMetadata.note.provider === 'claudeCode' &&
			current.aiTabMetadata.note.claudeCodeModel.length === 0
		) {
			nextDraft = setValueAtPath(
				nextDraft,
				'aiTabMetadata.note.claudeCodeModel',
				firstModel,
			);
		}

		if (
			current.gitPushAgent.provider === 'claudeCode' &&
			current.gitPushAgent.claudeCodeModel.length === 0
		) {
			nextDraft = setValueAtPath(
				nextDraft,
				'gitPushAgent.claudeCodeModel',
				firstModel,
			);
		}

		if (nextDraft !== current) {
			void saveDraft(nextDraft);
		}
	}, [claudeCodeModels, saveDraft]);

	const scrollToSection = (id: string) => {
		const el = document.getElementById(`section-${id}`);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	};

	const isFieldVisible = (field: SettingsFieldDefinition) => {
		if (!field.visibleWhen) {
			return true;
		}

		return (
			getValueAtPath(draft, field.visibleWhen.key) === field.visibleWhen.value
		);
	};

	const renderCodexModelControl = (
		field: SettingsFieldDefinition,
		value: boolean | number | string,
	) => {
		if (isLoadingCodexModels) {
			return (
				<span className="settings-row-description">
					Loading Codex models...
				</span>
			);
		}

		if (codexModelsError) {
			return (
				<span className="settings-shortcut-warning">{codexModelsError}</span>
			);
		}

		if (codexModels.length === 0) {
			return (
				<span className="settings-shortcut-warning">
					No Codex models are available.
				</span>
			);
		}

		return (
			<select
				className="settings-select"
				value={String(value)}
				onChange={(e) => void updateField(field, e.target.value)}
			>
				{codexModels.map((model) => (
					<option key={model.id} value={model.id}>
						{model.label}
					</option>
				))}
			</select>
		);
	};

	const renderClaudeCodeModelControl = (
		field: SettingsFieldDefinition,
		value: boolean | number | string,
	) => {
		if (isLoadingClaudeCodeModels) {
			return (
				<span className="settings-row-description">
					Loading Claude Code models...
				</span>
			);
		}

		if (claudeCodeModelsError) {
			return (
				<span className="settings-shortcut-warning">
					{claudeCodeModelsError}
				</span>
			);
		}

		if (claudeCodeModels.length === 0) {
			return (
				<span className="settings-shortcut-warning">
					No Claude Code models are available.
				</span>
			);
		}

		return (
			<select
				className="settings-select"
				value={String(value)}
				onChange={(e) => void updateField(field, e.target.value)}
			>
				{claudeCodeModels.map((model) => (
					<option key={model.id} value={model.id}>
						{model.label}
					</option>
				))}
			</select>
		);
	};

	const renderCustomFileExtensionDefaults = () => (
		<div className="settings-custom-extensions">
			<div className="settings-custom-extensions__header">
				<div>
					<span className="settings-row-label">Custom extension defaults</span>
					<span className="settings-row-description">
						Choose which tab opens first for specific file extensions.
					</span>
				</div>
				<button
					type="button"
					className="settings-secondary-button settings-secondary-button--small"
					onClick={() => void addCustomFileExtension()}
				>
					Add Extension
				</button>
			</div>
			{draft.fileViewer.customFileExtensions.length === 0 ? (
				<p className="settings-empty-state settings-custom-extensions__empty">
					No custom extension defaults.
				</p>
			) : (
				<div className="settings-custom-extensions__list">
					{draft.fileViewer.customFileExtensions.map((entry, index) => (
						<CustomFileExtensionRow
							key={entry.extension}
							defaultMode={entry.defaultMode}
							extension={entry.extension}
							index={index}
							onRemove={(entryIndex) =>
								void removeCustomFileExtension(entryIndex)
							}
							onUpdate={(entryIndex, patch) =>
								void updateCustomFileExtension(entryIndex, patch)
							}
						/>
					))}
				</div>
			)}
		</div>
	);

	const renderFieldControl = (field: SettingsFieldDefinition) => {
		const value = getValueAtPath(draft, field.key);

		if (field.key === 'dictation.parakeetRuntime') {
			const state = parakeetStatus?.state ?? 'not-installed';
			const installProgress = Math.round((parakeetStatus?.progress ?? 0) * 100);
			return (
				<div className="settings-shortcut-editor">
					<div className="settings-shortcut-value">
						<span
							className={`settings-shortcut-chip${state === 'ready' ? '' : ' settings-shortcut-chip--muted'}`}
						>
							{state === 'ready'
								? 'Ready'
								: state === 'installing'
									? 'Installing…'
									: state === 'unsupported'
										? 'Unsupported'
										: state === 'error'
											? 'Setup failed'
											: 'Not installed'}
						</span>
					</div>
					{state === 'installing' ? (
						<progress
							className="settings-parakeet-progress"
							max={100}
							value={installProgress}
							aria-label={`Installing on-device dictation: ${installProgress}%`}
						/>
					) : null}
					{parakeetStatus?.message ? (
						<span
							className={
								state === 'error' || state === 'unsupported'
									? 'settings-shortcut-warning'
									: 'settings-parakeet-status'
							}
						>
							{parakeetStatus.message}
						</span>
					) : null}
					<div className="settings-shortcut-actions">
						<button
							type="button"
							className="settings-secondary-button settings-secondary-button--small"
							disabled={isInstallingParakeet || state === 'unsupported'}
							onClick={() => void installParakeet()}
						>
							{state === 'ready' ? 'Reinstall' : 'Install engine and model'}
						</button>
					</div>
				</div>
			);
		}

		if (field.key === 'dictation.openaiApiKey') {
			const canSaveKey =
				dictationOpenAiKeyDraft.trim().length > 0 &&
				!isSavingDictationOpenAiKey;
			return (
				<div className="settings-shortcut-editor">
					<div className="settings-shortcut-value">
						<input
							className="settings-input-text"
							type="password"
							value={dictationOpenAiKeyDraft}
							placeholder={
								dictationOpenAiKeyConfigured ? 'OpenAI API key saved' : 'sk-...'
							}
							autoComplete="off"
							spellCheck={false}
							onChange={(event) =>
								setDictationOpenAiKeyDraft(event.target.value)
							}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && canSaveKey) {
									event.preventDefault();
									void saveDictationOpenAiKey();
								}
							}}
						/>
						<span
							className={`settings-shortcut-chip${dictationOpenAiKeyConfigured ? '' : ' settings-shortcut-chip--muted'}`}
						>
							{dictationOpenAiKeyConfigured ? 'Configured' : 'Not set'}
						</span>
					</div>
					{dictationOpenAiKeyError ? (
						<span className="settings-shortcut-warning">
							{dictationOpenAiKeyError}
						</span>
					) : null}
					<div className="settings-shortcut-actions">
						<button
							type="button"
							className="settings-secondary-button settings-secondary-button--small"
							disabled={!canSaveKey}
							onClick={() => void saveDictationOpenAiKey()}
						>
							{isSavingDictationOpenAiKey ? 'Saving' : 'Save Key'}
						</button>
						<button
							type="button"
							className="settings-secondary-button settings-secondary-button--small"
							disabled={
								!dictationOpenAiKeyConfigured || isSavingDictationOpenAiKey
							}
							onClick={() => void clearDictationOpenAiKey()}
						>
							Clear
						</button>
					</div>
				</div>
			);
		}

		if (field.key === 'dictation.microphoneDeviceId') {
			return renderDictationMicrophoneControl(field, value);
		}

		if (field.key.startsWith('keyboardShortcuts.')) {
			const command = field.key.replace('keyboardShortcuts.', '') as AppCommand;
			const normalizedValue = normalizeAccelerator(String(value));
			const isDefault = normalizedValue === defaultKeyboardShortcuts[command];
			const displayValue = normalizedValue
				? getCommandShortcutLabel(
						draft.keyboardShortcuts,
						command,
						navigator.platform.toLowerCase().includes('mac'),
					)
				: 'Disabled';
			const conflict = normalizedValue
				? Object.entries(draft.keyboardShortcuts).find(
						([otherCommand, otherValue]) =>
							otherCommand !== command &&
							normalizeAccelerator(otherValue) === normalizedValue,
					)
				: null;

			return (
				<div className="settings-shortcut-editor">
					<div className="settings-shortcut-value">
						<input
							className="settings-input-text settings-shortcut-input"
							type="text"
							value={
								listeningShortcutKey === field.key
									? 'Listening...'
									: String(value)
							}
							placeholder={field.placeholder}
							onFocus={() => {
								if (listeningShortcutKey !== field.key) {
									setListeningShortcutKey(field.key);
								}
							}}
							onClick={() => setListeningShortcutKey(field.key)}
							readOnly
						/>
						<span
							className={`settings-shortcut-chip${normalizedValue ? '' : ' settings-shortcut-chip--muted'}`}
						>
							{displayValue}
						</span>
					</div>
					{conflict ? (
						<span className="settings-shortcut-warning">
							Also used by {conflict[0].replace(/-/g, ' ')}
						</span>
					) : null}
					<div className="settings-shortcut-actions">
						<button
							type="button"
							className={`settings-secondary-button settings-secondary-button--small${listeningShortcutKey === field.key ? ' settings-shortcut-listen-button--active' : ''}`}
							onClick={() => setListeningShortcutKey(field.key)}
						>
							{listeningShortcutKey === field.key ? 'Press keys' : 'Listen'}
						</button>
						<button
							type="button"
							className="settings-secondary-button settings-secondary-button--small"
							onClick={() => void updateShortcut(field.key, '')}
						>
							Clear
						</button>
						<button
							type="button"
							className="settings-secondary-button settings-secondary-button--small"
							disabled={isDefault}
							onClick={() => resetShortcut(field)}
						>
							Reset
						</button>
					</div>
				</div>
			);
		}

		if (
			field.key === 'aiTabMetadata.title.codexModel' ||
			field.key === 'aiTabMetadata.note.codexModel' ||
			field.key === 'gitPushAgent.codexModel'
		) {
			return renderCodexModelControl(field, value);
		}

		if (
			field.key === 'aiTabMetadata.title.claudeCodeModel' ||
			field.key === 'aiTabMetadata.note.claudeCodeModel' ||
			field.key === 'gitPushAgent.claudeCodeModel'
		) {
			return renderClaudeCodeModelControl(field, value);
		}

		switch (field.input) {
			case 'boolean':
				return (
					<Switch
						checked={Boolean(value)}
						onChange={(val) => void updateField(field, val)}
						label={field.label}
					/>
				);
			case 'select':
				return (
					<select
						className="settings-select"
						aria-label={field.label}
						value={String(value)}
						onChange={(e) => void updateField(field, e.target.value)}
					>
						{field.options?.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
				);
			case 'number':
				return (
					<div className="settings-input-number-container">
						<input
							className="settings-input-range"
							type="range"
							min={field.min}
							max={field.max}
							step={field.step}
							value={Number(value)}
							onChange={(e) => void updateField(field, Number(e.target.value))}
						/>
						<input
							className="settings-input-number"
							type="number"
							min={field.min}
							max={field.max}
							step={field.step}
							value={Number(value)}
							onChange={(e) => void updateField(field, Number(e.target.value))}
						/>
					</div>
				);
			case 'text':
				return (
					<input
						className="settings-input-text"
						type="text"
						value={String(value)}
						placeholder={field.placeholder}
						onChange={(e) => void updateField(field, e.target.value)}
					/>
				);
			case 'textarea':
				return (
					<textarea
						className="settings-input-textarea"
						value={String(value)}
						placeholder={field.placeholder}
						rows={10}
						spellCheck={false}
						onChange={(e) => void updateField(field, e.target.value)}
					/>
				);
			case 'color': {
				const stringValue = String(value);
				const isTabThemeHue = isTabThemeHueValue(stringValue);
				const tabHueBrightness = getTabThemeHueBrightness(stringValue);
				const defaultValue = String(
					getDefaultValueAtPath(field.key) || '#000000',
				);
				const fallbackValue =
					defaultValue === TAB_THEME_HUE_COLOR_VALUE
						? getTerminalThemeColorFallback(field.key.replace(/^theme\./, ''))
						: defaultValue;
				const colorValue = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(
					stringValue,
				)
					? stringValue
					: fallbackValue;

				return (
					<div className="settings-color-container">
						<select
							className="settings-select settings-color-mode-select"
							value={isTabThemeHue ? TAB_THEME_HUE_COLOR_VALUE : 'custom'}
							onChange={(e) => {
								const nextValue =
									e.target.value === TAB_THEME_HUE_COLOR_VALUE
										? TAB_THEME_HUE_COLOR_VALUE
										: colorValue;
								void updateField(field, nextValue);
							}}
						>
							<option value="custom">Custom colour</option>
							<option value={TAB_THEME_HUE_COLOR_VALUE}>Tab Theme Hue</option>
						</select>
						{isTabThemeHue ? (
							<div className="settings-tab-hue-controls">
								<span className="settings-tab-hue-chip">
									<span
										className="settings-tab-hue-chip-swatch"
										style={{ filter: `brightness(${tabHueBrightness / 60})` }}
										aria-hidden="true"
									/>
									Tab Theme Hue
								</span>
								<input
									className="settings-tab-hue-brightness"
									type="range"
									min={0}
									max={100}
									step={1}
									value={tabHueBrightness}
									aria-label="Tab theme hue brightness"
									title="Brightness"
									onChange={(e) =>
										void updateField(
											field,
											buildTabThemeHueValue(Number(e.target.value)),
										)
									}
								/>
								<span className="settings-tab-hue-brightness-value">
									{tabHueBrightness}%
								</span>
							</div>
						) : (
							<>
								<input
									className="settings-color-swatch"
									type="color"
									value={colorValue.slice(0, 7)}
									onChange={(e) => void updateField(field, e.target.value)}
								/>
								<input
									className="settings-input-text settings-color-text"
									type="text"
									value={stringValue}
									onChange={(e) => void updateField(field, e.target.value)}
								/>
							</>
						)}
					</div>
				);
			}
			default:
				return null;
		}
	};

	useEffect(() => {
		if (!listeningShortcutKey) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();

			if (event.key === 'Escape') {
				setListeningShortcutKey(null);
				return;
			}

			const nextAccelerator = acceleratorFromKeyboardEvent(
				event,
				navigator.platform.toLowerCase().includes('mac'),
			);
			if (!nextAccelerator) {
				return;
			}

			void updateShortcut(listeningShortcutKey, nextAccelerator);
			setListeningShortcutKey(null);
		};

		window.addEventListener('keydown', onKeyDown, true);
		return () => {
			window.removeEventListener('keydown', onKeyDown, true);
		};
	}, [listeningShortcutKey, updateShortcut]);

	const settingsPreview =
		['appearance', 'cursor', 'theme'].includes(activeCategoryId) &&
		showPreview ? (
			<>
				<div
					className="settings-preview-resizer"
					onPointerDown={handleResizePointerDown}
				/>
				<div
					className="settings-preview-dock"
					style={{ height: previewHeight }}
				>
					<header className="settings-preview-header">
						<span>Live Preview</span>
						<button
							onClick={() => setShowPreview(false)}
							style={{
								background: 'none',
								border: 'none',
								color: 'var(--settings-text-muted)',
								cursor: 'pointer',
								fontSize: 12,
							}}
						>
							Hide
						</button>
					</header>
					<TerminalPreview settings={draft} />
				</div>
			</>
		) : undefined;

	const collapsedSettingsPreview =
		['appearance', 'cursor', 'theme'].includes(activeCategoryId) &&
		!showPreview ? (
			<div
				style={{
					padding: '8px 16px',
					borderTop: '1px solid var(--settings-border)',
					background: 'var(--settings-sidebar-bg)',
					textAlign: 'center',
				}}
			>
				<button
					onClick={() => setShowPreview(true)}
					style={{
						padding: '6px 16px',
						borderRadius: 6,
						background: 'var(--settings-accent)',
						color: '#fff',
						border: 'none',
						cursor: 'pointer',
						fontSize: 12,
						fontWeight: 500,
					}}
				>
					Show Live Preview
				</button>
			</div>
		) : undefined;


	const renderSettingsSection = (section: (typeof terminalSettingsSections)[number]) => (
		<section
			key={section.id}
			id={`section-${section.id}`}
			className="settings-section"
		>
			<div className="settings-section-title-row">
				<h3 className="settings-section-title">{section.title}</h3>
				{section.id === 'keyboard-shortcuts' ? (
					<button
						type="button"
						className="settings-secondary-button settings-secondary-button--small"
						onClick={() => void resetAllShortcuts()}
					>
						Reset All
					</button>
				) : null}
			</div>
			<div
				className={
					section.id === 'shell-launch'
						? 'settings-shell-profile-container'
						: 'settings-group'
				}
			>
				{section.id === 'shell-launch' ? (
					shellProfilesClient ? (
						<ShellProfilesSettings
							client={shellProfilesClient}
							serverIdentity={serverIdentity}
						/>
					) : (
						<div
							className="settings-group shell-profiles-loading"
							role="status"
						>
							Connect to a server to manage shell profiles.
						</div>
					)
				) : null}
				{section.fields.filter(isFieldVisible).map((field) => (
					<div
						key={field.key}
						className={`settings-row${field.input === 'textarea' ? ' settings-row--stacked' : ''}`}
					>
						<div className="settings-row-info">
							<span className="settings-row-label">
								{field.label}
							</span>
							<span className="settings-row-description">
								{field.description}
							</span>
						</div>
						<div className="settings-row-control">
							{renderFieldControl(field)}
						</div>
					</div>
				))}
				{section.id === 'terminay-mcp' &&
				connectedServersClient !== undefined ? (
					<ConnectedMcpServersSettings client={connectedServersClient} />
				) : null}
				{section.id === 'file-viewer-refresh' ? (
					<div className="settings-row settings-row--stacked">
						{renderCustomFileExtensionDefaults()}
					</div>
				) : null}
			</div>
		</section>
	);

	const leavePrompt =
		leaveRequest === null ? undefined : (
			<div className="settings-modal-backdrop">
				<div
					className="settings-modal settings-leave-prompt"
					role="alertdialog"
					aria-modal="true"
					aria-labelledby="settings-leave-title"
					onKeyDown={(event) => {
						if (event.key === 'Escape') {
							event.stopPropagation();
							void settleLeave('keep');
						}
					}}
				>
					<h2 id="settings-leave-title">Save changes to your macros?</h2>
					<p>{macroEditor.saveState}. Unsaved edits are lost if you leave now.</p>
					<div className="settings-inline-actions settings-modal-actions">
						<button
							type="button"
							className="settings-secondary-button"
							autoFocus
							onClick={() => void settleLeave('keep')}
						>
							Keep editing
						</button>
						<button
							type="button"
							className="settings-danger-button"
							onClick={() => void settleLeave('discard')}
						>
							Discard
						</button>
						<button
							type="button"
							className="settings-primary-button"
							onClick={() => void settleLeave('save')}
						>
							Save
						</button>
					</div>
				</div>
			</div>
		);

	const statusText = isSaving
		? 'Saving...'
		: saveError
			? `Not saved: ${saveError}`
			: isLoading
				? 'Loading...'
				: 'Saved';

	const openCategory = (categoryId: string) => {
		setActiveCategoryId(categoryId as CategoryId);
		setQuery('');
		if (categoryId === 'extensions' || categoryId === 'diagnostics') {
			setActiveSectionId(categoryId);
			return;
		}
		const firstSection = terminalSettingsSections.find(
			(s) => s.categoryId === categoryId,
		);
		if (firstSection) {
			setActiveSectionId(firstSection.id);
			setTimeout(() => scrollToSection(firstSection.id), 0);
		}
	};

	/** Opens a collection category with one of its items selected. */
	const openCollectionItem = (categoryId: 'macros' | 'remote', itemId: string) => {
		openCategory(categoryId);
		if (categoryId === 'macros') macroEditor.selectMacro(itemId);
		else selectCollectionItem('remote', itemId);
	};

	const renderShell = (
		children: ReactNode,
		parts?: Omit<SettingsCategoryParts, 'detail'>,
		listTitle?: string,
	) => (
		<SharedSettingsRouteBody
			query={query}
			categories={[]}
			categorySections={categoryGroups}
			activeCategoryId={activeCategoryId}
			status={statusText}
			sidebarAction={renderServerSelector?.(confirmLeave)}
			modal={leavePrompt}
			onQueryChange={setQuery}
			onCategorySelect={openCategory}
			onResetAll={
				activeCategoryId === 'extensions' ||
				activeCategoryId === 'macros' ||
				activeCategoryId === 'remote'
					? undefined
					: activeCategoryId === 'diagnostics'
						? () => void resetDiagnostics()
						: () => void resetAll()
			}
			{...(parts === undefined
				? {
						detailTitle: normalizedQuery
							? 'Search results'
							: visibleCategories.find((category) => category.id === activeCategoryId)
									?.label,
					}
				: {
						listColumn: parts.list,
						detailTitle: parts.detailTitle,
						...(listTitle === undefined ? {} : { listTitle }),
						...(parts.detailActions === undefined
							? {}
							: { detailActions: parts.detailActions }),
					})}
			contentRef={contentRef}
			preview={settingsPreview}
			collapsedPreview={collapsedSettingsPreview}
		>
			{children}
		</SharedSettingsRouteBody>
	);

	if (!normalizedQuery && activeCategoryId === 'macros' && macrosAvailable) {
		return (
			<MacrosCategory
				editor={macroEditor}
				render={({ detail, ...parts }) => renderShell(detail, parts, 'Macros')}
			/>
		);
	}

	if (
		!normalizedQuery &&
		activeCategoryId === 'remote' &&
		renderRemoteAccess !== undefined
	) {
		const trustedCount = remoteStatus?.pairedDevices.length ?? 0;
		return (
			<>
				{renderRemoteAccess({
					exposureLabel: serverIdentity,
					exposureStatus: remoteStatus?.isRunning
						? `Exposed · ${trustedCount} trusted`
						: 'Not exposed',
					exposureActive: remoteStatus?.isRunning === true,
					exposureDetail: filteredSections
						.filter((section) => section.categoryId === 'remote')
						.map(renderSettingsSection),
					selectedId: collectionSelection.remote ?? REMOTE_ACCESS_EXPOSURE_ID,
					onSelect: (id) => selectCollectionItem('remote', id),
					render: ({ detail, ...parts }) =>
						renderShell(detail, parts, 'Remote Access'),
				})}
			</>
		);
	}

	return renderShell(
		<>
			{normalizedQuery && (macroMatches.length > 0 || serverMatches.length > 0) ? (
				<section className="settings-section" aria-label="Matching items">
					<h3 className="settings-section-title">Items</h3>
					<div className="settings-group">
						{macroMatches.map((macro) => (
							<button
								key={`macro:${macro.id}`}
								type="button"
								className="settings-row settings-row--button"
								onClick={() => openCollectionItem('macros', macro.id)}
							>
								<span className="settings-row-info">
									<span className="settings-row-label">{macro.title}</span>
									<span className="settings-row-description">Macros</span>
								</span>
							</button>
						))}
						{serverMatches.map((profile) => (
							<button
								key={`server:${profile.id}`}
								type="button"
								className="settings-row settings-row--button"
								onClick={() => openCollectionItem('remote', profile.id)}
							>
								<span className="settings-row-info">
									<span className="settings-row-label">{profile.label}</span>
									<span className="settings-row-description">
										Remote Access · Saved servers
									</span>
								</span>
							</button>
						))}
					</div>
				</section>
			) : null}
			{displayedCategories.some((category) => category.id === 'diagnostics') ? (
				<section id="section-diagnostics" className="settings-section">
					<div className="settings-section-title-row">
						<h3 className="settings-section-title">Performance logging</h3>
					</div>
					<div className="settings-group">
						<div className="settings-row">
							<div className="settings-row-info">
								<span className="settings-row-label">Performance logging</span>
								<span className="settings-row-description">
									Record process CPU, memory, event-loop delay, renderer call
									stacks, and occasional Chromium traces in the Diagnostics
									folder. Off by default. Logs stay on this device and are never
									uploaded. Help → Reveal Diagnostics Folder opens the same
									folder. For startup timing and live terminal usage you do not
									need this on: open Help → Performance Log.
								</span>
							</div>
							<div className="settings-row-control">
								<Switch
									checked={performanceLoggingEnabled}
									label="Performance logging"
									onChange={(enabled) => {
										void togglePerformanceLogging(enabled);
									}}
								/>
							</div>
						</div>
					</div>
				</section>
			) : null}
			{displayedCategories.some((category) => category.id === 'extensions') ? (
				<ExtensionSettingsSection
					applicationClient={applicationClient}
					serverName={serverIdentity}
					harnessSwitches={draft.agentIntegration.harnesses}
					onHarnessSwitchChange={(key, enabled) => {
						const current = draftRef.current;
						// Committed before it shows, like a shortcut: closing Settings
						// must not abandon a switch that only looked saved.
						void saveDraft({
							...current,
							agentIntegration: {
								...current.agentIntegration,
								harnesses: {
									...current.agentIntegration.harnesses,
									[key]: enabled,
								},
							},
						}, false);
					}}
				/>
			) : null}
			{displayedCategories.map((cat) => {
				if (cat.id === 'extensions' || cat.id === 'diagnostics' || cat.id === 'macros')
					return null;
				const sections = filteredSections.filter(
					(s) => s.categoryId === cat.id,
				);
				if (sections.length === 0) return null;

				return (
					<div key={cat.id}>
						{query && (
							<h3 className="settings-section-title settings-search-category-title">
								{cat.label}
							</h3>
						)}
						{sections.map(renderSettingsSection)}
					</div>
				);
			})}
		</>,
	);
}
