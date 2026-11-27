import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TerminayClient, TerminayClientFacade } from '@terminay/client-core';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import {
	createServerCoreComposition,
	examineServerDesktopHost,
	osReleaseId,
	ServerDesktopService,
	temporaryDirectoryIsPrivate,
} from '../dist/index.js';

const PROGRAMS = [
	'Xtigervnc', 'tigervncpasswd', 'xfwm4', 'xfce4-panel', 'xfsettingsd', 'xfdesktop',
	'dbus-run-session', 'xset', 'python3', 'bash',
];
const SHARED_TMP = '36 25 0:32 / /tmp rw,nosuid shared:1 - tmpfs tmpfs rw\n';
const PRIVATE_TMP =
	'36 25 0:32 / /tmp rw - tmpfs tmpfs rw\n' +
	'412 36 8:1 /tmp/systemd-private-abc-terminay.service-XyZ/tmp /tmp rw,relatime shared:200 - ext4 /dev/sda1 rw\n';

const codeOf = (error) => error.code ?? error.cause?.code;
const messageOf = (error) => `${error.message} ${error.cause?.message ?? ''}`;

const facts = (overrides = {}) => ({
	platform: 'linux',
	osRelease: async () => 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nID=debian\n',
	mountinfo: async () => SHARED_TMP,
	executable: async (file) => file.startsWith('/usr/bin/') && PROGRAMS.includes(path.basename(file)),
	list: async () => ['seccomp.cpython-313-x86_64-linux-gnu.so'],
	networkDenialWorks: async () => true,
	...overrides,
});

test('host support: each reason, in the order a person would fix them', async () => {
	const reason = async (overrides) => (await examineServerDesktopHost(facts(overrides))).reason;
	assert.equal(await reason({ platform: 'darwin' }), 'not-linux');
	assert.equal(await reason({ platform: 'win32' }), 'not-linux');
	for (const text of ['ID=ubuntu\nID_LIKE=debian\n', 'ID="fedora"\n', 'NAME=x\n', undefined])
		assert.equal(await reason({ osRelease: async () => text }), 'not-debian');
	assert.equal(await reason({ mountinfo: async () => PRIVATE_TMP }), 'private-temporary-directory');
	assert.equal(await reason({ networkDenialWorks: async () => false }), 'network-cannot-be-denied');
	// The distribution is named before the temporary directory.
	assert.equal(
		await reason({ osRelease: async () => 'ID=arch\n', mountinfo: async () => PRIVATE_TMP }),
		'not-debian',
	);
	const supported = await examineServerDesktopHost(facts());
	assert.equal(supported.supported, true);
	assert.deepEqual(supported.missing, []);
	assert.equal(supported.programs.displayServer, '/usr/bin/Xtigervnc');
});

test('host support: missing programs are needs-setup, not unsupported, and the denial probe waits for them', async () => {
	let probed = 0;
	const none = await examineServerDesktopHost(
		facts({
			executable: async () => false,
			list: async () => [],
			networkDenialWorks: async () => {
				probed += 1;
				return false;
			},
		}),
	);
	assert.equal(none.supported, true);
	assert.ok(none.missing.length > 0);
	assert.equal(probed, 0, 'the probe cannot run before its programs exist');
	const some = await examineServerDesktopHost(
		facts({ executable: async (file) => file === '/usr/bin/bash' || file === '/usr/bin/python3' }),
	);
	assert.equal(some.supported, true);
	assert.ok(some.missing.length > 0);
});

test('os-release and mountinfo parsing', () => {
	assert.equal(osReleaseId('ID=debian\n'), 'debian');
	assert.equal(osReleaseId('NAME="x"\nID="debian"\n'), 'debian');
	assert.equal(osReleaseId("ID='debian'"), 'debian');
	assert.equal(osReleaseId('ID_LIKE=debian\n'), undefined);
	assert.equal(temporaryDirectoryIsPrivate(SHARED_TMP), false);
	assert.equal(temporaryDirectoryIsPrivate(PRIVATE_TMP), true);
	// A later shared mount over a private one is what programs see.
	assert.equal(temporaryDirectoryIsPrivate(PRIVATE_TMP + SHARED_TMP.replace('36 25', '500 412')), false);
	assert.equal(temporaryDirectoryIsPrivate(''), false);
});

async function composed(t, { withDesktop = true, installed = false } = {}) {
	const root = await mkdtemp(path.join(tmpdir(), 'sdc-'));
	const pty = {
		spawn: () => {
			throw new Error('unused');
		},
	};
	let journal;
	const service = withDesktop
		? new ServerDesktopService({
				// The composition's own journal, so events go where clients listen.
				eventJournal: { publishTransient: (event, payload) => journal.publishTransient(event, payload) },
				directory: path.join(root, 'd'),
				dataRoot: root,
				home: root,
				env: {},
				facts: facts(installed ? {} : { executable: async () => false, list: async () => [] }),
				setup: {
					describe: async () => ({ means: 'command', command: 'sudo terminay daemon desktop install' }),
					running: async () => undefined,
					run: async () => ({ ok: false, reason: 'unused' }),
				},
			})
		: undefined;
	const composition = createServerCoreComposition({
		serverId: 'desktop-composed',
		serverVersion: 'test',
		capabilities: ['server-desktop.v1'],
		ptyFactory: pty,
		allowUnresolvedTestSessions: true,
		...(service ? { serverDesktop: service } : {}),
	});
	journal = composition.eventJournal;
	await composition.start();
	const clients = [];
	t.after(async () => {
		for (const client of clients) await client.close();
		await composition.shutdown();
		await rm(root, { recursive: true, force: true });
	});
	const connect = async (identity = { clientId: 'device', authScope: 'write' }) => {
		const pair = createInMemoryTransportPair();
		const connection = composition.core.accept(pair.server, { authenticatedClient: identity });
		connection.start();
		const client = new TerminayClient({ transport: pair.client, clientId: identity.clientId });
		clients.push(client);
		await pair.open();
		const hello = await client.connect();
		return { client, hello, facade: new TerminayClientFacade(client), connection };
	};
	return { composition, service, connect };
}

test('a composition with a server desktop advertises server-desktop.v1; one without never does', async (t) => {
	const withDesktop = await composed(t);
	assert.ok(withDesktop.composition.coreOptions.capabilities.includes('server-desktop.v1'));
	assert.ok((await withDesktop.connect()).hello.capabilities.includes('server-desktop.v1'));
	// A host that lists the capability without composing the service does not
	// advertise it, and has none of its operations.
	const without = await composed(t, { withDesktop: false });
	assert.equal(without.composition.coreOptions.capabilities.includes('server-desktop.v1'), false);
	const { hello, facade } = await without.connect();
	assert.equal(hello.capabilities.includes('server-desktop.v1'), false);
	await assert.rejects(facade.query('server.desktop.status', {}));
});

test('over a connection: a paired device reads the status; narrowed connections are forbidden and told nothing', async (t) => {
	const c = await composed(t);
	const device = await c.connect();
	const status = await device.facade.query('server.desktop.status', {});
	assert.deepEqual(status.status, {
		state: 'needs-setup',
		setup: 'command',
		command: 'sudo terminay daemon desktop install',
	});
	assert.equal(status.controller, null);
	for (const identity of [
		{ clientId: 'read', authScope: 'read' },
		{ clientId: 'project', authScope: 'write', claims: { projectId: 'p1' } },
		{ clientId: 'session', authScope: 'write', claims: { sessionId: 's1' } },
		{ clientId: 'bound', authScope: 'write', claims: { capabilityId: 'cap' } },
		{ clientId: 'system:mcp', authScope: 'write' },
	]) {
		const narrowed = await c.connect(identity);
		await assert.rejects(narrowed.facade.query('server.desktop.status', {}), (error) => {
			assert.equal(codeOf(error), 'forbidden', `${identity.clientId}: ${error.message}`);
			assert.doesNotMatch(messageOf(error), /needs-setup|install|765/);
			return true;
		});
		await assert.rejects(narrowed.facade.command('server.desktop.open', { generation: 1 }), (error) => codeOf(error) === 'forbidden');
		await assert.rejects(narrowed.client.subscribe('server.desktop.changed'), (error) => codeOf(error) === 'forbidden');
	}
});

test('a status change reaches paired devices and no narrowed connection, even one subscribed to everything', async (t) => {
	const c = await composed(t);
	const device = await c.connect();
	const narrowed = await c.connect({ clientId: 'project', authScope: 'write', claims: { projectId: 'p1' } });
	const seen = { device: [], narrowed: [] };
	const sub = await device.client.subscribe('server.desktop.changed');
	const all = await narrowed.client.subscribe();
	sub.onEvent((event) => seen.device.push(event));
	all.onEvent((event) => seen.narrowed.push(event));
	await c.service.refresh();
	// Something the narrowed connection may see, published after the desktop
	// event, proves its stream was delivering.
	c.composition.eventJournal.publishTransient('test.marker', { n: 1 });
	const deadline = Date.now() + 5000;
	while (
		(seen.device.length === 0 || !seen.narrowed.some((e) => e.event === 'test.marker')) &&
		Date.now() < deadline
	)
		await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(seen.device.length, 1);
	assert.equal(seen.device[0].event, 'server.desktop.changed');
	assert.equal(seen.device[0].payload.status.state, 'needs-setup');
	assert.ok(seen.narrowed.some((e) => e.event === 'test.marker'));
	assert.equal(seen.narrowed.some((e) => e.event.startsWith('server.desktop.')), false);
});

test('a connection that ends takes its desktop authority with it', async (t) => {
	const c = await composed(t);
	const device = await c.connect();
	await device.facade.query('server.desktop.status', {});
	let revoked;
	const original = c.service.closeConnection.bind(c.service);
	c.service.closeConnection = (connectionId) => {
		revoked = connectionId;
		original(connectionId);
	};
	await device.client.close();
	const deadline = Date.now() + 5000;
	while (revoked === undefined && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(typeof revoked, 'string');
});
