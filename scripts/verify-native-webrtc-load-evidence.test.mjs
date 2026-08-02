import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyNativeWebRtcLoadEvidence } from './verify-native-webrtc-load-evidence.mjs';

const commit = 'a'.repeat(40);
const patch =
	'34ea60bd991256adb2cd50bfe0ef9011cfc79054aff686b9ec35ef4703de4211';

function profile(mode, routeType, peerPairs) {
	const replacementRoute = {
		localType: routeType,
		protocol: 'udp',
		remoteType: mode === 'direct' ? 'prflx' : routeType,
	};
	return {
		bytesSent: 4096,
		channelsPerPair: 4,
		cpuMs: 10,
		framesSent: 1,
		crashReplacementRoute: replacementRoute,
		maxApplicationQueue: 128,
		maxBufferedAmount: 4096,
		mode,
		peerCrashes: 1,
		peerPairs,
		peerRecoveries: 1,
		platform: 'linux-x64',
		queueRejects: 0,
		resourcesAfter: ['PipeWrap'],
		routes: Array.from({ length: peerPairs + 1 }, (_, index) => ({
			localType: routeType,
			protocol: 'udp',
			remoteType: mode === 'direct' && index === peerPairs ? 'prflx' : routeType,
		})),
		rssGrowthBytes: 0,
		runtime: 'secure-werift',
	};
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'terminay-webrtc-evidence-'));
	await mkdir(root, { recursive: true });
	await writeFile(join(root, 'selection.json'), JSON.stringify({
		package: { version: '0.24.1-candidate.1' },
		patches: [{ sha256: patch }],
	}));
	await writeFile(join(root, 'runner.json'), JSON.stringify({
		commit,
		schemaVersion: 1,
		target: 'linux-x64',
	}));
	await writeFile(join(root, 'direct.json'), JSON.stringify(profile('direct', 'host', 6)));
	await writeFile(join(root, 'turn.json'), JSON.stringify(profile('turn', 'relay', 4)));
	return root;
}

test('native WebRTC load evidence binds candidate, runner, routes, and cleanup', async (context) => {
	const root = await fixture();
	context.after(() => rm(root, { force: true, recursive: true }));
	assert.deepEqual(
		await verifyNativeWebRtcLoadEvidence({
			commit,
			evidenceRoot: root,
			target: 'linux-x64',
		}),
		{ commit, target: 'linux-x64' },
	);
});

test('native WebRTC load evidence rejects leaked resources and route substitution', async (context) => {
	const root = await fixture();
	context.after(() => rm(root, { force: true, recursive: true }));
	const turnPath = join(root, 'turn.json');
	const turn = JSON.parse(await readFile(turnPath, 'utf8'));
	turn.resourcesAfter.push('Timeout');
	await writeFile(turnPath, JSON.stringify(turn));
	await assert.rejects(
		() => verifyNativeWebRtcLoadEvidence({
			commit,
			evidenceRoot: root,
			target: 'linux-x64',
		}),
		/leaked a network or timer resource/u,
	);
});

test('native WebRTC load evidence rejects an absent or downgraded crash recovery', async (context) => {
	const root = await fixture();
	context.after(() => rm(root, { force: true, recursive: true }));
	const directPath = join(root, 'direct.json');
	const direct = JSON.parse(await readFile(directPath, 'utf8'));
	direct.peerRecoveries = 0;
	await writeFile(directPath, JSON.stringify(direct));
	await assert.rejects(
		() => verifyNativeWebRtcLoadEvidence({
			commit,
			evidenceRoot: root,
			target: 'linux-x64',
		}),
		/0 !== 1/u,
	);
});
