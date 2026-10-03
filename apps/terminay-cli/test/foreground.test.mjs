import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { runForegroundStatus } from '../dist/commands/lifecycle.js';
import {
	runApprovals,
	runPairing,
	runResolveApproval,
} from '../dist/commands/pairing.js';
import {
	assertNotContainerManaged,
	ContainerManagedError,
	NotInstalledError,
	resolveContext,
	resolveForeground,
} from '../dist/context.js';
import { installLayout } from '../dist/layout.js';
import { SocketError } from '../dist/socket.js';
import { createFakeBin } from './fake-bin.mjs';
import { startFakeApprovalSocket } from './fake-server.mjs';

const execFileAsync = promisify(execFile);
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');
const OPTIONS = { allowDowngrade: false, purge: false, yes: false, wait: true };
const HOSTED_URL = 'https://box.terminay.com/v1/?hostName=box#secret';

/**
 * A machine with nothing installed and a server in the foreground: an empty
 * home, a data root the test owns, and a PATH with no `sudo` and no systemd
 * tools on it, so a command that reached for either would fail rather than
 * quietly work.
 */
async function withForeground(script, run) {
	const home = await mkdtemp(join(tmpdir(), 'terminay-fg-home-'));
	const dataRoot = await mkdtemp(join(tmpdir(), 'tfg-'));
	const emptyBin = await mkdtemp(join(tmpdir(), 'terminay-fg-bin-'));
	const server =
		script === undefined
			? undefined
			: await startFakeApprovalSocket(dataRoot, script);
	const path = process.env.PATH;
	process.env.PATH = emptyBin;
	const lines = [];
	try {
		await run({
			home,
			dataRoot,
			server,
			lines,
			write: (line) => lines.push(line),
			env: { PATH: emptyBin, TERMINAY_DATA_ROOT: dataRoot },
		});
	} finally {
		process.env.PATH = path;
		await server?.close();
		for (const directory of [home, dataRoot, emptyBin])
			await rm(directory, { recursive: true, force: true });
	}
}

function terminal(answer) {
	const input = new PassThrough();
	input.isTTY = true;
	input.write(answer);
	return { input, output: new PassThrough() };
}

function pairingServer() {
	const pending = [
		{
			approvalId: 'approval-1',
			deviceName: 'Phone',
			matchCode: 'K7Q2M',
			expiresAt: Date.now() + 60_000,
		},
	];
	return (request) => {
		if (request.op === 'pairing')
			return {
				ok: true,
				exposure: ['hosted'],
				handoffs: [
					{
						mode: 'hosted',
						pairingUrl: HOSTED_URL,
						pairingExpiresAt: new Date(Date.now() + 300_000).toISOString(),
						serverId: 'box',
					},
				],
			};
		if (request.op === 'list') return { ok: true, pending };
		if (request.op === 'status')
			return {
				ok: true,
				status: {
					ready: true,
					version: '4.2.0',
					revision: 'abcdef0123456789abcdef0123456789abcdef01',
					exposeModes: ['hosted', 'direct'],
					publicHost: '192.168.2.218',
					advertiseAddress: '192.168.2.218:51000',
				},
			};
		return {
			ok: true,
			approvalId: request.approvalId,
			outcome: request.op === 'approve' ? 'approved' : 'denied',
			deviceName: 'Phone',
		};
	};
}

test('with no install record, qr-code pairs and approves through the data root in TERMINAY_DATA_ROOT', async () => {
	await withForeground(
		pairingServer(),
		async ({ home, dataRoot, server, env, lines, write }) => {
			const context = await resolveForeground({
				command: 'qr-code',
				options: OPTIONS,
				home,
				env,
				write,
			});
			assert.equal(context.dataRoot, dataRoot);
			assert.equal('record' in context, false);

			const result = await runPairing(OPTIONS, context, {
				streams: terminal('y\n'),
				renderQr: async (url) => `[QR for ${url}]`,
				pollIntervalMs: 5,
			});
			assert.deepEqual(result.printed, [HOSTED_URL]);
			assert.equal(result.outcome, 'approved');
			const output = lines.join('\n');
			assert.match(output, /\[QR for https:\/\/box\.terminay\.com/u);
			assert.match(output, /Match code: K7Q2M/u);
			assert.match(output, /Phone is paired\./u);
			// Every request went over the socket in the data root, as this
			// account: there is no sudo on PATH to have dropped with.
			assert.deepEqual(
				server.requests.map((request) => request.op),
				['pairing', 'list', 'approve'],
			);
		},
	);
});

test('approvals, approve, and deny reach a foreground server the same way', async () => {
	await withForeground(
		pairingServer(),
		async ({ home, env, server, lines, write }) => {
			const context = (command) =>
				resolveForeground({ command, options: OPTIONS, home, env, write });
			const pending = await runApprovals(await context('approvals'));
			assert.equal(pending.length, 1);
			await runResolveApproval(
				'approve',
				'approval-1',
				await context('approve'),
			);
			await runResolveApproval('deny', 'approval-1', await context('deny'));
			assert.deepEqual(lines, [
				'approval-1  Phone  match code K7Q2M',
				'Phone is paired.',
				'Phone was denied.',
			]);
			assert.deepEqual(server.requests, [
				{ op: 'list' },
				{ op: 'approve', approvalId: 'approval-1' },
				{ op: 'deny', approvalId: 'approval-1' },
			]);
		},
	);
});

test('status with no service unit reports from the server itself and says so', async () => {
	await withForeground(
		pairingServer(),
		async ({ home, env, server, lines, write }) => {
			const context = await resolveForeground({
				command: 'status',
				options: OPTIONS,
				home,
				env,
				write,
			});
			const status = await runForegroundStatus(context);
			assert.equal(status.ready, true);
			assert.deepEqual(lines, [
				'unit         none (no service unit manages this server)',
				'version      4.2.0',
				'revision     abcdef012345',
				'ready        yes',
				'exposure     hosted, direct',
				'public host  192.168.2.218',
				'advertised   192.168.2.218:51000',
			]);
			assert.deepEqual(server.requests, [{ op: 'status' }]);
		},
	);
});

test('status names what a foreground server was not told rather than leaving it out', async () => {
	await withForeground(
		() => ({
			ok: true,
			status: { ready: false, version: '4.2.0', exposeModes: [] },
		}),
		async ({ home, env, lines, write }) => {
			await runForegroundStatus(
				await resolveForeground({
					command: 'status',
					options: OPTIONS,
					home,
					env,
					write,
				}),
			);
			assert.deepEqual(lines.slice(2), [
				'revision     unknown',
				'ready        no',
				'exposure     off',
				'public host  not set',
				'advertised   not set',
			]);
		},
	);
});

test('a data root no server is listening on says no server is running against it', async () => {
	await withForeground(undefined, async ({ home, dataRoot, env, write }) => {
		const context = (command) =>
			resolveForeground({ command, options: OPTIONS, home, env, write });
		const refused = (error) =>
			error instanceof SocketError &&
			error.message.includes(
				`no Terminay Server is running against the data root ${dataRoot}`,
			) &&
			!/daemon start|sudo/u.test(error.message);
		await assert.rejects(
			async () =>
				runPairing({ ...OPTIONS, wait: false }, await context('qr-code')),
			refused,
		);
		await assert.rejects(
			async () => runApprovals(await context('approvals')),
			refused,
		);
		await assert.rejects(
			async () =>
				runResolveApproval('approve', 'approval-1', await context('approve')),
			refused,
		);
		await assert.rejects(
			async () =>
				runResolveApproval('deny', 'approval-1', await context('deny')),
			refused,
		);
		await assert.rejects(
			async () => runForegroundStatus(await context('status')),
			refused,
		);
	});
});

test('without TERMINAY_DATA_ROOT, or for a command that needs an install, nothing changes', async () => {
	await withForeground(undefined, async ({ home, env, write }) => {
		for (const bare of [
			{ PATH: env.PATH },
			{ ...env, TERMINAY_DATA_ROOT: '' },
		]) {
			assert.equal(
				await resolveForeground({
					command: 'qr-code',
					options: OPTIONS,
					home,
					env: bare,
					write,
				}),
				undefined,
			);
		}
		await assert.rejects(
			() => resolveContext({ options: OPTIONS, home, env: { PATH: env.PATH } }),
			(error) =>
				error instanceof NotInstalledError &&
				/no Terminay Server is installed on this machine/u.test(error.message),
		);
		// The lifecycle commands and reset-identity act on an installation.
		for (const command of [
			'start',
			'stop',
			'upgrade',
			'uninstall',
			'reset-identity',
		]) {
			assert.equal(
				await resolveForeground({
					command,
					options: OPTIONS,
					home,
					env,
					write,
				}),
				undefined,
				command,
			);
		}
		// A scope flag asks for an installation by name.
		assert.equal(
			await resolveForeground({
				command: 'qr-code',
				options: { ...OPTIONS, scope: 'user' },
				home,
				env,
				write,
			}),
			undefined,
		);
	});
});

test('an install record wins over TERMINAY_DATA_ROOT', async () => {
	await withForeground(undefined, async ({ home, env, write }) => {
		const layout = installLayout('user', home);
		await mkdir(layout.prefix, { recursive: true });
		await writeFile(
			layout.recordPath,
			JSON.stringify({
				schemaVersion: 1,
				scope: 'user',
				channel: 'tag',
				version: '4.1.1',
				revision: 'c'.repeat(40),
				runAs: 'ada',
				dataRoot: layout.defaultDataRoot,
				projectRoot: home,
				port: 8443,
				healthPort: 8444,
				expose: 'hosted',
				hostedDomain: 'terminay.com',
				installedAt: '2026-09-08T00:00:00Z',
			}),
		);
		assert.equal(
			await resolveForeground({
				command: 'qr-code',
				options: OPTIONS,
				home,
				env,
				write,
			}),
			undefined,
		);
		const context = await resolveContext({ options: OPTIONS, home, env });
		assert.equal(context.record.dataRoot, layout.defaultDataRoot);
	});
});

const CONTAINER_REFUSALS = {
	install: /pull a newer image and recreate the container/u,
	upgrade: /pull a newer image and recreate the container/u,
	start: /docker start/u,
	stop: /docker stop/u,
	uninstall: /remove the container.*remove its volume/u,
};

test('the container refusal covers the lifecycle commands and only where a container manages the server', () => {
	const env = { TERMINAY_MANAGED_BY: 'container' };
	for (const [command, action] of Object.entries(CONTAINER_REFUSALS)) {
		assert.throws(
			() => assertNotContainerManaged(command, env),
			(error) =>
				error instanceof ContainerManagedError &&
				/managed by the container runtime/u.test(error.message) &&
				action.test(error.message),
			command,
		);
		assert.doesNotThrow(() => assertNotContainerManaged(command, {}));
		assert.doesNotThrow(() =>
			assertNotContainerManaged(command, { TERMINAY_MANAGED_BY: 'systemd' }),
		);
	}
	for (const command of ['status', 'qr-code', 'approvals', 'approve', 'deny'])
		assert.doesNotThrow(() => assertNotContainerManaged(command, env));
});

for (const [command, action] of Object.entries(CONTAINER_REFUSALS)) {
	test(`daemon ${command} inside a managed container changes nothing and names the container action`, async (t) => {
		const home = await mkdtemp(join(tmpdir(), 'terminay-container-'));
		const fake = await createFakeBin();
		t.after(async () => {
			await fake.close();
			await rm(home, { recursive: true, force: true });
		});
		for (const tool of ['systemctl', 'journalctl', 'loginctl', 'sudo'])
			fake.install(tool, '');

		const failure = await execFileAsync(
			process.execPath,
			[CLI, 'daemon', command, '--user'],
			{
				env: {
					...fake.env(),
					HOME: home,
					TERMINAY_MANAGED_BY: 'container',
					TERMINAY_DATA_ROOT: join(home, 'data'),
				},
			},
		).then(
			() => undefined,
			(error) => error,
		);
		assert.notEqual(failure, undefined, 'the command must fail');
		assert.equal(failure.code, 1);
		assert.match(failure.stderr, /managed by the container runtime/u);
		assert.match(failure.stderr, action);
		assert.equal(failure.stdout, '');
		// Nothing written, and nothing driven: no file under the home the
		// install prefix would live in, and no service tool ever run.
		assert.deepEqual(await readdir(home), []);
		assert.deepEqual(fake.invocations(), []);
	});
}

test('the binary reaches a foreground server with no systemd, no install, and no sudo', async () => {
	await withForeground(pairingServer(), async ({ home, env }) => {
		const run = (...args) =>
			execFileAsync(process.execPath, [CLI, 'daemon', ...args], {
				env: { ...env, HOME: home },
			});
		const status = await run('status');
		assert.match(status.stdout, /no service unit manages this server/u);
		assert.match(status.stdout, /version {6}4\.2\.0/u);
		assert.match(status.stdout, /revision {5}abcdef012345/u);
		assert.match(status.stdout, /ready {8}yes/u);
		assert.match(status.stdout, /exposure {5}hosted, direct/u);

		const approvals = await run('approvals');
		assert.match(approvals.stdout, /approval-1 {2}Phone {2}match code K7Q2M/u);
		const approved = await run('approve', 'approval-1');
		assert.match(approved.stdout, /Phone is paired\./u);
		const denied = await run('deny', 'approval-1');
		assert.match(denied.stdout, /Phone was denied\./u);
		// Standard input is not a terminal here, so it prints and does not wait.
		const pairing = await run('pairing-url');
		assert.ok(pairing.stdout.includes(HOSTED_URL));

		// A lifecycle command still wants an installation.
		const start = await run('start').then(
			() => undefined,
			(error) => error,
		);
		assert.equal(start.code, 1);
	});
});

test('the binary says no server is running when the data root has no listener', async () => {
	await withForeground(undefined, async ({ home, env, dataRoot }) => {
		const failure = await execFileAsync(
			process.execPath,
			[CLI, 'daemon', 'qr-code'],
			{ env: { ...env, HOME: home } },
		).then(
			() => undefined,
			(error) => error,
		);
		assert.equal(failure.code, 1);
		assert.ok(
			failure.stderr.includes(
				`no Terminay Server is running against the data root ${dataRoot}`,
			),
		);
	});
});
