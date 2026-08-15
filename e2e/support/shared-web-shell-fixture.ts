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
