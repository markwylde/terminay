import path from 'node:path';
import type { Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

export type SharedWebShellFixture = {
	close: () => Promise<void>;
	origin: string;
	url: string;
};

/**
 * Install the browser host boundary that owns a remote application's transport.
 *
 * `server.html` is a server application entry, not a standalone connection
 * manager. Production injects this contract before the application module is
 * evaluated. Browser tests must do the same instead of relying on the legacy
 * ambient transport globals that the single-owner transport work removed.
 */
export async function installSessionTransportHostStub(
	page: Page,
): Promise<void> {
	await page.addInitScript(() => {
		const unavailable = (): never => {
			throw new Error(
				'The E2E session transport stub does not provide a live endpoint.',
			);
		};

		Object.defineProperty(window, '__TERMINAY_SESSION_TRANSPORT__', {
			configurable: false,
			enumerable: false,
			writable: false,
			value: Object.freeze({
				authenticatedTransportVersion: 2,
				version: 1,
				sessionId: 'e2e-browser-session',
				origin: window.location.origin,
				prepareWorkspace: unavailable,
				connect: unavailable,
			}),
		});
	});
}

export async function startSharedWebShellFixture(): Promise<SharedWebShellFixture> {
	const repoDir = path.resolve(import.meta.dirname, '../..');
	const server: ViteDevServer = await createServer({
		configFile: false,
		root: repoDir,
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port: 0,
			strictPort: false,
		},
		resolve: {
			alias: {
				'@terminay/client-core': path.join(
					repoDir,
					'packages/client-core/src/index.ts',
				),
				'@terminay/protocol': path.join(
					repoDir,
					'packages/protocol/src/index.ts',
				),
				'@terminay/responsive-ui': path.join(
					repoDir,
					'packages/responsive-ui/src/index.ts',
				),
			},
		},
	});
	await server.listen();
	await Promise.all([
		server.warmupRequest('/src/remote/main.tsx'),
		server.warmupRequest('/src/web/serverEntry.ts'),
	]);
	const address = server.httpServer?.address();
	if (
		address === undefined ||
		address === null ||
		typeof address === 'string'
	) {
		await server.close();
		throw new Error('Unable to allocate the shared web shell fixture port.');
	}
	const origin = `http://127.0.0.1:${address.port}`;
	return {
		close: () => server.close(),
		origin,
		url: `${origin}/e2e/fixtures/shared-web-shell.html`,
	};
}

const OPTIMIZED_DEPENDENCY_URL = /["'](\/node_modules\/\.vite\/deps\/[^"']+)["']/gu;

/**
 * Bundle the fixture's dependencies once, before any test starts a fixture.
 *
 * Every fixture server shares Vite's dependency cache, but a cold bundle of
 * the web shell's dependencies (Monaco, pdf.js, xterm, …) can take longer on
 * a busy CI runner than a test's 30 s hook or 5 s navigation budget. A server
 * killed mid-bundle never writes the cache, so every retry and every later
 * spec started cold again and the whole shard failed. Warming the cache here,
 * with no per-test deadline, means each fixture starts from a finished bundle.
 */
export async function prebundleSharedWebShellDependencies(): Promise<void> {
	const fixture = await startSharedWebShellFixture();
	try {
		// A fixture entry that imports `react-dom/client` directly, so its
		// transformed source names an optimized dependency to wait on.
		for (const entry of ['/e2e/fixtures/shared-web-shell-main.tsx']) {
			const response = await fetch(`${fixture.origin}${entry}`, {
				signal: AbortSignal.timeout(300_000),
			});
			const source = await response.text();
			// Requesting any optimized dependency waits for the whole bundle.
			const dependency = OPTIMIZED_DEPENDENCY_URL.exec(source)?.[1];
			OPTIMIZED_DEPENDENCY_URL.lastIndex = 0;
			if (dependency === undefined) continue;
			await (
				await fetch(`${fixture.origin}${dependency}`, {
					signal: AbortSignal.timeout(300_000),
				})
			).arrayBuffer();
		}
	} finally {
		await fixture.close();
	}
}
