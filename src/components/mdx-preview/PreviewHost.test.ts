import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DesktopPreviewHost,
	SandboxedWebPreviewHost,
	UnavailablePreviewHost,
	previewCapabilityForOrigin,
	previewCombinesScriptsAndSameOriginOn,
} from './PreviewHost.ts';

function assertHostCapabilities(host: {
	readonly capability: {
		readonly available: boolean;
		readonly dedicatedOrigin: boolean;
		readonly persistentStorage: boolean;
		readonly governedDownloads: boolean;
		readonly isolatedExecution: boolean;
		readonly sandbox: string;
	};
}) {
	assert.equal(host.capability.available, true);
	assert.equal(host.capability.persistentStorage, true);
	assert.equal(host.capability.governedDownloads, true);
	assert.equal(host.capability.isolatedExecution, true);
	assert.match(host.capability.sandbox, /allow-scripts/u);
	assert.equal(
		previewCombinesScriptsAndSameOriginOn(
			host.capability,
			'https://app.terminay.local',
			null,
		),
		false,
	);
}

test('3.1 Desktop and web hosts pass the same capability suite', () => {
	const frame = { src: 'about:blank' };
	assertHostCapabilities(new DesktopPreviewHost(frame));
	assertHostCapabilities(new SandboxedWebPreviewHost(frame));
	assert.equal(new DesktopPreviewHost(frame).kind, 'desktop');
	assert.equal(new SandboxedWebPreviewHost(frame).kind, 'web');
});

test('3.5 a host without a dedicated origin never combines scripts and same-origin on Terminay', () => {
	const opaque = previewCapabilityForOrigin(null);
	assert.equal(opaque.dedicatedOrigin, false);
	assert.equal(opaque.sandbox.includes('allow-same-origin'), false);
	assert.equal(
		previewCombinesScriptsAndSameOriginOn(
			opaque,
			'https://app.terminay.local',
			null,
		),
		false,
	);
	const unavailable = new UnavailablePreviewHost();
	assert.equal(unavailable.capability.available, false);
	assert.equal(unavailable.capability.sandbox, '');
	assert.equal(
		previewCombinesScriptsAndSameOriginOn(
			unavailable.capability,
			'https://app.terminay.local',
			'https://app.terminay.local',
		),
		false,
	);
});
