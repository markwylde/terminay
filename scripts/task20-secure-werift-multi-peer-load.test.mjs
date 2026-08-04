import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runSelectedWeriftMultiPeerLoad } from './task20-secure-werift-multi-peer-load.mjs';

const runtimeRoot = process.env.TERMINAY_SELECTED_WEBRTC_RUNTIME_ROOT;
const durationMs = Number(
	process.env.TERMINAY_WEBRTC_LOAD_DURATION_MS ?? 10_000,
);
const peerPairs = Number(process.env.TERMINAY_WEBRTC_LOAD_PEER_PAIRS ?? 6);
const mode = process.env.TERMINAY_WEBRTC_LOAD_MODE ?? 'direct';

test('selected Secure-Werift sustains bounded real multi-peer traffic and cleanup', {
	skip: !runtimeRoot && 'requires TERMINAY_SELECTED_WEBRTC_RUNTIME_ROOT',
	timeout: 120_000,
}, async () => {
	assert.ok(path.isAbsolute(runtimeRoot));
	await access(path.join(runtimeRoot, 'selection.json'));
	await access(path.join(runtimeRoot, 'artifact', 'lib', 'index.mjs'));
	const result = await runSelectedWeriftMultiPeerLoad({
		durationMs,
		maxCpuMs: Number(process.env.TERMINAY_WEBRTC_LOAD_MAX_CPU_MS ?? 60_000),
		maxRssGrowthBytes: Number(
			process.env.TERMINAY_WEBRTC_LOAD_MAX_RSS_GROWTH_BYTES ??
				512 * 1024 * 1024,
		),
		mode,
		peerPairs,
		runtimeRoot,
		turnConfigPath: process.env.TERMINAY_TURN_CONFIG_PATH,
		turnPort: process.env.TERMINAY_TURN_PORT,
	});
	assert.equal(result.runtime, 'secure-werift');
	assert.equal(result.mode, mode);
	assert.equal(result.peerPairs, peerPairs);
	assert.ok(result.framesSent > 0);
	assert.equal(result.peerCrashes, 1);
	assert.equal(result.peerRecoveries, 1);
	assert.ok(result.crashReplacementRoute);
	assert.equal(result.queueRejects, 0);
});
