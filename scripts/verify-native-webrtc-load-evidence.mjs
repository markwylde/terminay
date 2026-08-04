#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PATCH_SHA =
	'34ea60bd991256adb2cd50bfe0ef9011cfc79054aff686b9ec35ef4703de4211';

async function regularJson(root, name) {
	const pathname = join(root, name);
	const metadata = await lstat(pathname);
	assert.equal(metadata.isFile(), true, `${name} must be a regular file`);
	assert.equal(metadata.isSymbolicLink(), false, `${name} cannot be a symlink`);
	return JSON.parse(await readFile(pathname, 'utf8'));
}

function validateProfile(profile, { arch, mode, peerPairs, routeType }) {
	assert.equal(profile.runtime, 'secure-werift');
	assert.equal(profile.platform, `linux-${arch}`);
	assert.equal(profile.mode, mode);
	assert.equal(profile.peerPairs, peerPairs);
	assert.equal(profile.channelsPerPair, 4);
	assert.ok(Number.isSafeInteger(profile.framesSent) && profile.framesSent > 0);
	assert.ok(Number.isSafeInteger(profile.bytesSent) && profile.bytesSent > 0);
	assert.equal(profile.peerCrashes, 1);
	assert.equal(profile.peerRecoveries, 1);
	validateRoute(profile.crashReplacementRoute, { mode, routeType });
	assert.equal(profile.queueRejects, 0);
	assert.ok(profile.maxApplicationQueue <= 128);
	assert.ok(profile.maxBufferedAmount <= 266_240);
	assert.ok(Number.isFinite(profile.cpuMs) && profile.cpuMs >= 0);
	assert.ok(Number.isSafeInteger(profile.rssGrowthBytes) && profile.rssGrowthBytes >= 0);
	assert.equal(profile.routes.length, peerPairs + profile.peerRecoveries);
	for (const route of profile.routes) {
		validateRoute(route, { mode, routeType });
	}
	assert.equal(
		profile.resourcesAfter.some((name) => /UDP|Socket|Timeout/iu.test(name)),
		false,
		`${mode} profile leaked a network or timer resource: ${profile.resourcesAfter.join(', ')}`,
	);
}

function validateRoute(route, { mode, routeType }) {
	assert.equal(route.protocol, 'udp');
	if (mode === 'turn') {
		assert.equal(route.localType, routeType);
		assert.equal(route.remoteType, routeType);
		return;
	}
	assert.ok(['host', 'prflx'].includes(route.localType));
	assert.ok(['host', 'prflx'].includes(route.remoteType));
}

export async function verifyNativeWebRtcLoadEvidence({
	commit,
	evidenceRoot,
	target,
}) {
	assert.match(commit, /^[0-9a-f]{40}$/u);
	assert.ok(target === 'linux-x64' || target === 'linux-arm64');
	const arch = target.slice('linux-'.length);
	const root = resolve(evidenceRoot);
	const [selection, runner, direct, turn] = await Promise.all([
		regularJson(root, 'selection.json'),
		regularJson(root, 'runner.json'),
		regularJson(root, 'direct.json'),
		regularJson(root, 'turn.json'),
	]);
	assert.equal(selection.package?.version, '0.24.1-candidate.1');
	assert.equal(selection.patches?.length, 1);
	assert.equal(selection.patches[0]?.sha256, PATCH_SHA);
	assert.deepEqual(runner, { commit, schemaVersion: 1, target });
	validateProfile(direct, { arch, mode: 'direct', peerPairs: 6, routeType: 'host' });
	validateProfile(turn, { arch, mode: 'turn', peerPairs: 4, routeType: 'relay' });
	return Object.freeze({ commit, target });
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
	const values = new Map();
	for (let index = 2; index < process.argv.length; index += 2) {
		values.set(process.argv[index], process.argv[index + 1]);
	}
	await verifyNativeWebRtcLoadEvidence({
		commit: values.get('--commit'),
		evidenceRoot: values.get('--evidence-root'),
		target: values.get('--target'),
	});
}
