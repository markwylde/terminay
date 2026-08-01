import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-runtime-root-'));
const output = join(directory, 'desktopWebRtcRuntimeRoot.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/remote/desktopWebRtcRuntimeRoot.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const { resolveDesktopWebRtcRuntimeRoot } = await import(
	pathToFileURL(output).href
);
test.after(async () => rm(directory, { force: true, recursive: true }));

test('packaged Desktop resolves only its immutable extraResources runtime', () => {
	assert.equal(
		resolveDesktopWebRtcRuntimeRoot({
			environment: {
				TERMINAY_WEBRTC_RUNTIME_ROOT: '/tmp/untrusted-override',
			},
			isPackaged: true,
			resourcesPath: '/Applications/Terminay.app/Contents/Resources',
		}),
		'/Applications/Terminay.app/Contents/Resources/webrtc-runtime',
	);
});

test('development requires an explicit absolute selected-runtime root', () => {
	assert.equal(
		resolveDesktopWebRtcRuntimeRoot({
			environment: {},
			isPackaged: false,
			resourcesPath: '/tmp/terminay-resources',
		}),
		undefined,
	);
	assert.equal(
		resolveDesktopWebRtcRuntimeRoot({
			environment: {
				TERMINAY_WEBRTC_RUNTIME_ROOT: '/tmp/staged-selected-runtime',
			},
			isPackaged: false,
			resourcesPath: '/tmp/terminay-resources',
		}),
		'/tmp/staged-selected-runtime',
	);
	assert.throws(
		() =>
			resolveDesktopWebRtcRuntimeRoot({
				environment: { TERMINAY_WEBRTC_RUNTIME_ROOT: './artifact' },
				isPackaged: false,
				resourcesPath: '/tmp/terminay-resources',
			}),
		/must be an absolute runtime directory/u,
	);
});
