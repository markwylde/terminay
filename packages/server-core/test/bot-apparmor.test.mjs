import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
	BotEnvironmentService,
	EngineCommandError,
	SocketDriver,
} from '../dist/botService/index.js';
import { botId, fakeClock, fakeDriver, name } from './fixtures/bot-driver.mjs';

// --- bot-browser-sandbox-under-apparmor (ADR-0120) ---

const refused = () =>
	new EngineCommandError('not-running', 'container process failed', {
		exitCode: 1,
	});

/**
 * A Docker engine reporting AppArmor whose probe containers behave as the
 * host would: `host.defaultAllows` (user namespaces under docker-default),
 * `host.profileLoaded` (terminay-bot exists and allows them), or
 * `host.engineDown` (the engine cannot run a container at all).
 */
function setup(t, host, options = {}) {
	const driver = fakeDriver(options);
	if (options.appArmor !== false) driver.details.appArmor = true;
	const probes = [];
	const run = driver.run;
	driver.run = async (args, callOptions) => {
		if (args[0] === 'run' && args.includes('unshare')) {
			driver.calls.push(args);
			const named = args.includes('apparmor=terminay-bot');
			probes.push({ args, callOptions, named });
			if (host.engineDown)
				throw new EngineCommandError('not-running', 'engine unavailable');
			if (!named) {
				if (host.defaultAllows) return '';
				throw refused();
			}
			if (!host.profileLoaded)
				throw new EngineCommandError(
					'engine',
					'Error response from daemon: AppArmor enabled on system but the terminay-bot profile could not be loaded',
				);
			return '';
		}
		return run(args, callOptions);
	};
	const fingerprint = 'fingerprint-1';
	const service = new BotEnvironmentService('server', {
		engine: async () => driver,
		ensureImage: async () => fingerprint,
		currentFingerprint: () => fingerprint,
		closeHelper: async () => {},
		stopSessions: async () => {},
		bootstrap: async () => ({ vncPassword: 'fake-password' }),
		socketGid: async () => 999,
		secrets: async () => [],
		now: () => Date.parse('2026-11-01T00:01:00Z'),
		timers: fakeClock(),
	});
	service.register({ id: botId });
	t.after(() => service.close());
	const creates = () =>
		driver.calls.filter((a) => a[0] === 'container' && a[1] === 'create');
	const container = () => driver.resources.get(`container:${name}`);
	return { service, driver, probes, creates, container };
}

const appArmorOpts = (create) =>
	create.filter(
		(arg, i) =>
			create[i - 1] === '--security-opt' && arg.startsWith('apparmor='),
	);

test('profile needed and loaded: the container runs under terminay-bot', async (t) => {
	const { service, probes, creates, container } = setup(t, {
		defaultAllows: false,
		profileLoaded: true,
	});
	await service.start(botId);
	const [create] = creates();
	assert.deepEqual(appArmorOpts(create), ['apparmor=terminay-bot']);
	assert.ok(create.includes('terminay.apparmor=terminay-bot'));
	assert.equal(
		create.some((arg) => arg.startsWith('TERMINAY_BROWSER_SANDBOX=')),
		false,
	);
	assert.equal(container().Config.Labels['terminay.apparmor'], 'terminay-bot');
	assert.equal(
		create.some((arg) =>
			['apparmor=unconfined', '--privileged', '--cap-add'].includes(arg),
		),
		false,
	);

	// Each probe: bot image, bot user, bot seccomp, no network, bounded.
	assert.equal(probes.length, 2);
	for (const { args, callOptions } of probes) {
		assert.deepEqual(args.slice(args.indexOf('--entrypoint')), [
			'--entrypoint',
			'unshare',
			'terminay-bot:local',
			'-Ur',
			'true',
		]);
		assert.equal(args[args.indexOf('--user') + 1], 'bot');
		assert.equal(args[args.indexOf('--network') + 1], 'none');
		assert.ok(args.includes('--rm'));
		assert.ok(args.some((arg) => arg.startsWith('seccomp=')));
		assert.ok(callOptions.deadlineMs > 0 && callOptions.deadlineMs <= 20_000);
	}
	assert.deepEqual(
		probes.map((p) => p.named),
		[false, true],
	);

	// Asked once for the life of the process.
	await service.stop(botId);
	await service.start(botId);
	await service.overview(botId);
	assert.equal(probes.length, 2);
});

test('default profile already allows user namespaces: engine default, one probe', async (t) => {
	const { service, probes, creates } = setup(t, { defaultAllows: true });
	await service.start(botId);
	const [create] = creates();
	assert.deepEqual(appArmorOpts(create), []);
	assert.ok(create.includes('terminay.apparmor=default'));
	assert.equal(probes.length, 1);
});

test('refused and no profile: engine default, the sandbox stays on, and the browser is told why', async (t) => {
	const { service, creates } = setup(t, {
		defaultAllows: false,
		profileLoaded: false,
	});
	await service.start(botId);
	const [create] = creates();
	assert.deepEqual(appArmorOpts(create), []);
	assert.ok(create.includes('terminay.apparmor=default'));
	assert.ok(
		create.includes('TERMINAY_BROWSER_SANDBOX=userns-refused-no-profile'),
	);
	assert.equal(
		create.some((arg) => /no-sandbox/u.test(arg)),
		false,
	);
});

test('Podman and engines without AppArmor are never probed', async (t) => {
	for (const options of [{ kind: 'podman' }, { appArmor: false }]) {
		const { service, probes, creates } = setup(
			t,
			{ defaultAllows: false, profileLoaded: true },
			options,
		);
		await service.start(botId);
		assert.equal(probes.length, 0);
		assert.deepEqual(appArmorOpts(creates()[0]), []);
		assert.ok(creates()[0].includes('terminay.apparmor=default'));
	}
});

test('an engine that cannot be asked is asked again, and makes no container out of date', async (t) => {
	const host = { defaultAllows: false, profileLoaded: true, engineDown: false };
	const { service, probes, creates, container } = setup(t, host);
	await service.start(botId);
	assert.equal(container().Config.Labels['terminay.apparmor'], 'terminay-bot');
	// A second service (a restarted server) on an engine that fails the probe.
	const again = setup(t, { ...host, engineDown: true });
	again.driver.resources.set(`container:${name}`, container());
	assert.equal((await again.service.overview(botId)).current, true);
	await again.service.overview(botId);
	assert.equal(again.probes.length, 2, 'not cached after an engine error');
	assert.equal(probes.length, 2);
	assert.equal(creates().length, 1);
});

test('profile becomes available: stopped bot recreated keeping home; running bot shows not current', async (t) => {
	const host = { defaultAllows: false, profileLoaded: false };
	const first = setup(t, host);
	await first.service.start(botId);
	assert.equal(first.container().Config.Labels['terminay.apparmor'], 'default');
	const home = first.driver.resources.get(`volume:${name}-home`);

	// The server restarts after the profile was installed; the bot is running.
	host.profileLoaded = true;
	const next = setup(t, host);
	next.driver.resources.clear();
	for (const [key, value] of first.driver.resources)
		next.driver.resources.set(key, value);
	assert.equal(next.container().State.Running, true);
	assert.equal((await next.service.overview(botId)).current, false);
	await next.service.start(botId);
	assert.equal(next.creates().length, 0, 'a running bot is never replaced');

	await next.service.stop(botId);
	await next.service.start(botId);
	assert.equal(next.creates().length, 1);
	assert.equal(
		next.container().Config.Labels['terminay.apparmor'],
		'terminay-bot',
	);
	assert.equal(next.driver.resources.get(`volume:${name}-home`), home);
	assert.equal((await next.service.overview(botId)).current, true);
});

test('profile gone: a stopped terminay-bot container is recreated under the default', async (t) => {
	const host = { defaultAllows: false, profileLoaded: true };
	const first = setup(t, host);
	await first.service.start(botId);
	await first.service.stop(botId);

	host.profileLoaded = false;
	const next = setup(t, host);
	for (const [key, value] of first.driver.resources)
		next.driver.resources.set(key, value);
	await next.service.start(botId);
	const [create] = next.creates();
	assert.deepEqual(appArmorOpts(create), []);
	assert.ok(create.includes('terminay.apparmor=default'));
});

test('a container created before the label existed counts as the engine default', async (t) => {
	const host = { defaultAllows: true };
	const { service, creates, container } = setup(t, host);
	await service.start(botId);
	await service.stop(botId);
	delete container().Config.Labels['terminay.apparmor'];
	await service.start(botId);
	assert.equal(creates().length, 1, 'unlabelled default container is current');
	assert.equal((await service.overview(botId)).current, true);
});

test('a --rm container the engine created but could not start is removed', async () => {
	const calls = [];
	const transport = {
		json: async (method, path) => {
			calls.push(`${method} ${path.split('?')[0]}`);
			if (path.startsWith('/containers/create')) return { Id: 'probe-id' };
			if (path.endsWith('/start'))
				throw new EngineCommandError(
					'engine',
					'AppArmor enabled on system but the terminay-bot profile could not be loaded',
				);
			return {};
		},
		subscribe: async () => {
			const duplex = new PassThrough();
			duplex.end();
			return duplex;
		},
	};
	const driver = new SocketDriver(fakeDriver().details, transport);
	await assert.rejects(
		driver.run([
			'run',
			'--rm',
			'--security-opt',
			'apparmor=terminay-bot',
			'--entrypoint',
			'unshare',
			'terminay-bot:local',
			'-Ur',
			'true',
		]),
		/terminay-bot profile could not be loaded/u,
	);
	assert.ok(calls.includes('DELETE /containers/probe-id'), calls.join('\n'));
});
