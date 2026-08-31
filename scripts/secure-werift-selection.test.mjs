import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createReleaseManifest,
	inspectReleaseInputs,
} from './release-readiness.mjs';
import { stageSelectedSecureWeriftRuntime } from './stage-selected-secure-werift-runtime.mjs';

test('release evidence binds the exact fail-closed Secure-Werift selection', async () => {
	const inputs = await inspectReleaseInputs();
	const selection = inputs.webrtcRuntimeSelection;
	assert.equal(selection.runtime, 'secure-werift');
	assert.equal(selection.upstream.npmPackage, 'werift@0.24.1');
	assert.equal(selection.package.version, '0.24.1-candidate.1');
	// Every governed patch, in the order the build applies it. Order matters:
	// later hunks are located against the output of the earlier ones.
	assert.deepEqual(selection.patches, [
		{
			path: 'scripts/patches/werift-0.24.1-abort-turn-refresh.patch',
			purpose:
				'Abort the pending TURN allocation refresh timer during peer close.',
			sha256:
				'34ea60bd991256adb2cd50bfe0ef9011cfc79054aff686b9ec35ef4703de4211',
		},
		{
			path: 'scripts/patches/werift-0.24.1-sctp-zero-window-probe.patch',
			purpose:
				'Probe a zero receive window and serialize data-channel flush so outbound delivery cannot deadlock.',
			sha256:
				'298aa1ebb0f0eb45c673dd24907e7e8110bfef499524993d8203fd74ecaa6b2b',
		},
	]);
	assert.equal(selection.runtimePolicy.fallback, 'disabled');
	assert.equal(selection.runtimePolicy.legacyNodeDataChannelFallback, false);
	assert.equal(
		createReleaseManifest(inputs, { packages: [] }).webrtcRuntime,
		selection,
	);
});

test('Desktop packaging carries the selection and staged runtime resource root', async () => {
	const builder = await readFile('electron-builder.json5', 'utf8');
	assert.match(builder, /"from": "build\/webrtc-runtime"/u);
	assert.match(builder, /"to": "webrtc-runtime"/u);
});

test('opt-in Chromium integration proof imports the staged selected artifact layout', async () => {
	const proof = await readFile(
		'scripts/production-headless-webrtc-secure-werift.test.mjs',
		'utf8',
	);
	// The browser-side proof moved into the compatibility runner when the
	// canonical pairing/reconnect flow replaced the standalone Playwright spec.
	const browser = await readFile('scripts/webrtc-compatibility-proof.mjs', 'utf8');
	assert.match(proof, /staged-selected-runtime/u);
	assert.match(proof, /TERMINAY_WEBRTC_STAGED_RUNTIME_ROOT/u);
	assert.match(proof, /TERMINAY_RUN_SIBLING_WEBRTC_BRIDGE_PROOF/u);
	assert.match(proof, /sibling peer-owner canonical browser bridge proof/u);
	assert.match(browser, /TERMINAY_WEBRTC_STAGED_RUNTIME_ROOT/u);
	assert.match(browser, /TERMINAY_WEBRTC_SELECTED_RUNTIME_ROOT/u);
});

test(
	'selected runtime staging produces a complete loader-ready root',
	{ timeout: 360_000 },
	async (context) => {
		const root = await mkdtemp(
			join(tmpdir(), 'terminay-selected-werift-stage-'),
		);
		context.after(() => rm(root, { force: true, recursive: true }));
		const staged = await stageSelectedSecureWeriftRuntime(root);
		const selection = JSON.parse(
			await readFile(join(root, 'selection.json'), 'utf8'),
		);
		const packageJson = JSON.parse(
			await readFile(join(root, 'artifact', 'package.json'), 'utf8'),
		);
		assert.equal(staged.destination, root);
		assert.equal(staged.package, '@terminay/werift-runtime-proof@0.24.1-candidate.1');
		assert.deepEqual(selection.package, {
			name: packageJson.name,
			version: packageJson.version,
		});
		assert.equal(
			selection.patches[0].sha256,
			'34ea60bd991256adb2cd50bfe0ef9011cfc79054aff686b9ec35ef4703de4211',
		);
		const reused = await stageSelectedSecureWeriftRuntime(root, {
			reuseValidated: true,
		});
		assert.equal(reused.reusedValidatedArtifact, true);
		assert.equal(reused.archiveSha256, staged.archiveSha256);
		assert.deepEqual(reused.fileHashes, staged.fileHashes);
	},
);
