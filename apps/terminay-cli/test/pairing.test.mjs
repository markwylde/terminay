import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { PairingError, runApprovals, runPairing, runResolveApproval } from '../dist/commands/pairing.js';
import { installLayout } from '../dist/layout.js';

const HOSTED_URL = 'https://box.terminay.com/pair#tok_hosted';
const DIRECT_URL = 'https://198.51.100.7:8443/pair#tok_direct';

function terminal(...answers) {
	const input = new PassThrough();
	input.isTTY = true;
	queueMicrotask(() => {
		for (const answer of answers) input.write(`${answer}\n`);
	});
	return { input, output: new PassThrough() };
}

function pipe() {
	const input = new PassThrough();
	input.isTTY = false;
	return { input, output: new PassThrough() };
}

function contextWith(lines, overrides = {}) {
	return {
		layout: installLayout('user', '/home/ada'),
		record: {
			schemaVersion: 1,
			scope: 'user',
			channel: 'tag',
			version: '4.1.1',
			revision: 'c'.repeat(40),
			runAs: 'ada',
			dataRoot: '/home/ada/.local/share/terminay/data',
			projectRoot: '/home/ada',
			port: 8443,
			healthPort: 8444,
			expose: 'hosted,direct',
			hostedDomain: 'terminay.com',
			installedAt: '2026-09-08T00:00:00Z',
			...overrides,
		},
		systemd: {},
		write: (line) => lines.push(line),
	};
}

function handoffs(expiresInMs = 300_000, now = Date.now()) {
	const expiresAt = new Date(now + expiresInMs).toISOString();
	return [
		{ mode: 'hosted', pairingUrl: HOSTED_URL, pairingExpiresAt: expiresAt, serverId: 'box' },
		{ mode: 'direct', pairingUrl: DIRECT_URL, pairingExpiresAt: expiresAt, serverId: 'box' },
	];
}

const renderQr = async (url) => `[QR for ${url}]`;

test('--no-wait prints every URL with its expiry and exits', async () => {
	const lines = [];
	const sent = [];
	const result = await runPairing(
		{ wait: false, allowDowngrade: false, purge: false, yes: false },
		contextWith(lines),
		{
			renderQr,
			send: async (request) => {
				sent.push(request);
				return { ok: true, exposure: ['hosted', 'direct'], handoffs: handoffs() };
			},
		},
	);
	assert.equal(result.waited, false);
	assert.deepEqual(result.printed, [HOSTED_URL, DIRECT_URL]);
	const output = lines.join('\n');
	assert.match(output, /\[QR for https:\/\/198\.51\.100\.7:8443/u, 'direct is preferred when it is enabled');
	assert.match(output, /expires 20/u);
	assert.deepEqual(sent, [{ op: 'pairing' }], 'a print-only run must not poll for approvals');
});

test('--mode selects which URL the code renders', async () => {
	const lines = [];
	await runPairing({ wait: false, mode: 'hosted', allowDowngrade: false, purge: false, yes: false }, contextWith(lines), {
		renderQr,
		send: async () => ({ ok: true, exposure: ['hosted', 'direct'], handoffs: handoffs() }),
	});
	assert.match(lines.join('\n'), /\[QR for https:\/\/box\.terminay\.com/u);
});

test('--mode naming a disabled mode fails and lists what is enabled', async () => {
	const lines = [];
	await assert.rejects(
		() =>
			runPairing({ wait: false, mode: 'direct', allowDowngrade: false, purge: false, yes: false }, contextWith(lines), {
				renderQr,
				send: async () => ({ ok: true, exposure: ['hosted'], handoffs: [handoffs()[0]] }),
			}),
		(error) => error instanceof PairingError && /hosted/u.test(error.message),
	);
});

test('a device that scans is shown with its match code and approved on confirmation', async () => {
	const lines = [];
	const sent = [];
	const result = await runPairing(
		{ wait: true, allowDowngrade: false, purge: false, yes: false },
		contextWith(lines),
		{
			renderQr,
			streams: terminal('y'),
			pollIntervalMs: 1,
			send: async (request) => {
				sent.push(request);
				if (request.op === 'pairing') return { ok: true, exposure: ['hosted', 'direct'], handoffs: handoffs() };
				if (request.op === 'list') {
					return {
						ok: true,
						pending: [{ approvalId: 'ap_1', deviceName: "Ada's laptop", matchCode: '7412', expiresAt: Date.now() + 60_000 }],
					};
				}
				return { ok: true, approvalId: 'ap_1', outcome: 'approved', deviceName: "Ada's laptop" };
			},
		},
	);
	assert.equal(result.outcome, 'approved');
	assert.equal(result.deviceName, "Ada's laptop");
	const output = lines.join('\n');
	assert.match(output, /Match code: 7412/u);
	assert.match(output, /only if that code is the one shown on it/u);
	assert.deepEqual(sent.at(-1), { op: 'approve', approvalId: 'ap_1' });
});

test('declining sends a denial rather than silently doing nothing', async () => {
	const lines = [];
	const sent = [];
	const result = await runPairing(
		{ wait: true, allowDowngrade: false, purge: false, yes: false },
		contextWith(lines),
		{
			renderQr,
			streams: terminal('n'),
			pollIntervalMs: 1,
			send: async (request) => {
				sent.push(request);
				if (request.op === 'pairing') return { ok: true, exposure: ['direct'], handoffs: [handoffs()[1]] };
				if (request.op === 'list') {
					return { ok: true, pending: [{ approvalId: 'ap_2', deviceName: 'Unknown', matchCode: '0001', expiresAt: 0 }] };
				}
				return { ok: true, approvalId: 'ap_2', outcome: 'denied', deviceName: 'Unknown' };
			},
		},
	);
	assert.equal(result.outcome, 'denied');
	assert.deepEqual(sent.at(-1), { op: 'deny', approvalId: 'ap_2' });
});

test('a room close to expiry is replaced and the code redrawn', async () => {
	const lines = [];
	const sent = [];
	let now = Date.parse('2026-09-08T12:00:00Z');
	let rotated = false;
	await runPairing({ wait: true, allowDowngrade: false, purge: false, yes: false }, contextWith(lines), {
		renderQr,
		streams: terminal('y'),
		pollIntervalMs: 1,
		now: () => now,
		send: async (request) => {
			sent.push(request);
			if (request.op === 'pairing') {
				// The first room is seconds from expiring; the replacement is not.
				const remaining = request.rotate === true ? 300_000 : 5_000;
				if (request.rotate === true) rotated = true;
				return { ok: true, exposure: ['direct'], handoffs: [handoffs(remaining, now)[1]] };
			}
			if (request.op === 'list') {
				if (!rotated) return { ok: true, pending: [] };
				return { ok: true, pending: [{ approvalId: 'ap_3', deviceName: 'Phone', matchCode: '9999', expiresAt: 0 }] };
			}
			return { ok: true, approvalId: 'ap_3', outcome: 'approved', deviceName: 'Phone' };
		},
	});
	assert.ok(
		sent.some((request) => request.op === 'pairing' && request.rotate === true),
		'a room about to expire must be replaced',
	);
	assert.match(lines.join('\n'), /That pairing code expired\. Here is a fresh one:/u);
});

test('a server with no exposure says so instead of showing a URL nothing routes', async () => {
	const lines = [];
	await assert.rejects(
		() =>
			runPairing({ wait: false, allowDowngrade: false, purge: false, yes: false }, contextWith(lines), {
				renderQr,
				send: async () => ({ ok: true, exposure: 'off', handoffs: [] }),
			}),
		(error) => error instanceof PairingError && /not exposed/u.test(error.message),
	);
});

test('a stopped server fails with the suggestion to start it', async () => {
	const lines = [];
	await assert.rejects(
		() =>
			runPairing({ wait: false, allowDowngrade: false, purge: false, yes: false }, contextWith(lines), {
				renderQr,
				send: async () => {
					throw new Error('no running server accepts commands at this data root. Start it with `terminay daemon start`.');
				},
			}),
		/daemon start/u,
	);
});

test('no host key or device key is ever printed', async () => {
	const lines = [];
	await runPairing({ wait: true, allowDowngrade: false, purge: false, yes: false }, contextWith(lines), {
		renderQr,
		streams: terminal('y'),
		pollIntervalMs: 1,
		send: async (request) => {
			if (request.op === 'pairing') {
				return {
					ok: true,
					exposure: ['hosted', 'direct'],
					handoffs: handoffs(),
					// Even if a server were to return more than it should, the CLI
					// prints only what it selected.
					hostKey: 'ed25519:SUPERSECRETHOSTKEY',
				};
			}
			if (request.op === 'list') {
				return {
					ok: true,
					pending: [
						{
							approvalId: 'ap_4',
							deviceName: 'Laptop',
							matchCode: '1234',
							expiresAt: 0,
							deviceKey: 'ed25519:SUPERSECRETDEVICEKEY',
						},
					],
				};
			}
			return { ok: true, approvalId: 'ap_4', outcome: 'approved', deviceName: 'Laptop' };
		},
	});
	const output = lines.join('\n');
	assert.doesNotMatch(output, /SUPERSECRETHOSTKEY|SUPERSECRETDEVICEKEY/u);
	assert.doesNotMatch(output, /hostKey|deviceKey/u);
});

test('without a terminal the command prints and points at the scripted commands', async () => {
	const lines = [];
	const result = await runPairing({ wait: true, allowDowngrade: false, purge: false, yes: false }, contextWith(lines), {
		renderQr,
		streams: pipe(),
		send: async () => ({ ok: true, exposure: ['direct'], handoffs: [handoffs()[1]] }),
	});
	assert.equal(result.waited, false);
	assert.match(lines.join('\n'), /daemon approvals/u);
});

test('approvals lists what is pending, and approve and deny resolve one', async () => {
	const lines = [];
	const pending = await runApprovals(contextWith(lines), {
		send: async () => ({
			ok: true,
			pending: [{ approvalId: 'ap_5', deviceName: 'Phone', matchCode: '4242', expiresAt: 0 }],
		}),
	});
	assert.equal(pending.length, 1);
	assert.match(lines.join('\n'), /ap_5\s+Phone\s+match code 4242/u);

	const empty = [];
	await runApprovals(contextWith(empty), { send: async () => ({ ok: true, pending: [] }) });
	assert.match(empty.join('\n'), /No devices are waiting/u);

	const resolved = [];
	await runResolveApproval('approve', 'ap_5', contextWith(resolved), {
		send: async () => ({ ok: true, approvalId: 'ap_5', outcome: 'approved', deviceName: 'Phone' }),
	});
	assert.match(resolved.join('\n'), /Phone is paired\./u);

	const denied = [];
	await runResolveApproval('deny', 'ap_5', contextWith(denied), {
		send: async () => ({ ok: true, approvalId: 'ap_5', outcome: 'denied', deviceName: 'Phone' }),
	});
	assert.match(denied.join('\n'), /Phone was denied\./u);
});

test('an error from the server surfaces rather than being swallowed', async () => {
	const lines = [];
	await assert.rejects(
		() => runResolveApproval('approve', 'ap_gone', contextWith(lines), { send: async () => ({ ok: false, error: 'no such approval' }) }),
		/no such approval/u,
	);
});
