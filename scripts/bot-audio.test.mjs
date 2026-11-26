import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const directory = await mkdtemp(join(tmpdir(), 'terminay-audio-'));
const bundle = join(directory, 'harness.js');
await build({
	entryPoints: ['scripts/bot-audio-harness.tsx'],
	bundle: true,
	format: 'esm',
	jsx: 'automatic',
	outfile: bundle,
	loader: { '.css': 'empty' },
});
const browser = await chromium.launch({
	headless: true,
	args: ['--autoplay-policy=no-user-gesture-required'],
});
test.after(async () => {
	await browser.close();
	await rm(directory, { recursive: true, force: true });
});

const song = (id = 'a', name = 'song.wav') => ({
	id: id.repeat(24),
	name,
	mime: 'audio/wav',
	size: 32_044,
});

/** Opens the harness with one React root per entry of `roots`. Observers are
 * faked so tests decide what is near the viewport or hidden. */
async function open(t, roots = [[song()]]) {
	const page = await browser.newPage({ acceptDownloads: true });
	t.after(() => page.close());
	await page.setContent('<!doctype html><html><body></body></html>');
	await page.evaluate((roots) => {
		const state = {
			roots,
			requests: [],
			created: [],
			revoked: [],
			observers: [],
		};
		window.__audio = state;
		window.IntersectionObserver = class {
			constructor(callback) {
				state.observers.push(callback);
			}
			observe() {}
			disconnect() {}
		};
		state.intersect = (index, near, hidden = false) =>
			state.observers[index]([
				{
					isIntersecting: near,
					boundingClientRect: hidden
						? { width: 0, height: 0 }
						: { width: 320, height: 64 },
				},
			]);
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
		// Two seconds of 8 kHz mono 16-bit PCM: decodable by every build.
		const rate = 8000,
			samples = rate * 2,
			bytes = new Uint8Array(44 + samples * 2),
			view = new DataView(bytes.buffer);
		const ascii = (at, text) => {
			for (let i = 0; i < text.length; i++)
				view.setUint8(at + i, text.charCodeAt(i));
		};
		ascii(0, 'RIFF');
		view.setUint32(4, 36 + samples * 2, true);
		ascii(8, 'WAVEfmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, rate, true);
		view.setUint32(28, rate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		ascii(36, 'data');
		view.setUint32(40, samples * 2, true);
		for (let i = 0; i < samples; i++)
			view.setInt16(44 + i * 2, Math.sin(i / 4) * 8000, true);
		state.bytes = bytes;
		state.resolve = (index, mime = 'audio/wav') =>
			state.requests[index].resolve({ result: { mime }, body: state.bytes });
	}, roots);
	await page.addScriptTag({ path: bundle, type: 'module' });
	await page.waitForFunction(
		(count) => window.__audio.observers.length === count,
		roots.flat().length,
	);
	return page;
}
const requests = (page, count) =>
	page.waitForFunction((n) => window.__audio.requests.length === n, count);
const time = (page, name = 'song.wav') =>
	page
		.locator(`[data-terminay-bot-audio="${name}"] .bots-audio__time`)
		.textContent();
/** Loads the player at `index` with request `request` and waits for its
 * duration. */
async function loaded(page, index = 0, request = 0, name = 'song.wav') {
	await page.evaluate((i) => window.__audio.intersect(i, true), index);
	await requests(page, request + 1);
	await page.evaluate((r) => window.__audio.resolve(r), request);
	await page.waitForFunction(
		(name) =>
			document
				.querySelector(`[data-terminay-bot-audio="${name}"] .bots-audio__time`)
				?.textContent.endsWith('/ 0:02'),
		name,
	);
}
const audio = (page, name = 'song.wav') =>
	page.locator(`[data-terminay-bot-audio="${name}"] audio`);
const paused = (page, name = 'song.wav') =>
	audio(page, name).evaluate((el) => el.paused);

test('audio waits for the viewport, releases and reloads, and discards a late unmounted response', async (t) => {
	const page = await open(t);
	assert.equal(await time(page), '0:00 / --:--');
	assert.equal(
		await page.getByRole('slider', { name: 'Seek song.wav' }).isDisabled(),
		true,
	);
	assert.equal(
		await page.getByRole('button', { name: 'Play song.wav' }).isDisabled(),
		true,
	);
	await page.evaluate(() => window.__audio.intersect(0, false));
	assert.equal(await page.evaluate(() => window.__audio.requests.length), 0);
	await loaded(page);
	assert.deepEqual(
		await page.evaluate(() => window.__audio.requests[0].payload),
		{ botId: 'birdbot00001', attachmentId: 'a'.repeat(24) },
	);
	await page.evaluate(() => window.__audio.intersect(0, false));
	await page.waitForFunction(
		() =>
			window.__audio.revoked.length === 1 && !document.querySelector('audio'),
	);
	assert.equal(await time(page), '0:00 / --:--');
	await loaded(page, 0, 1);
	await page.evaluate(() => window.__audio.intersect(0, false));
	await page.waitForFunction(() => window.__audio.revoked.length === 2);
	await page.evaluate(() => window.__audio.intersect(0, true));
	await requests(page, 3);
	await page.evaluate(() => {
		window.__audio.unmount(0);
		window.__audio.resolve(2);
	});
	await page.waitForFunction(() => window.__audio.requests[2].signal.aborted);
	assert.deepEqual(
		await page.evaluate(() => [
			window.__audio.created.length,
			window.__audio.revoked.length,
		]),
		[2, 2],
	);
});

for (const failure of ['non-audio', 'video', 'load', 'decode']) {
	test(`audio ${failure} failure shows the download chip without a broken player`, async (t) => {
		const page = await open(t);
		await page.evaluate(() => window.__audio.intersect(0, true));
		await requests(page, 1);
		await page.evaluate((failure) => {
			const state = window.__audio;
			if (failure === 'load')
				state.requests[0].reject(new Error('Read refused'));
			else {
				if (failure === 'decode') state.bytes = new Uint8Array([1, 2, 3]);
				state.resolve(
					0,
					failure === 'non-audio'
						? 'application/octet-stream'
						: failure === 'video'
							? 'video/webm'
							: 'audio/wav',
				);
			}
		}, failure);
		await page.waitForFunction(
			() => !document.querySelector('[data-terminay-bot-audio]'),
		);
		assert.equal(
			await page.locator('[data-terminay-bot-file-chip="song.wav"]').count(),
			1,
		);
		assert.equal(await page.locator('audio').count(), 0);
		assert.equal(
			await page.evaluate(() => window.__audio.created.length),
			failure === 'decode' ? 1 : 0,
		);
		assert.deepEqual(
			await page.evaluate(() => window.__audio.revoked),
			await page.evaluate(() => window.__audio.created),
		);
	});
}

test('the controls play, pause, seek and show time, from the keyboard', async (t) => {
	const page = await open(t);
	await loaded(page);
	assert.equal(await time(page), '0:00 / 0:02');
	const seek = page.getByRole('slider', { name: 'Seek song.wav' });
	assert.equal(await seek.getAttribute('aria-valuetext'), '0:00 of 0:02');
	// Tab order: download, play/pause, seek.
	await page.getByRole('button', { name: 'Download song.wav' }).focus();
	await page.keyboard.press('Tab');
	assert.equal(
		await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
		'Play song.wav',
	);
	await page.keyboard.press('Space');
	await page.getByRole('button', { name: 'Pause song.wav' }).waitFor();
	await page.waitForFunction(
		() => document.querySelector('audio').currentTime > 0.2,
	);
	await page.keyboard.press('Space');
	await page.getByRole('button', { name: 'Play song.wav' }).waitFor();
	assert.equal(await paused(page), true);
	await page.keyboard.press('Tab');
	assert.equal(
		await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
		'Seek song.wav',
	);
	const before = await audio(page).evaluate((el) => el.currentTime);
	await page.keyboard.press('ArrowRight');
	await page.waitForFunction(
		(before) => document.querySelector('audio').currentTime > before + 0.05,
		before,
	);
	// The seek bar moves playback to its midpoint.
	await seek.fill('1');
	await page.waitForFunction(
		() => Math.abs(document.querySelector('audio').currentTime - 1) < 0.05,
	);
	assert.equal(await time(page), '0:01 / 0:02');
	assert.equal(await seek.getAttribute('aria-valuetext'), '0:01 of 0:02');
	assert.equal(await audio(page).evaluate((el) => el.autoplay), false);
	assert.equal(await audio(page).evaluate((el) => el.loop), false);
	assert.equal(await audio(page).evaluate((el) => el.muted), false);
});

test('a clip that ends returns to play at 0:00', async (t) => {
	const page = await open(t);
	await loaded(page);
	await audio(page).evaluate((el) => {
		el.currentTime = 1.8;
	});
	await page.getByRole('button', { name: 'Play song.wav' }).click();
	await page.getByRole('button', { name: 'Pause song.wav' }).waitFor();
	await page.getByRole('button', { name: 'Play song.wav' }).waitFor();
	assert.equal(await audio(page).evaluate((el) => el.ended || el.paused), true);
	await page.waitForFunction(() =>
		document
			.querySelector('.bots-audio__time')
			?.textContent.startsWith('0:00 /'),
	);
});

test('a refused play leaves the player paused and usable', async (t) => {
	const page = await open(t);
	await loaded(page);
	await page.evaluate(() => {
		const play = HTMLMediaElement.prototype.play;
		window.__restorePlay = () => {
			HTMLMediaElement.prototype.play = play;
		};
		HTMLMediaElement.prototype.play = () =>
			Promise.reject(new DOMException('Refused', 'NotAllowedError'));
	});
	const play = page.getByRole('button', { name: 'Play song.wav' });
	await play.click();
	assert.equal(await play.isEnabled(), true);
	assert.equal(await paused(page), true);
	await page.evaluate(() => window.__restorePlay());
	await play.click();
	await page.getByRole('button', { name: 'Pause song.wav' }).waitFor();
});

test('only one clip plays in the window, across separate Chats', async (t) => {
	const page = await open(t, [[song('a', 'one.wav')], [song('b', 'two.wav')]]);
	await loaded(page, 0, 0, 'one.wav');
	await loaded(page, 1, 1, 'two.wav');
	await page.getByRole('button', { name: 'Play one.wav' }).click();
	await page.getByRole('button', { name: 'Pause one.wav' }).waitFor();
	await page.getByRole('button', { name: 'Play two.wav' }).click();
	await page.getByRole('button', { name: 'Pause two.wav' }).waitFor();
	await page.getByRole('button', { name: 'Play one.wav' }).waitFor();
	assert.equal(await paused(page, 'one.wav'), true);
	assert.equal(await paused(page, 'two.wav'), false);
	// Unmounting the playing Chat leaves no stale claim behind.
	await page.evaluate(() => window.__audio.unmount(1));
	await page.getByRole('button', { name: 'Play one.wav' }).click();
	await page.getByRole('button', { name: 'Pause one.wav' }).waitFor();
	await page.waitForTimeout(300);
	assert.equal(await paused(page, 'one.wav'), false);
});

test('a playing clip keeps playing when scrolled away, and pauses once hidden', async (t) => {
	const page = await open(t);
	await loaded(page);
	await page.getByRole('button', { name: 'Play song.wav' }).click();
	await page.getByRole('button', { name: 'Pause song.wav' }).waitFor();
	// Scrolled far away: no further intersection change will arrive.
	await page.evaluate(() => window.__audio.intersect(0, false));
	await page.waitForTimeout(200);
	assert.equal(await paused(page), false);
	assert.equal(await page.evaluate(() => window.__audio.revoked.length), 0);
	// Its Chat is hidden (a real ResizeObserver sees the player collapse).
	await page.evaluate(() => {
		document.getElementById('root-0').style.display = 'none';
	});
	await page.waitForFunction(
		() =>
			window.__audio.revoked.length === 1 && !document.querySelector('audio'),
	);
	await page.evaluate(() => {
		document.getElementById('root-0').style.display = '';
	});
	await page.getByRole('button', { name: 'Play song.wav' }).waitFor();
});

test('a clip near the viewport pauses when its Chat is hidden', async (t) => {
	const page = await open(t);
	await loaded(page);
	await page.getByRole('button', { name: 'Play song.wav' }).click();
	await page.getByRole('button', { name: 'Pause song.wav' }).waitFor();
	await page.evaluate(() => {
		document.getElementById('root-0').style.display = 'none';
	});
	await page.waitForFunction(() => document.querySelector('audio')?.paused);
});

test('download saves the exact bytes before playback loads, and shows a failure', async (t) => {
	const page = await open(t);
	const download = page.getByRole('button', { name: 'Download song.wav' });
	const saved = page.waitForEvent('download');
	await download.click();
	await requests(page, 1);
	await page.evaluate(() => window.__audio.resolve(0));
	const file = await saved;
	assert.equal(file.suggestedFilename(), 'song.wav');
	assert.deepEqual(
		new Uint8Array(await readFile(await file.path())),
		new Uint8Array(await page.evaluate(() => [...window.__audio.bytes])),
	);
	await download.click();
	await requests(page, 2);
	await page.evaluate(() =>
		window.__audio.requests[1].reject(new Error('Read refused')),
	);
	await page
		.locator('[data-terminay-bot-audio="song.wav"] [role="status"]')
		.filter({ hasText: 'Read refused' })
		.waitFor();
	assert.equal(await download.isEnabled(), true);
	assert.equal(
		await page.locator('[data-terminay-bot-audio="song.wav"]').count(),
		1,
	);
});
