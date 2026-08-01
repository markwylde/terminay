import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(
	new URL('../src/rendererRuntime.tsx', import.meta.url),
	'utf8',
);
const entrySource = await readFile(
	new URL('../src/shared/ResponsiveWorkspaceEntry.tsx', import.meta.url),
	'utf8',
);

test('production renderer entry activates the shared responsive route boundary', () => {
	assert.match(
		mainSource,
		/import\s*\{[\s\S]*ResponsiveWorkspaceEntry[\s\S]*sharedRouteForView[\s\S]*\}\s*from\s+'\.\/shared\/ResponsiveWorkspaceEntry\.tsx'/u,
	);
	assert.match(
		mainSource,
		/const\s+sharedRoute\s*=\s*sharedRouteForView\(view\)/u,
	);
	assert.match(mainSource, /window\.terminayHost\s*\?\s*\.getContext\(\)/u);
	assert.match(
		mainSource,
		/<ResponsiveWorkspaceEntry[\s\S]*route=\{sharedRoute\}[\s\S]*capabilities=\{hostCapabilities\}[\s\S]*legacyFallback=\{legacyContent\}/u,
	);
	assert.match(
		mainSource,
		/\{sharedRoute\s*===\s*undefined\s*\?\s*\(\s*legacyContent/u,
	);
	assert.doesNotMatch(entrySource, /nativeWindows:\s*true/u);
	assert.match(
		entrySource,
		/createSharedWorkspaceRouteEntries\(createHostCapabilityProvider\(capabilities\)\)/u,
	);
	assert.match(entrySource, /data-shared-ui="responsive-workspace"/u);
	assert.match(entrySource, /data-shared-route-registry=/u);
	assert.match(entrySource, /legacyFallback/u);
});

test('unsupported legacy views retain the direct fallback path without a hidden WebRTC host', () => {
	assert.doesNotMatch(mainSource, /WebRtcHost|webrtc-host|Suspense/u);
	assert.match(
		mainSource,
		/\{sharedRoute\s*===\s*undefined\s*\?\s*\(\s*legacyContent/u,
	);
});

test('Desktop recording auxiliary renders from an application-only server client', () => {
	assert.match(
		mainSource,
		/const applicationOnlyViews = new Set\(\['settings', 'macros', 'recordings'\]\)/u,
	);
	assert.match(
		mainSource,
		/connectRendererApplicationClient\(message\.serverId, undefined/u,
	);
	assert.match(
		mainSource,
		/case\s+'recordings':[\s\S]*<RecordingsWindow client=\{serverRecordingsClient\}/u,
	);
});
