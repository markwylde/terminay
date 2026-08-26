import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import {
	type SharedWebShellFixture,
	startSharedWebShellFixture,
} from './support/shared-web-shell-fixture';

const BUNDLE_ID = 'archive_direct_browser_e2e_0001';
const VALID_ARCHIVE = gzipSync(
	tar([
		[
			'terminay-bundle.json',
			JSON.stringify({
				archiveFormatVersion: 1,
				bundleId: BUNDLE_ID,
				entryPath: 'generated/workspace.html',
				applicationProtocolVersion: '1',
			}),
		],
		[
			'generated/workspace.html',
			'<!doctype html><title>Terminay test bundle</title>',
		],
	]),
);

let fixture: SharedWebShellFixture;

test.beforeAll(async () => {
	fixture = await startSharedWebShellFixture();
});

test.afterAll(async () => {
	await fixture.close();
});

for (const [label, userAgent] of [
	['Firefox', 'Mozilla/5.0 Firefox/130.0'],
	['reduced', 'Terminay compatibility test'],
] as const) {
	test(`direct browser bootstrap is user-agent neutral for ${label}`, async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const pageErrors: Error[] = [];
		page.on('pageerror', (error) => pageErrors.push(error));
		await installDirectBrowserSession(page, VALID_ARCHIVE, userAgent);
		await page.goto(`${fixture.origin}/e2e/fixtures/hostile-server-ui.html`);

		expect(await bootstrapDirectBrowserBundle(page)).toBe(
			`${fixture.origin}/remote-app/${BUNDLE_ID}/generated/workspace.html`,
		);
		expect(pageErrors).toEqual([]);
	});
}

test('direct browser renders a typed recovery panel for an invalid server archive', async ({
	page,
}) => {
	test.setTimeout(90_000);
	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));
	await installDirectBrowserSession(page, new Uint8Array([0x1f, 0x8b]));
	await page.goto(`${fixture.origin}/remote.html`, { waitUntil: 'commit' });

	const failure = page.locator(
		'[data-terminay-bootstrap-failure="bundle-installation"]',
	);
	await expect(failure).toBeVisible({ timeout: 60_000 });
	await expect(failure).toContainText(
		'Terminay could not start this workspace',
	);
	await expect(failure).toContainText(
		'Failed bootstrap step: verified workspace bundle installation.',
	);
	await expect(
		failure.getByRole('button', { name: 'Reload Terminay' }),
	).toBeVisible();
	expect(pageErrors).toEqual([]);
});

test('the server bundle entry consumes the hosted session authority before mounting', async ({
	page,
}) => {
	test.setTimeout(10_000);
	await installHostedSessionAuthority(page, VALID_ARCHIVE);

	await page.goto(`${fixture.origin}/server.html#pairing-session`, {
		waitUntil: 'domcontentloaded',
	});

	await expect.poll(
		() => page.evaluate(async () => {
			const host = window.__TERMINAY_SESSION_TRANSPORT__;
			if (host === undefined) return undefined;
			const workspace = await host.prepareWorkspace();
			return {
				expectedServerId: workspace.expectedServerId,
				origin: host.origin,
				sessionId: host.sessionId,
			};
		}),
		{ timeout: 5_000 },
	).toEqual({
		expectedServerId: 'server-hosted-e2e',
		origin: fixture.origin,
		sessionId: 'e2e-hosted-session',
	});
});

async function installDirectBrowserSession(
	page: Page,
	compressedArchive: Uint8Array,
	userAgent?: string,
): Promise<void> {
	await page.addInitScript(
		({ archive, userAgent: spoofedUserAgent }) => {
			if (spoofedUserAgent !== undefined) {
				Object.defineProperty(Navigator.prototype, 'userAgent', {
					configurable: true,
					get: () => spoofedUserAgent,
				});
			}

				const endpoint = Object.freeze({
					bufferedBytes: 0,
					close: async () => {},
					incoming: { async *[Symbol.asyncIterator]() {} },
					onStateChange: () => () => {},
					open: async () => {},
					queuedBytes: 0,
					send: async () => {},
					state: 'open',
					waitForWritable: async () => {},
				});
			Object.defineProperty(window, '__TERMINAY_SESSION_TRANSPORT__', {
				configurable: false,
				enumerable: false,
				writable: false,
				value: Object.freeze({
					authenticatedTransportVersion: 1,
					version: 1,
					sessionId: 'e2e-direct-browser-session',
					origin: window.location.origin,
					prepareWorkspace: async () =>
						Object.freeze({
							expectedServerId: 'server-direct-browser-e2e',
							context: Object.freeze({
								schemaVersion: 1,
								bootstrapVersion: 1,
								sourceId: 'direct-browser-e2e',
								windowId: 'direct-browser-e2e-window',
								serverId: 'server-direct-browser-e2e',
								profileId: 'profile-direct-browser-e2e',
								bundleId: 'archive_direct_browser_e2e_0001',
								applicationProtocolVersion: '1',
								hostKind: 'browser',
								hostBridgeVersion: 1,
								byteEndpointVersion: 1,
								capabilities: {},
							}),
							endpoint: Object.freeze({
								async send() {},
								subscribe() {
									return () => {};
								},
							}),
							compressedArchive: new Uint8Array(archive),
						}),
					connect: async () => endpoint,
				}),
			});
		},
		{ archive: [...compressedArchive], userAgent },
	);
}

async function installHostedSessionAuthority(
	page: Page,
	compressedArchive: Uint8Array,
): Promise<void> {
	await page.addInitScript(
		({ archive }) => {
				const endpoint = Object.freeze({
					bufferedBytes: 0,
					close: async () => {},
					incoming: { async *[Symbol.asyncIterator]() {} },
					onStateChange: () => () => {},
					open: async () => {},
					queuedBytes: 0,
					send: async () => {},
					state: 'open',
					waitForWritable: async () => {},
				});
			Object.defineProperty(window, '__TERMINAY_HOSTED_SESSION_AUTHORITY__', {
				configurable: false,
				enumerable: false,
				writable: false,
				value: Object.freeze({
					authenticatedTransportVersion: 1,
					sessionId: 'e2e-hosted-session',
					origin: window.location.origin,
					managerUrl: 'https://app.terminay.com/',
					managerAction: 'open',
					serverId: 'server-hosted-e2e',
					hostContext: Object.freeze({
						schemaVersion: 1,
						bootstrapVersion: 1,
						sourceId: 'hosted-session-e2e',
						windowId: 'hosted-session-e2e-window',
						serverId: 'server-hosted-e2e',
						profileId: 'profile-hosted-session-e2e',
						bundleId: 'archive_direct_browser_e2e_0001',
						applicationProtocolVersion: '1',
						hostKind: 'browser',
						hostBridgeVersion: 1,
						byteEndpointVersion: 1,
						capabilities: {},
					}),
					readBundle: async () => new Uint8Array(archive),
					byteEndpoint: Object.freeze({
						async send() {},
						subscribe() {
							return () => {};
						},
					}),
					connect: async () => endpoint,
				}),
			});
		},
		{ archive: [...compressedArchive] },
	);
}

async function bootstrapDirectBrowserBundle(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const host = window.__TERMINAY_SESSION_TRANSPORT__;
		if (host === undefined) throw new Error('The direct-browser session host is missing.');
		const workspace = await host.prepareWorkspace();
		const { createBrowserSessionBundleHost } = await import(
			'/apps/terminay-web/src/browserBundleHost.ts'
		);
		return (
			await createBrowserSessionBundleHost(caches).installAndPrepare({
				...workspace,
				sessionOrigin: host.origin,
			})
		).entryUrl;
	});
}

function tar(entries: readonly (readonly [string, string])[]): Buffer {
	const records: Buffer[] = [];
	for (const [path, value] of entries) {
		const body = Buffer.from(value);
		const header = Buffer.alloc(512);
		header.write(path, 0, 100, 'utf8');
		header.write('0000644\0', 100, 'ascii');
		header.write('0000000\0', 108, 'ascii');
		header.write('0000000\0', 116, 'ascii');
		header.write(
			`${body.length.toString(8).padStart(11, '0')}\0`,
			124,
			'ascii',
		);
		header.write('00000000000\0', 136, 'ascii');
		Buffer.alloc(8, 0x20).copy(header, 148);
		header.write('0', 156, 'ascii');
		header.write('ustar\0', 257, 'ascii');
		header.write('00', 263, 'ascii');
		let sum = 0;
		for (const byte of header) sum += byte;
		header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
		records.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
	}
	return Buffer.concat([...records, Buffer.alloc(1024)]);
}
