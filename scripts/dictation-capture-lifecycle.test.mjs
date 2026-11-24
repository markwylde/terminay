import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const directory = await mkdtemp(
	join(process.cwd(), '.dictation-capture-test-'),
);
test.after(() => rm(directory, { recursive: true, force: true }));
const output = join(directory, 'controller.cjs');
await build({
	entryPoints: ['src/workspace/useDictationController.ts'],
	outfile: output,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react', 'react-dom'],
	logLevel: 'silent',
});
const { useDictationController } = createRequire(import.meta.url)(output);

function globalValue(t, key, value) {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
	Object.defineProperty(globalThis, key, { configurable: true, value });
	t.after(() => {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	});
}

for (const failure of ['disclosure', 'audio-context']) {
	test(`failed ${failure} setup releases the microphone and audio context`, async (t) => {
		let stopped = 0;
		let closed = 0;
		let error;
		const track = { stop: () => stopped++ };
		globalValue(t, 'navigator', {
			mediaDevices: {
				getUserMedia: async () => ({
					getTracks: () => [track],
					getAudioTracks: () => [track],
				}),
			},
		});
		globalValue(
			t,
			'MediaRecorder',
			class {
				static isTypeSupported() {
					return true;
				}
				mimeType = 'audio/webm';
			},
		);
		globalValue(
			t,
			'AudioContext',
			class {
				async resume() {
					throw new Error('audio context refused');
				}
				async close() {
					closed++;
				}
			},
		);
		const endpointUrl =
			failure === 'disclosure' ? 'file:///tmp/stt' : 'https://custom/stt';
		let controller;
		function Harness() {
			controller = useDictationController({
				aiClient: { transcribe: () => assert.fail('must not upload') },
				closeLauncher() {},
				getActiveSessionId: () => 'session-a',
				getSettings: () => ({
					enabled: true,
					provider: 'openai-compatible',
					endpointUrl,
					customModel: 'profile:custom',
					microphoneDeviceId: '',
					maxDurationSeconds: 30,
				}),
				getDisclosure: () => ({
					serverLabel: 'Server',
					provider: 'openai-compatible',
					audioDestination: 'custom-provider',
					endpointUrl,
					expectedConfiguration: 'custom',
					confirmed: true,
					credentialStatus: 'not-configured',
				}),
				getTargetIdentity: () => ({
					serverId: 'server-a',
					projectId: 'project-a',
					panelId: 'panel-a',
					sessionId: 'session-a',
				}),
				setErrorText: (value) => {
					error = value;
				},
			});
			return null;
		}
		renderToStaticMarkup(React.createElement(Harness));
		await controller.start();
		assert.match(
			error,
			failure === 'disclosure'
				? /configuration is invalid/
				: /audio context refused/,
		);
		assert.equal(stopped, 1);
		assert.equal(closed, failure === 'audio-context' ? 1 : 0);
		assert.equal(controller.streamRef.current, null);
		assert.equal(controller.audioContextRef.current, null);
	});
}
