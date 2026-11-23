import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const directory = await mkdtemp(join(tmpdir(), 'terminay-video-'));
const bundle = join(directory, 'harness.js');
await build({
	entryPoints: ['scripts/bot-video-harness.tsx'],
	bundle: true,
	format: 'esm',
	jsx: 'automatic',
	outfile: bundle,
	loader: { '.css': 'empty' },
});
const browser = await chromium.launch({ headless: true });
test.after(async () => {
	await browser.close();
	await rm(directory, { recursive: true, force: true });
});

async function open(t) {
	const page = await browser.newPage();
	t.after(() => page.close());
	await page.setContent('<div id="root"></div>');
	await page.evaluate(async () => {
		const state = { requests: [], created: [], revoked: [] };
		window.__video = state;
		window.IntersectionObserver = class {
			constructor(callback) {
				state.intersect = (near) => callback([{ isIntersecting: near }]);
			}
			observe() {}
			disconnect() {}
		};
		const create = URL.createObjectURL.bind(URL),
			revoke = URL.revokeObjectURL.bind(URL);
		URL.createObjectURL = (blob) => {
			const url = create(blob);
			state.created.push(url);
			return url;
		};
		URL.revokeObjectURL = (url) => {
			state.revoked.push(url);
			revoke(url);
		};
		// A playable fixture keeps lifecycle tests independent of decode errors.
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 32;
		const stream = canvas.captureStream(10);
		const recorder = new MediaRecorder(stream, {
			mimeType: 'video/webm;codecs=vp8',
		});
		const chunks = [];
		recorder.ondataavailable = (event) => chunks.push(event.data);
		const stopped = new Promise((resolve) => {
			recorder.onstop = resolve;
		});
		recorder.start();
		canvas.getContext('2d').fillRect(0, 0, 32, 32);
		await new Promise((resolve) => setTimeout(resolve, 200));
		recorder.stop();
		await stopped;
		for (const track of stream.getTracks()) track.stop();
		state.bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
		state.resolve = (index, mime = 'video/webm') =>
			state.requests[index].resolve({ result: { mime }, body: state.bytes });
	});
	await page.addScriptTag({ path: bundle, type: 'module' });
	await page.waitForFunction(() => !!window.__video.intersect);
	return page;
}
const requests = (page, count) =>
	page.waitForFunction((n) => window.__video.requests.length === n, count);

test('video waits for the viewport, releases and reloads, and discards a late unmounted response', async (t) => {
	const page = await open(t);
	await page.evaluate(() => window.__video.intersect(false));
	assert.equal(await page.evaluate(() => window.__video.requests.length), 0);
	await page.evaluate(() => window.__video.intersect(true));
	await requests(page, 1);
	assert.deepEqual(
		await page.evaluate(() => window.__video.requests[0].payload),
		{ botId: 'birdbot00001', attachmentId: 'a'.repeat(24) },
	);
	await page.evaluate(() => window.__video.resolve(0));
	await page.waitForFunction(
		() => document.querySelector('video')?.readyState >= 1,
	);
	await page.evaluate(() => window.__video.intersect(false));
	await page.waitForFunction(
		() =>
			window.__video.revoked.length === 1 && !document.querySelector('video'),
	);
	assert.equal(
		await page.evaluate(() => window.__video.requests[0].signal.aborted),
		true,
	);
	await page.evaluate(() => window.__video.intersect(true));
	await requests(page, 2);
	await page.evaluate(() => window.__video.resolve(1));
	await page.waitForFunction(
		() => document.querySelector('video')?.readyState >= 1,
	);
	await page.evaluate(() => window.__video.intersect(false));
	await page.waitForFunction(() => window.__video.revoked.length === 2);
	await page.evaluate(() => window.__video.intersect(true));
	await requests(page, 3);
	await page.evaluate(() => {
		window.__video.unmount();
		window.__video.resolve(2);
	});
	await page.waitForFunction(() => window.__video.requests[2].signal.aborted);
	assert.deepEqual(
		await page.evaluate(() => [
			window.__video.created.length,
			window.__video.revoked.length,
		]),
		[2, 2],
	);
});

for (const failure of ['non-video', 'load', 'decode']) {
	test(`video ${failure} failure keeps the download chip without a broken player`, async (t) => {
		const page = await open(t);
		await page.evaluate(() => window.__video.intersect(true));
		await requests(page, 1);
		await page.evaluate((failure) => {
			const state = window.__video;
			if (failure === 'load')
				state.requests[0].reject(new Error('Read refused'));
			else {
				if (failure === 'decode') state.bytes = new Uint8Array([1, 2, 3]);
				state.resolve(
					0,
					failure === 'non-video' ? 'application/octet-stream' : 'video/webm',
				);
			}
		}, failure);
		await page.waitForFunction(
			() => !document.querySelector('[data-terminay-bot-video]'),
		);
		assert.equal(
			await page.locator('[data-terminay-bot-file-chip="clip.webm"]').count(),
			1,
		);
		assert.equal(await page.locator('video').count(), 0);
		assert.equal(
			await page.evaluate(() => window.__video.created.length),
			failure === 'decode' ? 1 : 0,
		);
		assert.deepEqual(
			await page.evaluate(() => window.__video.revoked),
			await page.evaluate(() => window.__video.created),
		);
	});
}
