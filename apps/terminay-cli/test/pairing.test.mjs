import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';

import {
	PairingError,
	runApprovals,
	runPairing,
	runResolveApproval,
} from '../dist/commands/pairing.js';
import { installLayout } from '../dist/layout.js';
import { explainPrivilegeLaunchError, sendAsUser } from '../dist/socket.js';

const execFileAsync = promisify(execFile);

test('privilege-launch errors name missing sudo and an unreachable Node.js, and nothing else', () => {
	assert.match(
		explainPrivilegeLaunchError({ code: 'ENOENT' }),
		/sudo is required/u,
	);
	assert.match(
		explainPrivilegeLaunchError(
			{ code: 1, message: 'sudo: /root/.nvm/bin/node: command not found' },
			'/root/.nvm/bin/node',
		),
		/cannot run Node\.js at \/root\/\.nvm\/bin\/node/u,
	);
	// A permission error that is not about launching the helper is someone
	// else's problem to describe: a wrong hint sends the operator the wrong way.
	assert.equal(
		explainPrivilegeLaunchError(
			{ code: 1, message: 'connect EACCES /run/terminay/approval.sock' },
			'/usr/bin/node',
		),
		undefined,
	);
	assert.equal(explainPrivilegeLaunchError({ code: 'ETIMEDOUT' }), undefined);
});

test('the privilege-dropped client is self-contained, so the service account needs no access to the CLI install', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-cli-socket-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const socketPath = join(directory, 'approval.sock');
	const received = [];
	const server = createServer((connection) => {
		connection.setEncoding('utf8');
		connection.on('data', (chunk) => {
			received.push(chunk);
			connection.end(`${JSON.stringify({ ok: true, approvals: [] })}\n`);
		});
	});
	await new Promise((resolveListen) => server.listen(socketPath, resolveListen));
	t.after(() => new Promise((resolveClose) => server.close(resolveClose)));

	// Stand in for `sudo -n -u <run-as>`: run exactly what it would be handed,
	// from a directory with no access to this package.
	const calls = [];
	const exec = async (file, args, options) => {
		calls.push({ file, args });
		const [, , runAs, node, ...rest] = args;
		assert.equal(runAs, 'terminay');
		return execFileAsync(node, rest, { ...options, cwd: directory });
	};
	const response = await sendAsUser(socketPath, { op: 'list' }, 'terminay', 0, exec);
	assert.deepEqual(response, { ok: true, approvals: [] });
	assert.deepEqual(received, [`${JSON.stringify({ op: 'list' })}\n`]);
	const [{ file, args }] = calls;
	assert.equal(file, 'sudo');
	assert.deepEqual(args.slice(0, 5), ['-n', '-u', 'terminay', process.execPath, '-e']);
	assert.equal(
		args.some((arg) => /socketClient|node_modules|_npx/u.test(arg)),
		false,
		'no path into the CLI install is handed to the service account',
	);

	// A stopped server is reported as such, not as a privilege problem.
	await new Promise((resolveClose) => server.close(resolveClose));
	await assert.rejects(
		sendAsUser(socketPath, { op: 'list' }, 'terminay', 0, exec),
		/no running server accepts commands at this data root/u,
	);
	// Missing sudo is named, with the underlying detail kept.
	await assert.rejects(
		sendAsUser(socketPath, { op: 'list' }, 'terminay', 0, async () => {
			throw Object.assign(new Error('spawn sudo ENOENT'), { code: 'ENOENT' });
		}),
		/sudo is required.*\(spawn sudo ENOENT\)/u,
	);
	// No drop is attempted when it is not needed.
	await assert.rejects(
		sendAsUser(socketPath, { op: 'list' }, 'root', 0, async () => {
			assert.fail('sudo must not be used for the owning account');
		}),
		/no running server accepts commands/u,
	);
});

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
		{
			mode: 'hosted',
			pairingUrl: HOSTED_URL,
			pairingExpiresAt: expiresAt,
			serverId: 'box',
		},
		{
			mode: 'direct',
			pairingUrl: DIRECT_URL,
			pairingExpiresAt: expiresAt,
			serverId: 'box',
		},
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
				return {
					ok: true,
					exposure: ['hosted', 'direct'],
					handoffs: handoffs(),
				};
			},
		},
	);
	assert.equal(result.waited, false);
	assert.deepEqual(result.printed, [HOSTED_URL, DIRECT_URL]);
	const output = lines.join('\n');
	assert.match(
		output,
		/\[QR for https:\/\/box\.terminay\.com/u,
		'hosted is preferred when both exposure modes are enabled',
	);
	assert.match(output, /open the hosted URL below/u);
	assert.match(output, /expires 20/u);
	assert.deepEqual(
		sent,
		[{ op: 'pairing' }],
		'a print-only run must not poll for approvals',
	);
});

test('--mode selects which URL the code renders', async () => {
	const lines = [];
	await runPairing(
		{
			wait: false,
			mode: 'hosted',
			allowDowngrade: false,
			purge: false,
			yes: false,
		},
		contextWith(lines),
		{
			renderQr,
			send: async () => ({
				ok: true,
				exposure: ['hosted', 'direct'],
				handoffs: handoffs(),
			}),
		},
	);
	assert.match(lines.join('\n'), /\[QR for https:\/\/box\.terminay\.com/u);
});

test('--mode naming a disabled mode fails and lists what is enabled', async () => {
	const lines = [];
	await assert.rejects(
		() =>
			runPairing(
				{
					wait: false,
					mode: 'direct',
					allowDowngrade: false,
					purge: false,
					yes: false,
				},
				contextWith(lines),
				{
					renderQr,
					send: async () => ({
						ok: true,
						exposure: ['hosted'],
						handoffs: [handoffs()[0]],
					}),
				},
			),
		(error) => error instanceof PairingError && /hosted/u.test(error.message),
	);
});

test('--mode direct labels the QR as a Terminay Desktop link', async () => {
	const lines = [];
	await runPairing(
		{
			wait: false,
			mode: 'direct',
			allowDowngrade: false,
			purge: false,
			yes: false,
		},
		contextWith(lines),
		{
			renderQr,
			send: async () => ({
				ok: true,
				exposure: ['hosted', 'direct'],
				handoffs: handoffs(),
			}),
		},
	);
	assert.match(lines.join('\n'), /direct URL in Terminay Desktop/u);
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
				if (request.op === 'pairing')
					return {
						ok: true,
						exposure: ['hosted', 'direct'],
						handoffs: handoffs(),
					};
				if (request.op === 'list') {
					return {
						ok: true,
						pending: [
							{
								approvalId: 'ap_1',
								deviceName: "Ada's laptop",
								matchCode: '7412',
								expiresAt: Date.now() + 60_000,
							},
						],
					};
				}
				return {
					ok: true,
					approvalId: 'ap_1',
					outcome: 'approved',
					deviceName: "Ada's laptop",
				};
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
				if (request.op === 'pairing')
					return { ok: true, exposure: ['direct'], handoffs: [handoffs()[1]] };
				if (request.op === 'list') {
					return {
						ok: true,
						pending: [
							{
								approvalId: 'ap_2',
								deviceName: 'Unknown',
								matchCode: '0001',
								expiresAt: 0,
							},
						],
					};
				}
				return {
					ok: true,
					approvalId: 'ap_2',
					outcome: 'denied',
					deviceName: 'Unknown',
				};
			},
		},
	);
	assert.equal(result.outcome, 'denied');
	assert.deepEqual(sent.at(-1), { op: 'deny', approvalId: 'ap_2' });
});

test('a room close to expiry is replaced and the code redrawn', async () => {
	const lines = [];
	const sent = [];
	const now = Date.parse('2026-09-08T12:00:00Z');
	let rotated = false;
	await runPairing(
		{ wait: true, allowDowngrade: false, purge: false, yes: false },
		contextWith(lines),
		{
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
					return {
						ok: true,
						exposure: ['direct'],
						handoffs: [handoffs(remaining, now)[1]],
					};
				}
				if (request.op === 'list') {
					if (!rotated) return { ok: true, pending: [] };
					return {
						ok: true,
						pending: [
							{
								approvalId: 'ap_3',
								deviceName: 'Phone',
								matchCode: '9999',
								expiresAt: 0,
							},
						],
					};
				}
				return {
					ok: true,
					approvalId: 'ap_3',
					outcome: 'approved',
					deviceName: 'Phone',
				};
			},
		},
	);
	assert.ok(
		sent.some((request) => request.op === 'pairing' && request.rotate === true),
		'a room about to expire must be replaced',
	);
	assert.match(
		lines.join('\n'),
		/That pairing code expired\. Here is a fresh one:/u,
	);
});

test('a server with no exposure says so instead of showing a URL nothing routes', async () => {
	const lines = [];
	await assert.rejects(
		() =>
			runPairing(
				{ wait: false, allowDowngrade: false, purge: false, yes: false },
				contextWith(lines),
				{
					renderQr,
					send: async () => ({ ok: true, exposure: 'off', handoffs: [] }),
				},
			),
		(error) =>
			error instanceof PairingError && /not exposed/u.test(error.message),
	);
});

test('a stopped server fails with the suggestion to start it', async () => {
	const lines = [];
	await assert.rejects(
		() =>
			runPairing(
				{ wait: false, allowDowngrade: false, purge: false, yes: false },
				contextWith(lines),
				{
					renderQr,
					send: async () => {
						throw new Error(
							'no running server accepts commands at this data root. Start it with `terminay daemon start`.',
						);
					},
				},
			),
		/daemon start/u,
	);
});

test('no host key or device key is ever printed', async () => {
	const lines = [];
	await runPairing(
		{ wait: true, allowDowngrade: false, purge: false, yes: false },
		contextWith(lines),
		{
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
				return {
					ok: true,
					approvalId: 'ap_4',
					outcome: 'approved',
					deviceName: 'Laptop',
				};
			},
		},
	);
	const output = lines.join('\n');
	assert.doesNotMatch(output, /SUPERSECRETHOSTKEY|SUPERSECRETDEVICEKEY/u);
	assert.doesNotMatch(output, /hostKey|deviceKey/u);
});

test('without a terminal the command prints and points at the scripted commands', async () => {
	const lines = [];
	const result = await runPairing(
		{ wait: true, allowDowngrade: false, purge: false, yes: false },
		contextWith(lines),
		{
			renderQr,
			streams: pipe(),
			send: async () => ({
				ok: true,
				exposure: ['direct'],
				handoffs: [handoffs()[1]],
			}),
		},
	);
	assert.equal(result.waited, false);
	assert.match(lines.join('\n'), /daemon approvals/u);
});

test('approvals lists what is pending, and approve and deny resolve one', async () => {
	const lines = [];
	const pending = await runApprovals(contextWith(lines), {
		send: async () => ({
			ok: true,
			pending: [
				{
					approvalId: 'ap_5',
					deviceName: 'Phone',
					matchCode: '4242',
					expiresAt: 0,
				},
			],
		}),
	});
	assert.equal(pending.length, 1);
	assert.match(lines.join('\n'), /ap_5\s+Phone\s+match code 4242/u);

	const empty = [];
	await runApprovals(contextWith(empty), {
		send: async () => ({ ok: true, pending: [] }),
	});
	assert.match(empty.join('\n'), /No devices are waiting/u);

	const resolved = [];
	await runResolveApproval('approve', 'ap_5', contextWith(resolved), {
		send: async () => ({
			ok: true,
			approvalId: 'ap_5',
			outcome: 'approved',
			deviceName: 'Phone',
		}),
	});
	assert.match(resolved.join('\n'), /Phone is paired\./u);

	const denied = [];
	await runResolveApproval('deny', 'ap_5', contextWith(denied), {
		send: async () => ({
			ok: true,
			approvalId: 'ap_5',
			outcome: 'denied',
			deviceName: 'Phone',
		}),
	});
	assert.match(denied.join('\n'), /Phone was denied\./u);
});

test('an error from the server surfaces rather than being swallowed', async () => {
	const lines = [];
	await assert.rejects(
		() =>
			runResolveApproval('approve', 'ap_gone', contextWith(lines), {
				send: async () => ({ ok: false, error: 'no such approval' }),
			}),
		/no such approval/u,
	);
});
