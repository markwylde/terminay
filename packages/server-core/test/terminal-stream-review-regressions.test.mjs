import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	BoundedChunkQueue,
	RecordingService,
	SessionHolder,
} from '../dist/index.js';

test('recordings preserve every UTF-8 split and isolate decoder state across captures', async () => {
	const home = await mkdtemp(join(tmpdir(), 'terminay-recording-utf8-'));
	const service = new RecordingService({
		homeDirectory: home,
		recordingRoot: join(home, 'casts'),
	});
	const output = (recordingId) =>
		service
			.readRecordingChunk({ recordingId, start: 0 })
			.content.split('\n')
			.filter(Boolean)
			.slice(1)
			.map(JSON.parse)
			.filter((record) => record[1] === 'o')
			.map((record) => record[2])
			.join('');
	try {
		for (const character of ['€', '😀']) {
			const bytes = new TextEncoder().encode(character);
			for (let split = 1; split < bytes.length; split++) {
				const started = service.start('utf8');
				service.appendOutputBytes('utf8', bytes.subarray(0, split));
				service.appendOutputBytes('utf8', bytes.subarray(split));
				service.finalize('utf8', 0);
				assert.equal(output(started.recordingId), character);
			}
		}
		const first = service.start('utf8');
		service.appendOutputBytes('utf8', Uint8Array.of(0xe2));
		service.stop('utf8');
		assert.equal(output(first.recordingId), '\ufffd');
		const second = service.start('utf8');
		service.appendOutputBytes('utf8', Uint8Array.of(0x82, 0xac));
		service.shutdown();
		assert.equal(output(second.recordingId), '\ufffd\ufffd');
		// Inactive output neither allocates a decoder nor retains a partial character.
		service.appendOutputBytes('utf8', Uint8Array.of(0xe2));
		const third = service.start('utf8');
		service.appendOutputBytes('utf8', new TextEncoder().encode('clean'));
		service.stop('utf8');
		assert.equal(output(third.recordingId), 'clean');
	} finally {
		service.shutdown();
		await rm(home, { recursive: true, force: true });
	}
});

test('holder queue preserves whole-chunk eviction and byte positions across varied output sizes', () => {
	for (const maxBytes of [1, 17, 4096, 65536]) {
		const holder = Object.create(SessionHolder.prototype);
		holder.maxBufferBytes = maxBytes;
		const session = {
			ring: new BoundedChunkQueue(maxBytes, 'within-bound-keep-last'),
			ringBytes: 0,
			outputPosition: 0,
			bufferedFrom: 0,
			streaming: false,
		};
		const reference = [];
		let retained = 0;
		let position = 0;
		let seed = 12345;
		for (let event = 0; event < 200; event++) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			const bytes = new Uint8Array((seed % 70000) + 1).fill(event % 256);
			holder.output(session, bytes);
			for (let offset = 0; offset < bytes.length; offset += 65536) {
				const part = bytes.slice(offset, offset + 65536);
				reference.push({ position, bytes: part });
				position += part.length;
				retained += part.length;
				while (retained > maxBytes && reference.length > 1)
					retained -= reference.shift().bytes.length;
			}
			assert.equal(session.outputPosition, position);
			assert.equal(session.bufferedFrom, reference[0].position);
			assert.equal(session.ringBytes, retained);
			assert.deepEqual([...session.ring], reference);
		}
	}
});

test('holder retention does not revisit the retained replay on each small append', () => {
	for (const size of [16, 4096]) {
		let reads = 0;
		const ring = new BoundedChunkQueue(1024 * 1024, 'within-bound-keep-last');
		for (let offset = 0; offset < 1024 * 1024; offset += size) {
			const bytes = new Uint8Array(size);
			ring.push({
				position: offset,
				get bytes() {
					reads++;
					return bytes;
				},
			});
		}
		const holder = Object.create(SessionHolder.prototype);
		const session = {
			ring,
			ringBytes: ring.byteLength,
			outputPosition: 1024 * 1024,
			bufferedFrom: 0,
			streaming: false,
		};
		reads = 0;
		for (let i = 0; i < 2000; i++) holder.output(session, new Uint8Array(16));
		assert.ok(
			reads <= 4000,
			`retained ${size}-byte chunks read ${reads} times`,
		);
	}
});

test('invalid holder buffer bounds fail before filesystem or PTY side effects', async () => {
 const home = await mkdtemp(join(tmpdir(), 'terminay-holder-invalid-'));
 let spawns = 0;
 try {
  for (const maxBufferBytes of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
   await assert.rejects(SessionHolder.start({ dataRoot: join(home, 'untouched'), generation: '0123456789abcdef', maxBufferBytes, nodePty: { spawn() { spawns++; throw new Error('must not spawn'); } } }), /positive safe integer/);
  }
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(home), []);
  assert.equal(spawns, 0);
 } finally { await rm(home, { recursive: true, force: true }); }
});
