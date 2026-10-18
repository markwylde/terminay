import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * The desktop authority keeps the recent output of every terminal so that AI
 * tab metadata and a reopened project can read it. A full-screen TUI delivers
 * hundreds of small output events a second for hours, so observing one of
 * them has to cost the size of that event, not the size of everything already
 * retained.
 *
 * The cost is counted, not timed: every retained chunk records each read of
 * its bytes, and assembling or re-measuring what is retained on each event
 * would read every retained chunk.
 */

const { BoundedChunkQueue, ServerTerminalAuthority, TerminalService } =
	await importAuthority();

const MEBIBYTE = 1024 * 1024;
const MEASURED_EVENTS = 1_500;

function createPtyFactory() {
	const processes = [];
	return {
		processes,
		spawn() {
			const dataListeners = new Set();
			const process = {
				pid: 7_000 + processes.length,
				write() {},
				resize() {},
				kill() {},
				onData(listener) {
					dataListeners.add(listener);
					return () => dataListeners.delete(listener);
				},
				onExit() {
					return () => {};
				},
				emitData(data) {
					for (const listener of dataListeners) listener(data);
				},
			};
			processes.push(process);
			return process;
		},
	};
}

async function authorityRetaining(maxReplayBytes) {
	const pty = createPtyFactory();
	const authority = new ServerTerminalAuthority({
		serverId: 'output-cost',
		maxReplayBytes,
		// The terminal service's own replay is held small and equal on both
		// sides, so the comparison is of the authority's retention alone.
		terminalService: new TerminalService({
			serverId: 'output-cost',
			ptyFactory: pty,
			maxReplayBytes: 64 * 1024,
		}),
	});
	await authority.create({
		projectId: 'output-cost-project',
		sessionId: 'tui',
		shellPath: '/bin/zsh',
		cwd: tmpdir(),
		cols: 80,
		rows: 24,
	});
	const emit = (data) => pty.processes[0].emitData(data);
	// The first output creates the authority's recent output for the session.
	// From then on every chunk it retains counts each read of its bytes, so
	// work proportional to what is retained shows up as reads, not time.
	emit('\u001b[H');
	const recent = authority.buffers.get('tui');
	assert.ok(recent instanceof BoundedChunkQueue, 'recent output is held in the bounded queue');
	assert.equal(recent.maxBytes, maxReplayBytes);
	const reads = { count: 0 };
	const push = recent.push.bind(recent);
	recent.push = (chunk) => {
		const { bytes } = chunk;
		push({
			get bytes() {
				reads.count += 1;
				return bytes;
			},
		});
	};
	// Past the bound, so the measurement is of the steady state a long-lived
	// terminal spends its life in rather than of the first megabyte.
	const fill = 'x'.repeat(32 * 1024);
	for (let sent = 0; sent <= maxReplayBytes; sent += fill.length) emit(fill);
	return { authority, emit, recent, reads };
}

/** Reads of retained output per observed event, in the steady state. */
function readsPerEvent({ emit, reads }) {
	const frame = `\u001b[H\u001b[2J${'y'.repeat(57)}\n`;
	reads.count = 0;
	for (let index = 0; index < MEASURED_EVENTS; index += 1) emit(frame);
	return reads.count / MEASURED_EVENTS;
}

test('observing terminal output costs the same however much replay the authority retains', async (t) => {
	const little = await authorityRetaining(4 * 1024);
	const full = await authorityRetaining(MEBIBYTE);
	t.after(() =>
		Promise.all([little.authority.shutdown(), full.authority.shutdown()]),
	);
	// Same events observed; only what is already retained differs, by
	// hundreds of chunks.
	const retainingLittle = readsPerEvent(little);
	const retainingFull = readsPerEvent(full);
	assert.ok(full.recent.byteLength > 100 * little.recent.byteLength);

	// An event reads its own chunk and whichever chunks it evicts: a handful,
	// never a share of what is retained.
	assert.ok(
		retainingFull <= 8 && retainingLittle <= 8,
		`an output event read ${retainingFull} retained chunks with a full 1 MiB replay and ` +
			`${retainingLittle} with a 4 KiB one; observing output must not scale with what is retained`,
	);
});

test('the retained replay is exactly the most recent output, in order', async (t) => {
	const maxReplayBytes = 4 * 1024;
	const { authority, emit } = await authorityRetaining(maxReplayBytes);
	t.after(() => authority.shutdown());

	let produced = '';
	for (let index = 0; index < 2_000; index += 1) {
		// Uneven sizes, so a chunk boundary rarely lands on the bound.
		const chunk = `[${index}]${'z'.repeat(index % 23)}`;
		produced += chunk;
		emit(chunk);
	}

	const retained = authority.getBuffer('tui');
	assert.equal(retained.length, maxReplayBytes);
	assert.equal(retained, produced.slice(-maxReplayBytes));
});

test('a terminal that has printed nothing has an empty replay, and an unknown one has none', async (t) => {
	const pty = createPtyFactory();
	const authority = new ServerTerminalAuthority({
		serverId: 'output-cost',
		terminalService: new TerminalService({
			serverId: 'output-cost',
			ptyFactory: pty,
		}),
	});
	t.after(() => authority.shutdown());
	await authority.create({
		projectId: 'output-cost-project',
		sessionId: 'quiet',
		shellPath: '/bin/zsh',
		cwd: tmpdir(),
		cols: 80,
		rows: 24,
	});

	assert.equal(authority.getBuffer('quiet'), '');
	assert.equal(authority.getBuffer('never-created'), null);
});

async function importAuthority() {
	const cacheRoot = join(process.cwd(), 'node_modules', '.cache');
	await mkdir(cacheRoot, { recursive: true });
	const directory = await mkdtemp(
		join(cacheRoot, 'terminay-server-terminal-authority-output-cost-'),
	);
	const outputPath = join(directory, 'authority.mjs');
	try {
		await build({
			absWorkingDir: process.cwd(),
			bundle: true,
			// Keep package dependencies external: several are CommonJS and must be
			// loaded through Node's ESM-to-CommonJS bridge rather than esbuild's
			// generated dynamic-require shim. Local TypeScript stays bundled.
			format: 'esm',
			packages: 'external',
			outfile: outputPath,
			platform: 'node',
			stdin: {
				contents: [
					`export { ServerTerminalAuthority } from ${JSON.stringify(new URL('../electron/serverTerminalAuthority.ts', import.meta.url).pathname)}`,
					`export { TerminalService } from ${JSON.stringify(new URL('../packages/server-core/src/terminalService/service.ts', import.meta.url).pathname)}`,
					`export { BoundedChunkQueue } from ${JSON.stringify(new URL('../packages/server-core/src/terminalService/index.ts', import.meta.url).pathname)}`,
				].join('\n'),
				loader: 'ts',
				resolveDir: process.cwd(),
			},
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		// The module remains loaded after import; the generated file is no longer
		// needed and must not become a worktree artifact.
		await rm(directory, { recursive: true, force: true });
	}
}
