import assert from 'node:assert/strict';
import test from 'node:test';
import {
	authorizeTerminayHostActionRequest,
	createTerminayHostBytePacket,
	evaluateTerminayBundleCompatibility,
	evaluateTerminayHostCompatibility,
	parseTerminayHostAction,
	parseTerminayHostActionRequest,
	parseTerminayHostBytePacket,
	parseTerminayHostCompatibilityRequirements,
	parseTerminayHostContext,
	parseTerminayHostEvent,
} from '../dist/index.js';

const requirements = {
	bootstrap: { minimum: 1, maximum: 1 },
	bundleFormat: { minimum: 1, maximum: 1 },
	hostBridge: { minimum: 1, maximum: 2 },
	byteEndpoint: { minimum: 1, maximum: 1 },
	requiredCapabilities: { clipboardWrite: { minimum: 1, maximum: 1 } },
	optionalCapabilities: { nativeWindows: { minimum: 1, maximum: 2 } },
};

test('host context is closed, immutable, and cannot select Electron mode', () => {
	const context = parseTerminayHostContext({
		schemaVersion: 1,
		bootstrapVersion: 1,
		sourceId: 'source-a',
		windowId: 'window-a',
		serverId: 'server-a',
		profileId: 'profile-a',
		bundleId: 'bundle_12345678',
		applicationProtocolVersion: '1',
		hostKind: 'desktop',
		hostBridgeVersion: 1,
		byteEndpointVersion: 1,
		capabilities: { nativeWindows: 1, clipboardWrite: 1 },
	});
	assert.equal(context.hostKind, 'desktop');
	assert.equal(context.capabilities.nativeWindows, 1);
	assert.equal(Object.isFrozen(context), true);
	assert.equal(Object.isFrozen(context.capabilities), true);
	assert.throws(
		() => parseTerminayHostContext({ ...context, mode: 'electron' }),
		/fields are invalid/u,
	);
	assert.throws(
		() =>
			parseTerminayHostContext({ ...context, capabilities: { rootShell: 1 } }),
		/unknown capability/u,
	);
});

test('host menu events are closed and bound to their negotiated context', () => {
	const context = parseTerminayHostContext({
		schemaVersion: 1,
		bootstrapVersion: 1,
		sourceId: 'source-a',
		windowId: 'window-a',
		serverId: 'server-a',
		profileId: 'profile-a',
		bundleId: 'bundle_12345678',
		applicationProtocolVersion: '1',
		hostKind: 'desktop',
		hostBridgeVersion: 1,
		byteEndpointVersion: 1,
		capabilities: { nativeMenus: 1 },
	});
	const event = parseTerminayHostEvent(
		{
			schemaVersion: 1,
			bridgeVersion: 1,
			sourceId: 'source-a',
			windowId: 'window-a',
			profileId: 'profile-a',
			serverId: 'server-a',
			event: { type: 'menu.command', command: 'open-settings' },
		},
		context,
	);
	assert.equal(event.event.command, 'open-settings');
	assert.equal(Object.isFrozen(event), true);
	assert.equal(Object.isFrozen(event.event), true);
	assert.throws(
		() => parseTerminayHostEvent({ ...event, windowId: 'window-b' }, context),
		/outside its binding/u,
	);
	assert.throws(
		() =>
			parseTerminayHostEvent(
				{ ...event, event: { type: 'menu.command', command: 'open-devtools' } },
				context,
			),
		/menu command is invalid/u,
	);
	const zoom = parseTerminayHostEvent(
		{
			...event,
			event: { type: 'terminal.zoom', zoomLevel: 3 },
		},
		context,
	);
	assert.deepEqual(zoom.event, { type: 'terminal.zoom', zoomLevel: 3 });
	for (const zoomLevel of [-6, 1.5, 11, '3']) {
		assert.throws(
			() =>
				parseTerminayHostEvent(
					{
						...event,
						event: { type: 'terminal.zoom', zoomLevel },
					},
					context,
				),
			/zoom level is invalid/u,
		);
	}
});

test('host compatibility separates required failures from optional degradation', () => {
	const compatible = evaluateTerminayHostCompatibility(requirements, {
		bootstrapVersion: 1,
		bundleFormatVersion: 1,
		hostBridgeVersion: 1,
		byteEndpointVersion: 1,
		capabilities: { clipboardWrite: 1 },
	});
	assert.deepEqual(compatible, {
		compatible: true,
		unavailableOptionalCapabilities: ['nativeWindows'],
	});

	const missing = evaluateTerminayHostCompatibility(requirements, {
		bootstrapVersion: 1,
		bundleFormatVersion: 1,
		hostBridgeVersion: 1,
		byteEndpointVersion: 1,
		capabilities: {},
	});
	assert.deepEqual(missing, {
		compatible: false,
		component: 'host-capability',
		code: 'missing-capability',
		capability: 'clipboardWrite',
		required: { minimum: 1, maximum: 1 },
	});

	assert.throws(
		() => parseTerminayHostCompatibilityRequirements({ ...requirements, executionRuntime: { minimum: 1, maximum: 1 } }),
		/fields are invalid/u,
	);
});

test('workspace drag actions and state are closed logical-view contracts', () => {
	const context = parseTerminayHostContext({
		schemaVersion: 1,
		bootstrapVersion: 1,
		sourceId: 'source-a',
		windowId: 'window-a',
		serverId: 'server-a',
		profileId: 'profile-a',
		bundleId: 'bundle_12345678',
		applicationProtocolVersion: '1',
		hostKind: 'desktop',
		hostBridgeVersion: 1,
		byteEndpointVersion: 1,
		capabilities: { nativeWindows: 1 },
	});
	assert.deepEqual(
		parseTerminayHostAction({
			type: 'workspace.drag.start',
			viewId: 'view-a',
			preview: { title: 'Project', emoji: '', color: '#123abc', width: 160 },
		}),
		{
			type: 'workspace.drag.start',
			viewId: 'view-a',
			preview: { title: 'Project', emoji: '', color: '#123abc', width: 160 },
		},
	);
	assert.deepEqual(parseTerminayHostAction({ type: 'workspace.drag.end' }), {
		type: 'workspace.drag.end',
	});
	const envelope = {
		schemaVersion: 1,
		bridgeVersion: 1,
		sourceId: 'source-a',
		windowId: 'window-a',
		profileId: 'profile-a',
		serverId: 'server-a',
		event: { type: 'workspace.drag-state', active: true },
	};
	assert.deepEqual(
		parseTerminayHostEvent(envelope, context).event,
		envelope.event,
	);
	assert.throws(
		() =>
			parseTerminayHostAction({
				type: 'workspace.drag.start',
				viewId: 'view-a',
				targetWindowId: 42,
				preview: { title: 'Project', emoji: '', color: '#123abc', width: 160 },
			}),
		/fields are invalid/u,
	);
	assert.throws(
		() =>
			parseTerminayHostAction({
				type: 'workspace.drag.start',
				viewId: 'view-a',
				preview: { title: 'Project', emoji: '', color: '#123abc', width: 79 },
			}),
		/preview is invalid/u,
	);
	assert.throws(
		() =>
			parseTerminayHostEvent(
				{
					...envelope,
					event: { ...envelope.event, geometry: { x: 0, y: 0 } },
				},
				context,
			),
		/fields are invalid/u,
	);
});

test('semantic host actions are closed and exact-binding/gesture checked', () => {
	const context = parseTerminayHostContext({
		schemaVersion: 1,
		bootstrapVersion: 1,
		sourceId: 'source-a',
		windowId: 'window-a',
		serverId: 'server-a',
		profileId: 'profile-a',
		bundleId: 'bundle_12345678',
		applicationProtocolVersion: '1',
		hostKind: 'desktop',
		hostBridgeVersion: 1,
		byteEndpointVersion: 1,
		capabilities: { nativeWindows: 1, clipboardWrite: 1 },
	});
	const request = parseTerminayHostActionRequest(
		{
			schemaVersion: 1,
			bridgeVersion: 1,
			sourceId: 'source-a',
			windowId: 'window-a',
			profileId: 'profile-a',
			serverId: 'server-a',
			userGesture: true,
			action: {
				type: 'route.present',
				route: '/settings?section=terminal',
				disposition: 'native-window',
			},
		},
		context,
	);
	assert.equal(request.action.type, 'route.present');
	assert.throws(
		() => parseTerminayHostAction({ type: 'clipboard.read' }),
		/not allowed/u,
	);
	assert.throws(
		() =>
			parseTerminayHostAction({
				type: 'route.present',
				route: '/settings',
				disposition: 'native-window',
				browserWindow: {},
			}),
		/fields are invalid/u,
	);
	assert.throws(
		() =>
			parseTerminayHostActionRequest(
				{ ...request, userGesture: false },
				context,
			),
		/user gesture/u,
	);
	assert.throws(
		() =>
			parseTerminayHostActionRequest(
				{ ...request, serverId: 'server-b' },
				context,
			),
		/outside its binding/u,
	);
	assert.throws(
		() =>
			authorizeTerminayHostActionRequest(
				{ ...request, action: { type: 'clipboard.write', text: 'hello' } },
				{ ...context, capabilities: {} },
			),
		/capability is unavailable/u,
	);
	assert.equal(
		authorizeTerminayHostActionRequest(
			{ ...request, action: { type: 'clipboard.write', text: 'hello' } },
			context,
		).action.type,
		'clipboard.write',
	);
});

test('native menu accelerator updates are bounded and immutable', () => {
	const action = parseTerminayHostAction({
		type: 'menu.accelerators.update',
		accelerators: [
			{ command: 'new-terminal', accelerator: 'CmdOrCtrl+Y' },
			{ command: 'open-settings', accelerator: '' },
		],
	});
	assert.deepEqual(action, {
		type: 'menu.accelerators.update',
		accelerators: [
			{ command: 'new-terminal', accelerator: 'CmdOrCtrl+Y' },
			{ command: 'open-settings', accelerator: '' },
		],
	});
	assert.equal(Object.isFrozen(action.accelerators), true);
	assert.throws(
		() =>
			parseTerminayHostAction({
				type: 'menu.accelerators.update',
				accelerators: [
					{ command: 'new-terminal', accelerator: 'CmdOrCtrl+Y' },
					{ command: 'new-terminal', accelerator: 'CmdOrCtrl+T' },
				],
			}),
		/unique/u,
	);
});

test('device settings use a closed host action and bound event snapshot', () => {
	const settings = { keyboardShortcuts: { 'new-terminal': 'CmdOrCtrl+Y' } };
	assert.deepEqual(parseTerminayHostAction({
		type: 'device.settings.update',
		settings,
	}), { type: 'device.settings.update', settings });
	assert.throws(
		() => parseTerminayHostAction({ type: 'device.settings.update', settings: [] }),
		/device settings/u,
	);
	const context = parseTerminayHostContext({
		schemaVersion: 1, bootstrapVersion: 1, sourceId: 'source-a',
		windowId: 'window-a', serverId: 'server-a', profileId: 'profile-a',
		bundleId: 'bundle_12345678', applicationProtocolVersion: '1',
		hostKind: 'desktop', hostBridgeVersion: 1, byteEndpointVersion: 1,
		capabilities: { nativeMenus: 1 },
	});
	assert.deepEqual(parseTerminayHostEvent({
		schemaVersion: 1, bridgeVersion: 1, sourceId: 'source-a',
		windowId: 'window-a', serverId: 'server-a', profileId: 'profile-a',
		event: { type: 'device.settings.changed', settings },
	}, context).event, { type: 'device.settings.changed', settings });
});

test('host compatibility rejects ambiguous and unknown capability requirements', () => {
	assert.throws(
		() =>
			parseTerminayHostCompatibilityRequirements({
				...requirements,
				optionalCapabilities: { clipboardWrite: { minimum: 1, maximum: 1 } },
			}),
		/both required and optional/u,
	);
	assert.throws(
		() =>
			parseTerminayHostCompatibilityRequirements({
				...requirements,
				requiredCapabilities: { arbitraryIpc: { minimum: 1, maximum: 1 } },
			}),
		/unknown capability/u,
	);
});

test('opaque host byte packets bind immutable bytes to one exact server', () => {
	const source = new Uint8Array([1, 2, 3]);
	const packet = createTerminayHostBytePacket('server-a', source);
	source[0] = 9;
	assert.deepEqual([...packet.frame], [1, 2, 3]);
	const parsed = parseTerminayHostBytePacket(packet, 'server-a');
	packet.frame[1] = 8;
	assert.deepEqual([...parsed.frame], [1, 2, 3]);
	assert.throws(
		() => parseTerminayHostBytePacket(packet, 'server-b'),
		/another server/u,
	);
	assert.throws(
		() =>
			parseTerminayHostBytePacket(
				{ ...packet, operation: 'workspace.create' },
				'server-a',
			),
		/fields are invalid/u,
	);
});

test('opaque byte packets preserve unknown future application operations unchanged', () => {
	const futureFrame = new TextEncoder().encode(
		JSON.stringify({
			operation: 'future.workspace.teleport',
			payload: { revision: 9001, destination: 'unknown-to-this-host' },
		}),
	);
	const packet = parseTerminayHostBytePacket(
		createTerminayHostBytePacket('server-a', futureFrame),
		'server-a',
	);
	assert.deepEqual(packet.frame, futureFrame);
});

test('browser-safe bundle compatibility accepts the canonical manifest wire shape', () => {
	const manifest = {
		schemaVersion: 1,
		bundleId: 'bundle_12345678',
		entryPath: '/remote-app/bundle_12345678/index.html',
		protocolVersion: '1',
		serverVersion: '3.0.0',
		contentSecurityPolicy: "default-src 'self'",
		bundleFormatVersion: 1,
		hostCompatibility: requirements,
		assets: [
			{
				path: '/remote-app/bundle_12345678/index.html',
				size: 1,
				hash: 'x',
				contentType: 'text/html',
			},
		],
	};
	const bootstrap = {
		schemaVersion: 1,
		bootstrapVersion: 1,
		sourceId: 'source-a',
		windowId: 'window-a',
		serverId: 'server-a',
		profileId: 'profile-a',
		bundleId: manifest.bundleId,
		applicationProtocolVersion: '1',
		hostKind: 'browser',
		hostBridgeVersion: 1,
		byteEndpointVersion: 1,
		capabilities: { clipboardWrite: 1 },
	};
	assert.deepEqual(
		evaluateTerminayBundleCompatibility(manifest, bootstrap, {
			bootstrapVersion: 1,
			bundleFormatVersion: 1,
			hostBridgeVersion: 1,
			byteEndpointVersion: 1,
			capabilities: { clipboardWrite: 1 },
		}),
		{ compatible: true, unavailableOptionalCapabilities: ['nativeWindows'] },
	);
});
