import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test';
import { build } from 'esbuild';

type HostileProof = {
	globals: Record<string, string>;
	readState(): Promise<{
		cookie: string;
		idb: string | null;
		local: string | null;
	}>;
	seedState(value: string): Promise<void>;
};

type ProofWindow = {
	capabilities?: { connectionProfiles?: boolean; serverExposure?: boolean };
	expectedOrigin: string;
	hostPartitionKey: string;
	initialUrl: string;
	label: string;
	profileId: string;
	profiles?: readonly unknown[];
	show: boolean;
};

let app: ElectronApplication;
let hostileServer: Server;
let hostileOrigin = '';
let foreignServer: Server;
let foreignOrigin = '';
let bundleDirectory = '';

test.beforeAll(async () => {
	const fixtureHtml = await readFile(
		path.resolve('e2e/fixtures/server-ui-hostile.html'),
		'utf8',
	);
	const hostile = await listen((request, response) => {
		if (request.url === '/download') {
			response.writeHead(200, {
				'content-disposition': 'attachment; filename="forbidden.txt"',
				'content-type': 'text/plain',
			});
			response.end('This download must be cancelled.');
			return;
		}
		if (request.url === '/redirect') {
			response.writeHead(302, { location: foreignOrigin });
			response.end();
			return;
		}
		response.writeHead(200, {
			'content-security-policy':
				"default-src 'self'; frame-src http://127.0.0.1:*; script-src 'self' 'unsafe-inline'",
			'content-type': 'text/html; charset=utf-8',
		});
		response.end(fixtureHtml);
	});
	hostileServer = hostile.server;
	hostileOrigin = hostile.origin;

	const foreign = await listen((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		response.end('<!doctype html><title>Foreign origin</title><p>foreign</p>');
	});
	foreignServer = foreign.server;
	foreignOrigin = foreign.origin;

	bundleDirectory = await mkdtemp(
		path.join(os.tmpdir(), 'terminay-server-ui-proof-'),
	);
	await Promise.all([
		build({
			bundle: true,
			entryPoints: ['e2e/fixtures/server-ui-proof-main.ts'],
			external: ['electron'],
			format: 'cjs',
			outfile: path.join(bundleDirectory, 'main.cjs'),
			platform: 'node',
			sourcemap: false,
		}),
		build({
			bundle: true,
			entryPoints: ['electron/serverUiPreload.ts'],
			external: ['electron'],
			format: 'cjs',
			outfile: path.join(bundleDirectory, 'server-ui-preload.cjs'),
			platform: 'node',
			sourcemap: false,
		}),
	]);

	const windows: ProofWindow[] = [
		{
			expectedOrigin: hostileOrigin,
			hostPartitionKey: 'profile_A_opaque_partition_key',
			initialUrl: `${hostileOrigin}/?profile=a`,
			label: 'Profile A',
			profileId: 'profile-a',
			capabilities: { connectionProfiles: true, serverExposure: true },
			profiles: [
				{
					id: 'profile-a',
					serverId: 'server-a',
					label: 'Profile A',
					origin: hostileOrigin,
					status: 'connected',
				},
			],
			show: true,
		},
		{
			expectedOrigin: hostileOrigin,
			hostPartitionKey: 'profile_B_opaque_partition_key',
			initialUrl: `${hostileOrigin}/?profile=b`,
			label: 'Profile B',
			profileId: 'profile-b',
			show: true,
		},
	];
	app = await electron.launch({
		args: [path.join(bundleDirectory, 'main.cjs')],
		env: {
			...process.env,
			TERMINAY_SERVER_UI_PROOF_WINDOWS: JSON.stringify(windows),
		},
	});
	await expect.poll(async () => app.windows().length).toBe(2);
	await Promise.all(
		app.windows().map((page) => page.waitForLoadState('domcontentloaded')),
	);
});

test.afterAll(async () => {
	if (app) {
		app.process().kill('SIGKILL');
		await app.close().catch(() => undefined);
	}
	await closeServer(hostileServer);
	await closeServer(foreignServer);
	if (bundleDirectory) {
		await rm(bundleDirectory, { force: true, recursive: true });
	}
});

test('server UI has only the minimal bound host bridge and no Node or generic IPC', async () => {
	const [profileA, profileB] = pagesByTitle();

	await expect(
		profileA.evaluate(
			() => (window as Window & { proof: HostileProof }).proof.globals,
		),
	).resolves.toEqual({
		Buffer: 'undefined',
		ipcRenderer: 'undefined',
		process: 'undefined',
		require: 'undefined',
		terminay: 'undefined',
		terminayHost: 'object',
		terminayWebRtcHost: 'undefined',
	});

	await expect(readHostContext(profileA)).resolves.toEqual({
		capabilities: { connectionProfiles: true, serverExposure: true },
		hostKind: 'desktop',
		profile: { id: 'profile-a', label: 'Profile A' },
		profiles: [
			{
				id: 'profile-a',
				serverId: 'server-a',
				label: 'Profile A',
				origin: hostileOrigin,
				status: 'connected',
			},
		],
	});
	await expect(readHostContext(profileB)).resolves.toEqual({
		capabilities: { connectionProfiles: false, serverExposure: false },
		hostKind: 'desktop',
		profile: { id: 'profile-b', label: 'Profile B' },
		profiles: [],
	});

	const preferences = await app.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows().map((window) => {
			const preferences = window.webContents.getLastWebPreferences();
			return {
				contextIsolation: preferences.contextIsolation,
				nodeIntegration: preferences.nodeIntegration,
				sandbox: preferences.sandbox,
				storagePath: window.webContents.session.storagePath,
				webSecurity: preferences.webSecurity,
				webviewTag: preferences.webviewTag,
			};
		}),
	);
	expect(preferences).toHaveLength(2);
	for (const preference of preferences) {
		expect(preference).toMatchObject({
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
		});
		expect(preference.storagePath).toMatch(/Partitions[\\/]terminay-server-/);
	}
	expect(preferences[0].storagePath).not.toBe(preferences[1].storagePath);

	await expect(
		profileA.evaluate(async () => {
			const bridge = (
				window as Window & {
					terminayHost?: {
						requestAction(action: unknown): Promise<void>;
					};
				}
			).terminayHost;
			if (!bridge) throw new Error('Minimal host bridge is unavailable.');
			try {
				await bridge.requestAction({
					secret: 'must-not-be-ignored',
					type: 'manage-connections',
				});
				return 'accepted';
			} catch {
				return 'rejected';
			}
		}),
	).resolves.toBe('rejected');
});

test('server UI connection actions stay profile-scoped and pairing secrets are consumed by the host', async () => {
	const [profileA] = pagesByTitle();
	await profileA.evaluate(async () => {
		const bridge = (
			window as Window & {
				terminayHost?: { requestAction(action: unknown): Promise<void> };
			}
		).terminayHost;
		if (!bridge) throw new Error('Host bridge unavailable');
		await bridge.requestAction({
			type: 'connection.select',
			profileId: 'profile-a',
		});
		await bridge.requestAction({
			type: 'connection.rename',
			profileId: 'profile-a',
			label: 'Renamed',
		});
		await bridge.requestAction({
			type: 'connection.expose',
			profileId: 'profile-a',
		});
		await bridge.requestAction({
			type: 'connection.pair',
			pairingUrl: 'https://pair.example/session#one-time-secret',
		});
	});
	const actions = await app.evaluate(
		() =>
			(
				globalThis as typeof globalThis & {
					__terminayServerUiActionProofs?: unknown[];
				}
			).__terminayServerUiActionProofs,
	);
	expect(actions).toEqual([
		{ type: 'connection.select', profileId: 'profile-a' },
		{ type: 'connection.rename', profileId: 'profile-a', label: 'Renamed' },
		{ type: 'connection.expose', profileId: 'profile-a' },
		{ type: 'connection.pair', pairingHost: 'pair.example' },
	]);
	expect(JSON.stringify(actions)).not.toContain('one-time-secret');
});

test('server UI cannot open windows or gain permissions', async () => {
	const [profileA] = pagesByTitle();

	const popup = await profileA.evaluate((target) => {
		const opened = window.open(target, '_blank');
		return opened === null;
	}, foreignOrigin);
	expect(popup).toBe(true);
	await expect.poll(async () => app.windows().length).toBe(2);

	const permissions = await profileA.evaluate(async () => {
		const notification = await Notification.requestPermission();
		const geolocation = await new Promise<string>((resolve) => {
			navigator.geolocation.getCurrentPosition(
				() => resolve('granted'),
				(error) =>
					resolve(error.code === error.PERMISSION_DENIED ? 'denied' : 'error'),
			);
		});
		let microphone = 'unavailable';
		if (navigator.mediaDevices?.getUserMedia) {
			microphone = await Promise.race([
				navigator.mediaDevices.getUserMedia({ audio: true }).then(
					() => 'granted',
					() => 'denied',
				),
				new Promise<string>((resolve) =>
					window.setTimeout(() => resolve('denied'), 2_000),
				),
			]);
		}
		return { geolocation, microphone, notification };
	});
	expect(permissions).toEqual({
		geolocation: 'denied',
		microphone: 'denied',
		notification: 'denied',
	});

	await expect(
		profileA.evaluate(async () => {
			try {
				await navigator.clipboard.readText();
				return 'granted';
			} catch {
				return 'denied';
			}
		}),
	).resolves.toBe('denied');
});

test('opaque profiles isolate storage while navigation, downloads, and subframe bridges stay blocked', async () => {
	const [profileA, profileB] = pagesByTitle();
	await profileA.evaluate(
		(value) =>
			(window as Window & { proof: HostileProof }).proof.seedState(value),
		'profile-a-secret',
	);
	await expect(
		profileA.evaluate(() =>
			(window as Window & { proof: HostileProof }).proof.readState(),
		),
	).resolves.toEqual({
		cookie: 'hostile-proof=profile-a-secret',
		idb: 'profile-a-secret',
		local: 'profile-a-secret',
	});
	await expect(
		profileB.evaluate(() =>
			(window as Window & { proof: HostileProof }).proof.readState(),
		),
	).resolves.toEqual({
		cookie: '',
		idb: null,
		local: null,
	});

	await profileA.locator('#foreign-frame').evaluate((frame, origin) => {
		(frame as HTMLIFrameElement).src = origin;
	}, foreignOrigin);
	await profileA.waitForTimeout(100);
	expect(
		profileA.frames().some((frame) => frame.url().startsWith(foreignOrigin)),
	).toBe(false);

	await profileA.locator('#foreign-frame').evaluate((frame, origin) => {
		(frame as HTMLIFrameElement).src = `${origin}/frame`;
	}, hostileOrigin);
	await expect
		.poll(() =>
			profileA.frames().some((frame) => frame.url().includes('/frame')),
		)
		.toBe(true);
	const foreignFrame = profileA
		.frames()
		.find((frame) => frame.url().includes('/frame'));
	if (!foreignFrame) {
		throw new Error('Foreign fixture frame did not load.');
	}
	await foreignFrame.waitForLoadState('domcontentloaded');
	await expect(
		foreignFrame.evaluate(
			() => typeof (window as Window & { terminayHost?: unknown }).terminayHost,
		),
	).resolves.toBe('undefined');

	const input = profileA.locator('#terminal-input');
	await input.focus();
	await profileA.keyboard.type('typed-input');
	await expect(input).toBeFocused();
	await expect(input).toHaveValue('typed-input');
	const previousClipboard = await app.evaluate(({ clipboard }) => {
		const previous = clipboard.readText();
		clipboard.writeText('native-paste');
		return previous;
	});
	await app.evaluate(({ BrowserWindow }) => {
		const target = BrowserWindow.getAllWindows().find((window) =>
			window.webContents.getURL().includes('profile=a'),
		);
		if (!target) throw new Error('Profile A window is unavailable.');
		target.webContents.paste();
	});
	await expect(input).toHaveValue('typed-inputnative-paste');
	await app.evaluate(
		({ clipboard }, value) => clipboard.writeText(value),
		previousClipboard,
	);

	await profileA.evaluate(() => {
		window.location.assign('/same-origin?profile=a');
	});
	await profileA.waitForURL(`${hostileOrigin}/same-origin?profile=a`);
	expect(profileA.url()).toBe(`${hostileOrigin}/same-origin?profile=a`);

	const profileBWebContentsId = await app.evaluate(({ BrowserWindow }) => {
		const target = BrowserWindow.getAllWindows().find((window) =>
			window.webContents.getURL().includes('profile=b'),
		);
		if (!target) throw new Error('Profile B window is unavailable.');
		return target.webContents.id;
	});
	const redirectResult = await app.evaluate(
		async (
			{ BrowserWindow },
			options: { redirectUrl: string; webContentsId: number },
		) => {
			const target = BrowserWindow.getAllWindows().find(
				(window) => window.webContents.id === options.webContentsId,
			);
			if (!target) throw new Error('Profile B window is unavailable.');
			try {
				await target.loadURL(options.redirectUrl);
				return 'loaded';
			} catch {
				return 'blocked';
			}
		},
		{
			redirectUrl: `${hostileOrigin}/redirect`,
			webContentsId: profileBWebContentsId,
		},
	);
	expect(redirectResult).toBe('blocked');
	const profileBUrl = await app.evaluate(({ BrowserWindow }, webContentsId) => {
		const target = BrowserWindow.getAllWindows().find(
			(window) => window.webContents.id === webContentsId,
		);
		return target?.webContents.getURL() ?? '';
	}, profileBWebContentsId);
	expect(profileBUrl.startsWith(foreignOrigin)).toBe(false);

	const downloadPrevented = await app.evaluate(
		(
			{ BrowserWindow },
			options: { downloadUrl: string; webContentsId: number },
		) => {
			const target = BrowserWindow.getAllWindows().find(
				(window) => window.webContents.id === options.webContentsId,
			);
			if (!target) throw new Error('Profile B window is unavailable.');
			return new Promise<boolean>((resolve) => {
				target.webContents.session.once('will-download', (event) => {
					resolve(event.defaultPrevented);
				});
				target.webContents.downloadURL(options.downloadUrl);
			});
		},
		{
			downloadUrl: `${hostileOrigin}/download`,
			webContentsId: profileBWebContentsId,
		},
	);
	expect(downloadPrevented).toBe(true);

	await profileA.evaluate((target) => {
		window.location.assign(target);
	}, foreignOrigin);
	await profileA.waitForTimeout(100);
	const profileAUrl = await app.evaluate(({ BrowserWindow }) => {
		const target = BrowserWindow.getAllWindows().find((window) =>
			window.webContents.getURL().includes('profile=a'),
		);
		return target?.webContents.getURL() ?? '';
	});
	expect(profileAUrl).toBe(`${hostileOrigin}/same-origin?profile=a`);
});

function pagesByTitle(): [Page, Page] {
	const windows = app.windows();
	const profileA = windows.find(
		(page) => new URL(page.url()).searchParams.get('profile') === 'a',
	);
	const profileB = windows.find(
		(page) => new URL(page.url()).searchParams.get('profile') === 'b',
	);
	if (!profileA || !profileB) {
		throw new Error('Proof windows did not load their bound profiles.');
	}
	return [profileA, profileB];
}

async function readHostContext(page: Page): Promise<unknown> {
	return page.evaluate(async () => {
		const bridge = (
			window as Window & {
				terminayHost?: { getContext(): Promise<unknown> };
			}
		).terminayHost;
		if (!bridge) {
			throw new Error('Minimal host bridge is unavailable.');
		}
		return bridge.getContext();
	});
}

async function listen(
	handler: Parameters<typeof createServer>[0],
): Promise<{ origin: string; server: Server }> {
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Fixture server did not bind a TCP port.');
	}
	return { origin: `http://127.0.0.1:${address.port}`, server };
}

async function closeServer(server?: Server): Promise<void> {
	if (!server?.listening) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}
