import { generateKeyPairSync } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { test } from './support/isolated-test';
import { startSharedWebShellFixture } from './support/shared-web-shell-fixture';
import { runShellCommand } from './support/terminal-input';
import {
	activeTerminalSessionId,
	activeTerminalSessionIdOtherThan,
} from './support/terminal-session';

const pairingUrl = process.env.TERMINAY_E2E_DESKTOP_PAIRING_URL;
const fixturePort = 43719; // The origin allowed by the standalone test server.

test.skip(
	pairingUrl === undefined,
	'Use scripts/run-server-desktop-e2e.sh to start the Debian standalone server',
);

function standaloneEndpoint() {
	if (pairingUrl === undefined)
		throw new Error('Missing standalone fixture pairing URL');
	const url = new URL(pairingUrl);
	const pairing = new URLSearchParams(url.hash.slice(1));
	const token = pairing.get('pairingToken');
	if (token === null)
		throw new Error('Missing standalone fixture pairing token');
	return { origin: url.origin, token, pairing };
}

async function viewerTicket(): Promise<string> {
	const { origin, token, pairing } = standaloneEndpoint();
	const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const response = await fetch(new URL('/api/devices/enroll', origin), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			pairingSessionId: pairing.get('pairingSessionId'),
			pairingExpiresAt: pairing.get('pairingExpiresAt'),
			pairingToken: token,
			deviceName: 'Desktop acceptance viewer',
			publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
		}),
		signal: AbortSignal.timeout(5_000),
	});
	expect(
		response.status,
		'the standalone server enrolled a distinct viewer',
	).toBe(200);
	const { ticket } = (await response.json()) as { ticket?: string };
	if (typeof ticket !== 'string')
		throw new Error('Viewer enrollment did not return a ticket');
	return ticket;
}

async function openDesktop(page: Page, fixtureOrigin: string, ticket?: string) {
	const { origin, token } = standaloneEndpoint();
	await page.addInitScript(
		(endpoint) => {
			window.__TERMINAY_TEST_DESKTOP_ENDPOINT__ = endpoint;
		},
		{ origin, token: ticket ?? token },
	);
	await page.goto(`${fixtureOrigin}/e2e/fixtures/server-desktop-real.html`);
	await expect(desktopButton(page)).toBeVisible({ timeout: 30_000 });
	await desktopButton(page).click();
}

const desktopButton = (page: Page) =>
	page.getByRole('button', { name: /^Show desktop of / });
const desktop = (page: Page) =>
	page.getByRole('dialog', { name: /^Desktop of / });

async function expectFixtureWindow(page: Page) {
	const preview = desktop(page).getByRole('button', {
		name: 'Open the desktop in a tab',
	});
	await expect(preview).toBeVisible();
	await expect
		.poll(
			() =>
				preview.evaluate((canvas: HTMLCanvasElement) => {
					const context = canvas.getContext('2d');
					if (context === null) return 0;
					const pixels = context.getImageData(
						0,
						0,
						canvas.width,
						canvas.height,
					).data;
					let magenta = 0;
					for (let offset = 0; offset < pixels.length; offset += 4) {
						if (
							pixels[offset] > 235 &&
							pixels[offset + 1] < 20 &&
							pixels[offset + 2] > 235
						)
							magenta++;
					}
					return magenta;
				}),
			{
				timeout: 30_000,
				message: 'the magenta fixture window appears in the streamed preview',
			},
		)
		.toBeGreaterThan(1_000);
}

test('two browsers see a real server desktop and can transfer control', async ({
	browser,
}) => {
	// Setup downloads two browsers with the desktop: several hundred megabytes.
	test.setTimeout(660_000);
	const fixture = await startSharedWebShellFixture(fixturePort);
	const controller = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const viewer = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	try {
		const first = await controller.newPage();
		await openDesktop(first, fixture.origin);
		await desktop(first)
			.getByRole('button', { name: 'Set up desktop', exact: true })
			.click();
		await expect(
			desktop(first).getByRole('button', { name: 'Give up control' }),
		).toBeVisible({ timeout: 540_000 });

		await first.keyboard.press('Escape');
		const previousTerminal = await activeTerminalSessionId(first);
		await first
			.getByRole('button', { name: 'New terminal tab', exact: true })
			.click();
		const terminal = await activeTerminalSessionIdOtherThan(
			first,
			previousTerminal,
		);
		// VTE's OSC 11 sets a distinctive background for the streamed pixel check.
		await runShellCommand(
			first,
			'xfce4-terminal --disable-server --title=desktop-e2e -x sh -c \'printf "\\033]11;#ff00ff\\007"; sleep 120\' &',
			terminal,
		);
		await desktopButton(first).click();
		await expectFixtureWindow(first);

		const second = await viewer.newPage();
		await openDesktop(second, fixture.origin, await viewerTicket());
		await expect(
			desktop(second)
				.getByText(/^Viewing\./)
				.first(),
		).toBeVisible();
		await expectFixtureWindow(second);
		const takeControl = desktop(second).getByRole('button', {
			name: 'Take control',
		});
		await expect(takeControl).toBeEnabled();
		await takeControl.click();
		await expect(
			desktop(second).getByRole('button', { name: 'Give up control' }),
		).toBeVisible();
		await expect(
			desktop(first).getByRole('button', { name: 'Take control' }),
		).toBeEnabled();
	} finally {
		await Promise.all([controller.close(), viewer.close()]);
		await fixture.close();
	}
});

test('a recreated server container needs desktop setup again', async ({
	page,
}) => {
	const fixture = await startSharedWebShellFixture(fixturePort);
	try {
		await openDesktop(page, fixture.origin);
		await expect(
			desktop(page).getByRole('button', {
				name: 'Set up desktop',
				exact: true,
			}),
		).toBeVisible();
	} finally {
		await fixture.close();
	}
});
