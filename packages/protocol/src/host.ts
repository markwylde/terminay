import type { JsonValue } from './errors.js';
import { assertJsonValue } from './json.js';

export const TERMINAY_HOST_CONTEXT_SCHEMA_VERSION = 1 as const;
export const TERMINAY_HOST_BOOTSTRAP_VERSION = 1 as const;
export const TERMINAY_HOST_BRIDGE_VERSION = 1 as const;
export const TERMINAY_HOST_BYTE_ENDPOINT_VERSION = 1 as const;
export const TERMINAY_UI_BUNDLE_FORMAT_VERSION = 1 as const;

export const TERMINAY_HOST_CAPABILITY_NAMES = [
	'nativeWindows',
	'nativeMenus',
	'filePicker',
	'clipboardWrite',
	'notifications',
	'updater',
	'osIntegration',
] as const;

export type TerminayHostKind = 'browser' | 'desktop';
export type TerminayHostCapability =
	(typeof TERMINAY_HOST_CAPABILITY_NAMES)[number];
export type TerminayHostCapabilityVersions = Readonly<
	Partial<Record<TerminayHostCapability, number>>
>;

export interface TerminayVersionRange {
	readonly minimum: number;
	readonly maximum: number;
}

export interface TerminayHostCompatibilityRequirements {
	readonly bootstrap: TerminayVersionRange;
	readonly bundleFormat: TerminayVersionRange;
	readonly hostBridge: TerminayVersionRange;
	readonly byteEndpoint: TerminayVersionRange;
	readonly executionRuntime: TerminayVersionRange;
	readonly requiredCapabilities: Readonly<
		Partial<Record<TerminayHostCapability, TerminayVersionRange>>
	>;
	readonly optionalCapabilities: Readonly<
		Partial<Record<TerminayHostCapability, TerminayVersionRange>>
	>;
}

export interface TerminayHostRuntimeSupport {
	readonly bootstrapVersion: number;
	readonly bundleFormatVersion: number;
	readonly hostBridgeVersion: number;
	readonly byteEndpointVersion: number;
	readonly executionRuntimeVersion: number;
	readonly capabilities: TerminayHostCapabilityVersions;
}

export interface TerminayHostContext {
	readonly schemaVersion: typeof TERMINAY_HOST_CONTEXT_SCHEMA_VERSION;
	readonly bootstrapVersion: typeof TERMINAY_HOST_BOOTSTRAP_VERSION;
	readonly sourceId: string;
	readonly windowId: string;
	readonly serverId: string;
	readonly profileId: string;
	readonly bundleId: string;
	readonly applicationProtocolVersion: string;
	readonly hostKind: TerminayHostKind;
	readonly hostBridgeVersion: number;
	readonly byteEndpointVersion: number;
	readonly capabilities: TerminayHostCapabilityVersions;
}

export type TerminayHostCompatibilityFailure = Readonly<{
	compatible: false;
	component:
		| 'bootstrap'
		| 'bundle-format'
		| 'host-bridge'
		| 'byte-endpoint'
		| 'execution-runtime'
		| 'host-capability';
	code: 'below-minimum' | 'above-maximum' | 'missing-capability';
	capability?: TerminayHostCapability;
	required: TerminayVersionRange;
	actual?: number;
}>;

export type TerminayHostCompatibilityResult =
	| Readonly<{
			compatible: true;
			unavailableOptionalCapabilities: readonly TerminayHostCapability[];
	  }>
	| TerminayHostCompatibilityFailure;

export interface TerminayUiBundleCompatibilityManifest {
	readonly schemaVersion: 1;
	readonly bundleId: string;
	readonly protocolVersion: string;
	readonly bundleFormatVersion: typeof TERMINAY_UI_BUNDLE_FORMAT_VERSION;
	readonly hostCompatibility: TerminayHostCompatibilityRequirements;
}

export type TerminayBundleCompatibilityResult =
	| TerminayHostCompatibilityResult
	| Readonly<{
			compatible: false;
			component: 'bundle-manifest' | 'bundle-binding' | 'application-protocol';
			code: 'invalid-manifest' | 'identity-mismatch' | 'version-mismatch';
			message: string;
	  }>;

export interface TerminayHostBytePacket {
	readonly type: 'terminay.host-byte';
	readonly version: typeof TERMINAY_HOST_BYTE_ENDPOINT_VERSION;
	readonly serverId: string;
	readonly frame: Uint8Array;
}

export type TerminayHostRouteDisposition =
	| 'in-page'
	| 'native-window'
	| 'browser-tab';

export const TERMINAY_HOST_MENU_COMMANDS = [
	'clear-terminal',
	'close-active',
	'new-project',
	'new-terminal',
	'open-command-bar',
	'open-extensions',
	'open-macros',
	'open-project-environments',
	'open-recordings',
	'open-settings',
	'popout-active',
	'save-active',
	'set-project-root-folder-to-working-directory',
	'split-horizontal',
	'split-vertical',
	'start-dictation',
	'toggle-file-explorer-sidebar',
] as const;

export type TerminayHostMenuCommand =
	(typeof TERMINAY_HOST_MENU_COMMANDS)[number];

export type TerminayHostMenuAccelerator = Readonly<{
	command: TerminayHostMenuCommand;
	accelerator: string;
}>;

export type TerminayHostEvent = Readonly<{
	schemaVersion: typeof TERMINAY_HOST_CONTEXT_SCHEMA_VERSION;
	bridgeVersion: typeof TERMINAY_HOST_BRIDGE_VERSION;
	sourceId: string;
	windowId: string;
	profileId: string;
	serverId: string;
	event:
		| Readonly<{
				type: 'menu.command';
				command: TerminayHostMenuCommand;
		  }>
		| Readonly<{
				type: 'terminal.zoom';
				zoomLevel: number;
		  }>
		| Readonly<{
				type: 'workspace.drag-state';
				active: boolean;
		  }>
		| Readonly<{
				type: 'device.settings.changed';
				settings: JsonValue;
		  }>;
}>;

export type TerminayHostAction =
	| Readonly<{
			/** Desktop consumes the one-time pairing fragment in the privileged
			 * host. No pairing secret or durable credential returns to the
			 * renderer. */
			type: 'connection.pair';
			pairingUrl: string;
	  }>
	| Readonly<{
			type: 'route.present';
			route: string;
			disposition: TerminayHostRouteDisposition;
			logicalViewId?: string;
	  }>
	| Readonly<{ type: 'route.focus'; presentationId: string }>
	| Readonly<{ type: 'route.close'; presentationId?: string }>
	| Readonly<{ type: 'menu.invoke'; command: TerminayHostMenuCommand }>
	| Readonly<{
			type: 'menu.accelerators.update';
			accelerators: readonly TerminayHostMenuAccelerator[];
	  }>
	| Readonly<{ type: 'device.settings.update'; settings: JsonValue }>
	| Readonly<{
			type: 'file.choose';
			multiple?: boolean;
			accept?: readonly string[];
	  }>
	| Readonly<{ type: 'clipboard.write'; text: string }>
	| Readonly<{ type: 'notification.show'; title: string; body?: string }>
	| Readonly<{ type: 'updater.check' }>
	| Readonly<{ type: 'os.open-external'; url: string }>
	| Readonly<{ type: 'os.reveal'; token: string }>
	| Readonly<{
			type: 'workspace.drag.start';
			viewId: string;
			preview: Readonly<{
				title: string;
				emoji: string;
				color: string;
				width: number;
			}>;
	  }>
	| Readonly<{ type: 'workspace.drag.end' }>;

export interface TerminayHostActionRequest {
	readonly schemaVersion: typeof TERMINAY_HOST_CONTEXT_SCHEMA_VERSION;
	readonly bridgeVersion: typeof TERMINAY_HOST_BRIDGE_VERSION;
	readonly sourceId: string;
	readonly windowId: string;
	readonly profileId: string;
	readonly serverId: string;
	readonly userGesture: true;
	readonly action: TerminayHostAction;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const BUNDLE_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const MAX_VERSION = 65_535;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const CAPABILITY_NAMES = new Set<string>(TERMINAY_HOST_CAPABILITY_NAMES);
const MENU_COMMANDS = new Set<string>(TERMINAY_HOST_MENU_COMMANDS);

export function parseTerminayHostMenuCommand(
	value: unknown,
): TerminayHostMenuCommand {
	if (typeof value !== 'string' || !MENU_COMMANDS.has(value))
		throw new TypeError('host menu command is invalid');
	return value as TerminayHostMenuCommand;
}

export function parseTerminayHostEvent(
	value: unknown,
	contextValue: unknown,
): TerminayHostEvent {
	const context = parseTerminayHostContext(contextValue);
	const input = record(value, 'host event');
	exactKeys(
		input,
		[
			'schemaVersion',
			'bridgeVersion',
			'sourceId',
			'windowId',
			'profileId',
			'serverId',
			'event',
		],
		'host event',
	);
	if (
		input.schemaVersion !== TERMINAY_HOST_CONTEXT_SCHEMA_VERSION ||
		input.bridgeVersion !== TERMINAY_HOST_BRIDGE_VERSION
	)
		throw new TypeError('host event version is unsupported');
	for (const [field, expected] of [
		['sourceId', context.sourceId],
		['windowId', context.windowId],
		['profileId', context.profileId],
		['serverId', context.serverId],
	] as const) {
		if (input[field] !== expected)
			throw new TypeError(`host event ${field} is outside its binding`);
	}
	const event = record(input.event, 'host event payload');
	let parsedEvent: TerminayHostEvent['event'];
	if (event.type === 'menu.command') {
		exactKeys(event, ['type', 'command'], 'host menu event');
		parsedEvent = Object.freeze({
			type: 'menu.command',
			command: parseTerminayHostMenuCommand(event.command),
		});
	} else if (event.type === 'terminal.zoom') {
		exactKeys(event, ['type', 'zoomLevel'], 'host terminal zoom event');
		if (
			typeof event.zoomLevel !== 'number' ||
			!Number.isSafeInteger(event.zoomLevel) ||
			event.zoomLevel < -5 ||
			event.zoomLevel > 10
		)
			throw new TypeError('host terminal zoom level is invalid');
		parsedEvent = Object.freeze({
			type: 'terminal.zoom',
			zoomLevel: event.zoomLevel,
		});
	} else if (event.type === 'workspace.drag-state') {
		exactKeys(event, ['type', 'active'], 'host workspace drag event');
		if (typeof event.active !== 'boolean')
			throw new TypeError('host workspace drag state is invalid');
		parsedEvent = Object.freeze({
			type: 'workspace.drag-state',
			active: event.active,
		});
	} else if (event.type === 'device.settings.changed') {
		exactKeys(event, ['type', 'settings'], 'host device settings event');
		assertJsonValue(event.settings);
		parsedEvent = Object.freeze({
			type: 'device.settings.changed',
			settings: event.settings,
		});
	} else {
		throw new TypeError('host event type is invalid');
	}
	return Object.freeze({
		schemaVersion: TERMINAY_HOST_CONTEXT_SCHEMA_VERSION,
		bridgeVersion: TERMINAY_HOST_BRIDGE_VERSION,
		sourceId: context.sourceId,
		windowId: context.windowId,
		profileId: context.profileId,
		serverId: context.serverId,
		event: parsedEvent,
	});
}

export function parseTerminayHostContext(value: unknown): TerminayHostContext {
	const input = record(value, 'host context');
	exactKeys(
		input,
		[
			'schemaVersion',
			'bootstrapVersion',
			'sourceId',
			'windowId',
			'serverId',
			'profileId',
			'bundleId',
			'applicationProtocolVersion',
			'hostKind',
			'hostBridgeVersion',
			'byteEndpointVersion',
			'capabilities',
		],
		'host context',
	);
	if (input.schemaVersion !== TERMINAY_HOST_CONTEXT_SCHEMA_VERSION)
		throw new TypeError('host context schema is unsupported');
	if (input.bootstrapVersion !== TERMINAY_HOST_BOOTSTRAP_VERSION)
		throw new TypeError('host bootstrap version is unsupported');
	const sourceId = identifier(input.sourceId, 'source id', ID);
	const windowId = identifier(input.windowId, 'window id', ID);
	const serverId = identifier(input.serverId, 'server id', ID);
	const profileId = identifier(input.profileId, 'profile id', ID);
	const bundleId = identifier(input.bundleId, 'bundle id', BUNDLE_ID);
	const applicationProtocolVersion = identifier(
		input.applicationProtocolVersion,
		'application protocol version',
		ID,
	);
	if (input.hostKind !== 'browser' && input.hostKind !== 'desktop')
		throw new TypeError('host kind is invalid');
	const hostBridgeVersion = version(
		input.hostBridgeVersion,
		'host bridge version',
	);
	const byteEndpointVersion = version(
		input.byteEndpointVersion,
		'host byte endpoint version',
	);
	const capabilities = parseCapabilityVersions(
		input.capabilities,
		'host capabilities',
	);
	return Object.freeze({
		schemaVersion: TERMINAY_HOST_CONTEXT_SCHEMA_VERSION,
		bootstrapVersion: TERMINAY_HOST_BOOTSTRAP_VERSION,
		sourceId,
		windowId,
		serverId,
		profileId,
		bundleId,
		applicationProtocolVersion,
		hostKind: input.hostKind,
		hostBridgeVersion,
		byteEndpointVersion,
		capabilities,
	});
}

export function parseTerminayHostCompatibilityRequirements(
	value: unknown,
): TerminayHostCompatibilityRequirements {
	const input = record(value, 'host compatibility requirements');
	exactKeys(
		input,
		[
			'bootstrap',
			'bundleFormat',
			'hostBridge',
			'byteEndpoint',
			'executionRuntime',
			'requiredCapabilities',
			'optionalCapabilities',
		],
		'host compatibility requirements',
	);
	const requiredCapabilities = parseCapabilityRanges(
		input.requiredCapabilities,
		'required host capabilities',
	);
	const optionalCapabilities = parseCapabilityRanges(
		input.optionalCapabilities,
		'optional host capabilities',
	);
	for (const capability of TERMINAY_HOST_CAPABILITY_NAMES) {
		if (
			requiredCapabilities[capability] !== undefined &&
			optionalCapabilities[capability] !== undefined
		) {
			throw new TypeError(
				`host capability cannot be both required and optional: ${capability}`,
			);
		}
	}
	return Object.freeze({
		bootstrap: parseVersionRange(input.bootstrap, 'host bootstrap range'),
		bundleFormat: parseVersionRange(
			input.bundleFormat,
			'UI bundle format range',
		),
		hostBridge: parseVersionRange(input.hostBridge, 'host bridge range'),
		byteEndpoint: parseVersionRange(
			input.byteEndpoint,
			'host byte endpoint range',
		),
		executionRuntime: parseVersionRange(
			input.executionRuntime,
			'host execution runtime range',
		),
		requiredCapabilities,
		optionalCapabilities,
	});
}

export function evaluateTerminayHostCompatibility(
	requirementsValue: unknown,
	supportValue: TerminayHostRuntimeSupport,
): TerminayHostCompatibilityResult {
	const requirements =
		parseTerminayHostCompatibilityRequirements(requirementsValue);
	const support = parseHostRuntimeSupport(supportValue);
	const versionChecks = [
		['bootstrap', requirements.bootstrap, support.bootstrapVersion],
		['bundle-format', requirements.bundleFormat, support.bundleFormatVersion],
		['host-bridge', requirements.hostBridge, support.hostBridgeVersion],
		['byte-endpoint', requirements.byteEndpoint, support.byteEndpointVersion],
		[
			'execution-runtime',
			requirements.executionRuntime,
			support.executionRuntimeVersion,
		],
	] as const;
	for (const [component, range, actual] of versionChecks) {
		const failure = compareVersion(component, range, actual);
		if (failure !== undefined) return failure;
	}
	for (const capability of TERMINAY_HOST_CAPABILITY_NAMES) {
		const required = requirements.requiredCapabilities[capability];
		if (required === undefined) continue;
		const actual = support.capabilities[capability];
		if (actual === undefined) {
			return Object.freeze({
				compatible: false,
				component: 'host-capability',
				code: 'missing-capability',
				capability,
				required,
			});
		}
		const failure = compareVersion(
			'host-capability',
			required,
			actual,
			capability,
		);
		if (failure !== undefined) return failure;
	}
	const unavailableOptionalCapabilities = TERMINAY_HOST_CAPABILITY_NAMES.filter(
		(capability) => {
			const optional = requirements.optionalCapabilities[capability];
			if (optional === undefined) return false;
			const actual = support.capabilities[capability];
			return (
				actual === undefined ||
				actual < optional.minimum ||
				actual > optional.maximum
			);
		},
	);
	return Object.freeze({
		compatible: true,
		unavailableOptionalCapabilities: Object.freeze(
			unavailableOptionalCapabilities,
		),
	});
}

/** Browser-safe parser for the compatibility-bearing portion of the canonical
 * server-core UI manifest. Asset hashes remain the installer/verifier's job. */
export function parseTerminayUiBundleCompatibilityManifest(
	value: unknown,
): TerminayUiBundleCompatibilityManifest {
	const input = record(value, 'UI bundle manifest');
	exactKeys(
		input,
		[
			'schemaVersion',
			'bundleId',
			'entryPath',
			'protocolVersion',
			'serverVersion',
			'contentSecurityPolicy',
			'bundleFormatVersion',
			'hostCompatibility',
			'assets',
		],
		'UI bundle manifest',
	);
	if (
		input.schemaVersion !== 1 ||
		input.bundleFormatVersion !== TERMINAY_UI_BUNDLE_FORMAT_VERSION
	)
		throw new TypeError('UI bundle manifest version is unsupported');
	if (!Array.isArray(input.assets) || input.assets.length === 0)
		throw new TypeError('UI bundle manifest assets are invalid');
	return Object.freeze({
		schemaVersion: 1,
		bundleId: identifier(input.bundleId, 'bundle id', BUNDLE_ID),
		protocolVersion: identifier(
			input.protocolVersion,
			'application protocol version',
			ID,
		),
		bundleFormatVersion: TERMINAY_UI_BUNDLE_FORMAT_VERSION,
		hostCompatibility: parseTerminayHostCompatibilityRequirements(
			input.hostCompatibility,
		),
	});
}

export function evaluateTerminayBundleCompatibility(
	manifestValue: unknown,
	bootstrapValue: unknown,
	supportValue: TerminayHostRuntimeSupport,
): TerminayBundleCompatibilityResult {
	let manifest: TerminayUiBundleCompatibilityManifest;
	try {
		manifest = parseTerminayUiBundleCompatibilityManifest(manifestValue);
	} catch (error) {
		return Object.freeze({
			compatible: false,
			component: 'bundle-manifest',
			code: 'invalid-manifest',
			message:
				error instanceof Error
					? error.message
					: 'UI bundle manifest is invalid',
		});
	}
	let bootstrap: TerminayHostContext;
	try {
		bootstrap = parseTerminayHostContext(bootstrapValue);
	} catch (error) {
		return Object.freeze({
			compatible: false,
			component: 'bundle-binding',
			code: 'identity-mismatch',
			message:
				error instanceof Error ? error.message : 'host bootstrap is invalid',
		});
	}
	if (bootstrap.bundleId !== manifest.bundleId)
		return Object.freeze({
			compatible: false,
			component: 'bundle-binding',
			code: 'identity-mismatch',
			message: 'host bootstrap belongs to another UI bundle',
		});
	if (bootstrap.applicationProtocolVersion !== manifest.protocolVersion)
		return Object.freeze({
			compatible: false,
			component: 'application-protocol',
			code: 'version-mismatch',
			message:
				'host bootstrap application protocol does not match the UI bundle',
		});
	return evaluateTerminayHostCompatibility(
		manifest.hostCompatibility,
		supportValue,
	);
}

export function createTerminayHostBytePacket(
	serverIdValue: unknown,
	frameValue: unknown,
): TerminayHostBytePacket {
	const serverId = identifier(serverIdValue, 'server id', ID);
	const frame = copyByteArray(frameValue);
	if (
		frame === undefined ||
		frame.byteLength === 0 ||
		frame.byteLength > MAX_FRAME_BYTES
	) {
		throw new TypeError('host byte frame is invalid');
	}
	return Object.freeze({
		type: 'terminay.host-byte',
		version: TERMINAY_HOST_BYTE_ENDPOINT_VERSION,
		serverId,
		frame,
	});
}

export function parseTerminayHostAction(value: unknown): TerminayHostAction {
	const action = record(value, 'host action');
	switch (action.type) {
		case 'connection.pair':
			exactKeys(action, ['type', 'pairingUrl'], 'connection pairing action');
			if (
				typeof action.pairingUrl !== 'string' ||
				action.pairingUrl.length === 0 ||
				action.pairingUrl.length > 16_384
			)
				throw new TypeError('connection pairing URL is invalid');
			return Object.freeze({
				type: 'connection.pair',
				pairingUrl: action.pairingUrl,
			});
		case 'route.present': {
			exactOptionalKeys(
				action,
				['type', 'route', 'disposition'],
				['logicalViewId'],
				'route presentation action',
			);
			const route = routePath(action.route);
			if (
				action.disposition !== 'in-page' &&
				action.disposition !== 'native-window' &&
				action.disposition !== 'browser-tab'
			)
				throw new TypeError('route disposition is invalid');
			const logicalViewId =
				action.logicalViewId === undefined
					? undefined
					: identifier(action.logicalViewId, 'logical view id', ID);
			return Object.freeze({
				type: 'route.present',
				route,
				disposition: action.disposition,
				...(logicalViewId === undefined ? {} : { logicalViewId }),
			});
		}
		case 'route.focus':
			exactKeys(action, ['type', 'presentationId'], 'route focus action');
			return Object.freeze({
				type: 'route.focus',
				presentationId: identifier(
					action.presentationId,
					'presentation id',
					ID,
				),
			});
		case 'route.close': {
			exactOptionalKeys(
				action,
				['type'],
				['presentationId'],
				'route close action',
			);
			const presentationId =
				action.presentationId === undefined
					? undefined
					: identifier(action.presentationId, 'presentation id', ID);
			return Object.freeze({
				type: 'route.close',
				...(presentationId === undefined ? {} : { presentationId }),
			});
		}
		case 'menu.invoke':
			exactKeys(action, ['type', 'command'], 'menu action');
			return Object.freeze({
				type: 'menu.invoke',
				command: parseTerminayHostMenuCommand(action.command),
			});
		case 'menu.accelerators.update': {
			exactKeys(action, ['type', 'accelerators'], 'menu accelerators action');
			if (
				!Array.isArray(action.accelerators) ||
				action.accelerators.length > 64
			)
				throw new TypeError('menu accelerators are invalid');
			const commands = new Set<TerminayHostMenuCommand>();
			const accelerators = action.accelerators.map((value) => {
				const entry = record(value, 'menu accelerator');
				exactKeys(entry, ['command', 'accelerator'], 'menu accelerator');
				const command = parseTerminayHostMenuCommand(entry.command);
				if (commands.has(command))
					throw new TypeError('menu accelerator commands must be unique');
				commands.add(command);
				if (
					typeof entry.accelerator !== 'string' ||
					entry.accelerator.length > 128 ||
					[...entry.accelerator].some((character) => {
						const code = character.codePointAt(0) ?? 0;
						return code < 0x20 || code === 0x7f;
					})
				)
					throw new TypeError('menu accelerator is invalid');
				return Object.freeze({ command, accelerator: entry.accelerator });
			});
			return Object.freeze({
				type: 'menu.accelerators.update',
				accelerators: Object.freeze(accelerators),
			});
		}
		case 'device.settings.update':
			exactKeys(action, ['type', 'settings'], 'device settings action');
			record(action.settings, 'device settings');
			assertJsonValue(action.settings);
			return Object.freeze({
				type: 'device.settings.update',
				settings: action.settings,
			});
		case 'file.choose': {
			exactOptionalKeys(
				action,
				['type'],
				['multiple', 'accept'],
				'file selection action',
			);
			if (action.multiple !== undefined && typeof action.multiple !== 'boolean')
				throw new TypeError('file selection multiple flag is invalid');
			const accept =
				action.accept === undefined
					? undefined
					: stringList(action.accept, 'file selection accept list', 32, 128);
			return Object.freeze({
				type: 'file.choose',
				...(action.multiple === undefined ? {} : { multiple: action.multiple }),
				...(accept === undefined ? {} : { accept }),
			});
		}
		case 'clipboard.write':
			exactKeys(action, ['type', 'text'], 'clipboard action');
			return Object.freeze({
				type: 'clipboard.write',
				text: boundedText(action.text, 'clipboard text', 1024 * 1024, true),
			});
		case 'notification.show': {
			exactOptionalKeys(
				action,
				['type', 'title'],
				['body'],
				'notification action',
			);
			const title = boundedText(action.title, 'notification title', 200);
			const body =
				action.body === undefined
					? undefined
					: boundedText(action.body, 'notification body', 4_096, true);
			return Object.freeze({
				type: 'notification.show',
				title,
				...(body === undefined ? {} : { body }),
			});
		}
		case 'updater.check':
			exactKeys(action, ['type'], 'updater action');
			return Object.freeze({ type: 'updater.check' });
		case 'os.open-external':
			exactKeys(action, ['type', 'url'], 'external URL action');
			return Object.freeze({
				type: 'os.open-external',
				url: safeExternalUrl(action.url),
			});
		case 'os.reveal':
			exactKeys(action, ['type', 'token'], 'reveal action');
			return Object.freeze({
				type: 'os.reveal',
				token: identifier(action.token, 'server-owned reveal token', ID),
			});
		case 'workspace.drag.start': {
			exactKeys(action, ['type', 'viewId', 'preview'], 'workspace drag action');
			const preview = record(action.preview, 'workspace drag preview');
			exactKeys(
				preview,
				['title', 'emoji', 'color', 'width'],
				'workspace drag preview',
			);
			if (
				typeof preview.color !== 'string' ||
				!/^#[0-9a-fA-F]{3,8}$/u.test(preview.color) ||
				typeof preview.width !== 'number' ||
				!Number.isSafeInteger(preview.width) ||
				preview.width < 80 ||
				preview.width > 2_000
			)
				throw new TypeError('workspace drag preview is invalid');
			return Object.freeze({
				type: 'workspace.drag.start',
				viewId: identifier(action.viewId, 'workspace view id', ID),
				preview: Object.freeze({
					title: boundedText(preview.title, 'workspace drag title', 512, true),
					emoji: boundedText(preview.emoji, 'workspace drag emoji', 64, true),
					color: preview.color,
					width: preview.width,
				}),
			});
		}
		case 'workspace.drag.end':
			exactKeys(action, ['type'], 'workspace drag action');
			return Object.freeze({ type: 'workspace.drag.end' });
		default:
			throw new TypeError('host action is not allowed');
	}
}

export function parseTerminayHostActionRequest(
	value: unknown,
	contextValue: unknown,
): TerminayHostActionRequest {
	const context = parseTerminayHostContext(contextValue);
	const request = record(value, 'host action request');
	exactKeys(
		request,
		[
			'schemaVersion',
			'bridgeVersion',
			'sourceId',
			'windowId',
			'profileId',
			'serverId',
			'userGesture',
			'action',
		],
		'host action request',
	);
	if (
		request.schemaVersion !== TERMINAY_HOST_CONTEXT_SCHEMA_VERSION ||
		request.bridgeVersion !== TERMINAY_HOST_BRIDGE_VERSION
	)
		throw new TypeError('host action request version is unsupported');
	if (request.userGesture !== true)
		throw new TypeError('host action requires a user gesture');
	for (const [field, expected] of [
		['sourceId', context.sourceId],
		['windowId', context.windowId],
		['profileId', context.profileId],
		['serverId', context.serverId],
	] as const) {
		if (request[field] !== expected)
			throw new TypeError(
				`host action request ${field} is outside its binding`,
			);
	}
	return Object.freeze({
		schemaVersion: TERMINAY_HOST_CONTEXT_SCHEMA_VERSION,
		bridgeVersion: TERMINAY_HOST_BRIDGE_VERSION,
		sourceId: context.sourceId,
		windowId: context.windowId,
		profileId: context.profileId,
		serverId: context.serverId,
		userGesture: true,
		action: parseTerminayHostAction(request.action),
	});
}

export function requiredTerminayHostCapability(
	action: TerminayHostAction,
): TerminayHostCapability | undefined {
	switch (action.type) {
		case 'connection.pair':
			return 'nativeWindows';
		case 'route.present':
			return action.disposition === 'native-window'
				? 'nativeWindows'
				: undefined;
		case 'route.focus':
		case 'route.close':
			return 'nativeWindows';
		case 'menu.invoke':
		case 'menu.accelerators.update':
		case 'device.settings.update':
			return 'nativeMenus';
		case 'file.choose':
			return 'filePicker';
		case 'clipboard.write':
			return 'clipboardWrite';
		case 'notification.show':
			return 'notifications';
		case 'updater.check':
			return 'updater';
		case 'os.open-external':
		case 'os.reveal':
			return 'osIntegration';
		case 'workspace.drag.start':
		case 'workspace.drag.end':
			return 'nativeWindows';
	}
}

/**
 * Validate a semantic action, its immutable source binding, gesture proof, and
 * the capability injected by the trusted host. The renderer can request an
 * action but cannot manufacture the authority needed to perform it.
 */
export function authorizeTerminayHostActionRequest(
	value: unknown,
	contextValue: unknown,
): TerminayHostActionRequest {
	const context = parseTerminayHostContext(contextValue);
	const request = parseTerminayHostActionRequest(value, context);
	const capability = requiredTerminayHostCapability(request.action);
	if (
		capability !== undefined &&
		context.capabilities[capability] === undefined
	)
		throw new TypeError(`host capability is unavailable: ${capability}`);
	return request;
}

export function parseTerminayHostBytePacket(
	value: unknown,
	expectedServerIdValue: unknown,
): TerminayHostBytePacket {
	const expectedServerId = identifier(
		expectedServerIdValue,
		'expected server id',
		ID,
	);
	const input = record(value, 'host byte packet');
	exactKeys(
		input,
		['type', 'version', 'serverId', 'frame'],
		'host byte packet',
	);
	if (
		input.type !== 'terminay.host-byte' ||
		input.version !== TERMINAY_HOST_BYTE_ENDPOINT_VERSION
	) {
		throw new TypeError('host byte packet version is unsupported');
	}
	const packet = createTerminayHostBytePacket(input.serverId, input.frame);
	if (packet.serverId !== expectedServerId)
		throw new TypeError('host byte packet belongs to another server');
	return packet;
}

function parseHostRuntimeSupport(
	value: TerminayHostRuntimeSupport,
): TerminayHostRuntimeSupport {
	const input = record(value, 'host runtime support');
	exactKeys(
		input,
		[
			'bootstrapVersion',
			'bundleFormatVersion',
			'hostBridgeVersion',
			'byteEndpointVersion',
			'executionRuntimeVersion',
			'capabilities',
		],
		'host runtime support',
	);
	return Object.freeze({
		bootstrapVersion: version(input.bootstrapVersion, 'host bootstrap version'),
		bundleFormatVersion: version(
			input.bundleFormatVersion,
			'UI bundle format version',
		),
		hostBridgeVersion: version(input.hostBridgeVersion, 'host bridge version'),
		byteEndpointVersion: version(
			input.byteEndpointVersion,
			'host byte endpoint version',
		),
		executionRuntimeVersion: version(
			input.executionRuntimeVersion,
			'host execution runtime version',
		),
		capabilities: parseCapabilityVersions(
			input.capabilities,
			'host capabilities',
		),
	});
}

function parseCapabilityVersions(
	value: unknown,
	name: string,
): TerminayHostCapabilityVersions {
	const input = record(value, name);
	const output: Partial<Record<TerminayHostCapability, number>> = {};
	for (const [key, raw] of Object.entries(input)) {
		if (!CAPABILITY_NAMES.has(key))
			throw new TypeError(`${name} contains an unknown capability`);
		output[key as TerminayHostCapability] = version(
			raw,
			`${key} capability version`,
		);
	}
	return Object.freeze(output);
}

function parseCapabilityRanges(
	value: unknown,
	name: string,
): Readonly<Partial<Record<TerminayHostCapability, TerminayVersionRange>>> {
	const input = record(value, name);
	const output: Partial<Record<TerminayHostCapability, TerminayVersionRange>> =
		{};
	for (const [key, raw] of Object.entries(input)) {
		if (!CAPABILITY_NAMES.has(key))
			throw new TypeError(`${name} contains an unknown capability`);
		output[key as TerminayHostCapability] = parseVersionRange(
			raw,
			`${key} capability range`,
		);
	}
	return Object.freeze(output);
}

function parseVersionRange(value: unknown, name: string): TerminayVersionRange {
	const input = record(value, name);
	exactKeys(input, ['minimum', 'maximum'], name);
	const minimum = version(input.minimum, `${name} minimum`);
	const maximum = version(input.maximum, `${name} maximum`);
	if (maximum < minimum) throw new TypeError(`${name} is inverted`);
	return Object.freeze({ minimum, maximum });
}

function compareVersion(
	component: TerminayHostCompatibilityFailure['component'],
	required: TerminayVersionRange,
	actual: number,
	capability?: TerminayHostCapability,
): TerminayHostCompatibilityFailure | undefined {
	if (actual >= required.minimum && actual <= required.maximum)
		return undefined;
	return Object.freeze({
		compatible: false,
		component,
		code: actual < required.minimum ? 'below-minimum' : 'above-maximum',
		...(capability === undefined ? {} : { capability }),
		required,
		actual,
	});
}

function version(value: unknown, name: string): number {
	if (
		!Number.isSafeInteger(value) ||
		(value as number) < 1 ||
		(value as number) > MAX_VERSION
	)
		throw new TypeError(`${name} is invalid`);
	return value as number;
}

function identifier(value: unknown, name: string, pattern: RegExp): string {
	if (typeof value !== 'string' || !pattern.test(value))
		throw new TypeError(`${name} is invalid`);
	return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError(`${name} must be an object`);
	return value as Record<string, unknown>;
}

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	name: string,
): void {
	const keys = Object.keys(value);
	if (
		keys.length !== expected.length ||
		keys.some((key) => !expected.includes(key))
	)
		throw new TypeError(`${name} fields are invalid`);
}

function exactOptionalKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[],
	name: string,
): void {
	const keys = Object.keys(value);
	if (
		required.some((key) => !keys.includes(key)) ||
		keys.some((key) => !required.includes(key) && !optional.includes(key))
	)
		throw new TypeError(`${name} fields are invalid`);
}

function boundedText(
	value: unknown,
	name: string,
	maximum: number,
	allowEmpty = false,
): string {
	if (
		typeof value !== 'string' ||
		(!allowEmpty && value.trim().length === 0) ||
		value.length > maximum ||
		hasControlCharacter(value)
	)
		throw new TypeError(`${name} is invalid`);
	return value;
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return (
			(code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
			code === 0x7f
		);
	});
}

function routePath(value: unknown): string {
	const route = boundedText(value, 'route', 2_048);
	if (
		!route.startsWith('/') ||
		route.startsWith('//') ||
		route.includes('\\') ||
		route.includes('\0') ||
		/^[a-z][a-z0-9+.-]*:/iu.test(route)
	)
		throw new TypeError('route is invalid');
	const parsed = new URL(route, 'https://terminay.invalid');
	if (
		parsed.origin !== 'https://terminay.invalid' ||
		parsed.username ||
		parsed.password
	)
		throw new TypeError('route is invalid');
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function safeExternalUrl(value: unknown): string {
	const raw = boundedText(value, 'external URL', 16_384);
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new TypeError('external URL is invalid');
	}
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
		throw new TypeError('external URL is invalid');
	return parsed.toString();
}

function stringList(
	value: unknown,
	name: string,
	maximumItems: number,
	maximumLength: number,
): readonly string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > maximumItems
	)
		throw new TypeError(`${name} is invalid`);
	const output = value.map((item) => boundedText(item, name, maximumLength));
	if (new Set(output).size !== output.length)
		throw new TypeError(`${name} contains duplicates`);
	return Object.freeze(output);
}

function copyByteArray(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (!ArrayBuffer.isView(value) || value.buffer instanceof SharedArrayBuffer)
		return undefined;
	return new Uint8Array(
		value.buffer,
		value.byteOffset,
		value.byteLength,
	).slice();
}
