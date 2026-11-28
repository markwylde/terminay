import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DESKTOP_RESIZE_LIMITS,
	RfbClientFilter,
} from '../dist/server/index.js';

const limits = { inputBytes: 4 * 1024 * 1024, clipboardBytes: 1024 * 1024 };

/** SetDesktopSize with `screens` screens, each covering the desktop. */
function resize(width, height, screens = 1) {
	const message = Buffer.alloc(8 + 16 * screens);
	message[0] = 251;
	message.writeUInt16BE(width, 2);
	message.writeUInt16BE(height, 4);
	message[6] = screens;
	for (let i = 0; i < screens; i++) {
		const at = 8 + 16 * i;
		message.writeUInt32BE(7 + i, at);
		message.writeUInt16BE(width, at + 8);
		message.writeUInt16BE(height, at + 10);
	}
	return message;
}
const size = (message) => [
	message.readUInt16BE(2),
	message.readUInt16BE(4),
	message.readUInt16BE(16),
	message.readUInt16BE(18),
];

/** A filter that admits resizes, on a clock the test moves. */
function admitting(mode = 'control') {
	const clock = { now: 0, timers: [] };
	const sent = [];
	const filter = new RfbClientFilter(mode, limits, undefined, {
		limits: DESKTOP_RESIZE_LIMITS,
		now: () => clock.now,
		later: (delayMs, run) => {
			const timer = { at: clock.now + delayMs, run, cancelled: false };
			clock.timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
		send: (message) => sent.push(message),
	});
	const advance = (ms) => {
		clock.now += ms;
		for (const timer of clock.timers.splice(0)) {
			if (timer.cancelled) continue;
			if (timer.at <= clock.now) timer.run();
			else clock.timers.push(timer);
		}
	};
	return { filter, sent, advance, clock };
}

test('a filter without resize admission closes the stream on a resize request, in either mode', () => {
	for (const mode of ['control', 'view-only'])
		assert.throws(
			() => new RfbClientFilter(mode, limits).push(resize(1024, 768)),
			/unknown RFB client message/,
		);
});

test('an in-range resize of one screen passes unchanged in size, with its screen id kept', () => {
	const { filter } = admitting();
	const out = filter.push(resize(1600, 900));
	assert.equal(out.length, 24);
	assert.equal(out[0], 251);
	assert.equal(out[6], 1);
	assert.deepEqual(size(out), [1600, 900, 1600, 900]);
	assert.equal(out.readUInt32BE(8), 7);
});

test('an oversized resize is clamped to 3840x2160, and a small one passes as asked', () => {
	assert.deepEqual(size(admitting().filter.push(resize(10000, 9000))), [
		3840, 2160, 3840, 2160,
	]);
	assert.deepEqual(size(admitting().filter.push(resize(100, 50))), [
		100, 50, 100, 50,
	]);
	assert.deepEqual(size(admitting().filter.push(resize(0, 0))), [1, 1, 1, 1]);
	assert.deepEqual(size(admitting().filter.push(resize(5000, 600))), [
		3840, 600, 3840, 600,
	]);
});

test('a resize naming two screens, or none, closes the stream', () => {
	for (const screens of [0, 2, 16])
		assert.throws(
			() => admitting().filter.push(resize(1280, 800, screens)),
			/RFB resize needs one screen/,
		);
});

test('a burst of resizes is passed on at most ten a second, and the last one is applied', () => {
	const { filter, sent, advance } = admitting();
	// Sixty requests over six hundred milliseconds.
	const passed = [];
	for (let i = 0; i < 60; i++) {
		const out = filter.push(resize(1000 + i, 700 + i));
		if (out.length) passed.push(out);
		advance(10);
	}
	advance(1000);
	const all = [...passed, ...sent];
	// The first goes at once; after it, one per hundred milliseconds.
	assert.ok(all.length <= 8, `${all.length} resizes reached the display server`);
	assert.ok(all.length >= 6);
	assert.deepEqual(size(passed[0]), [1000, 700, 1000, 700]);
	const last = [...sent].at(-1);
	assert.deepEqual(size(last), [1059, 759, 1059, 759]);
	// Nothing further is owed once the burst has drained.
	const count = sent.length;
	advance(1000);
	assert.equal(sent.length, count);
});

test('a resize split across writes is reassembled, and other input around it still flows', () => {
	const { filter } = admitting();
	const key = Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]);
	const input = Buffer.concat([key, resize(1280, 720), key]);
	for (let split = 0; split <= input.length; split++) {
		const { filter: f } = admitting();
		const out = Buffer.concat([
			f.push(input.subarray(0, split)),
			f.push(input.subarray(split)),
		]);
		assert.equal(out.length, 8 + 24 + 8);
		assert.deepEqual(size(out.subarray(8, 32)), [1280, 720, 1280, 720]);
	}
	assert.equal(filter.push(key).length, 8);
});

test('a view-only stream cannot resize, and a closed filter sends nothing it held back', () => {
	const viewOnly = admitting('view-only');
	assert.equal(viewOnly.filter.push(resize(1600, 900)).length, 0);
	assert.throws(() => viewOnly.filter.push(resize(1600, 900, 2)));

	const { filter, sent, advance } = admitting();
	filter.push(resize(1600, 900));
	assert.equal(filter.push(resize(1700, 950)).length, 0);
	filter.close();
	advance(1000);
	assert.deepEqual(sent, []);
});
