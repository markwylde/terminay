import type {
	BrowserContext,
	ElectronApplication,
	Page,
	Route,
} from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * What's New: terminay.com's monthly post, framed in a Home section
 * (ADR-0137). terminay.com is never reached from the suite; every request to
 * it is answered by a fixture here.
 */

const homeControl = (page: Page) =>
	page.getByRole('button', { name: 'Home', exact: true });
const homeSidebar = (page: Page) =>
	page.locator('[data-terminay-home-sidebar]');
const whatsNewItem = (page: Page) =>
	page.locator('[data-terminay-home-section-tab="whatsNew"]');
const whatsNewDot = (page: Page) =>
	page.locator('[data-terminay-home-section-badge="whatsNew"]');
const panel = (page: Page) => page.locator('[data-terminay-whats-new]');

const EMBED_PAGE = `<!doctype html><html><body style="background:#0d1014;color:#e8edf5;font-family:sans-serif;padding:40px">
<h1>November 2026</h1>
<a id="docs" href="https://terminay.com/docs/bots/">Bots docs</a>
<button id="bad" type="button">Bad link</button>
<script>
parent.postMessage({ type: 'terminay.whats-new.ready', version: 1 }, '*');
document.getElementById('docs').addEventListener('click', (event) => {
  event.preventDefault();
  parent.postMessage({ type: 'terminay.whats-new.open-external', version: 1, url: event.currentTarget.href }, '*');
});
document.getElementById('bad').addEventListener('click', () => {
  parent.postMessage({ type: 'terminay.whats-new.open-external', version: 1, url: 'file:///etc/passwd' }, '*');
});
</script></body></html>`;

type Seen = {
	pages: { url: string; referer: string | undefined }[];
	announcements: number;
};

async function serveTerminayCom(
	context: BrowserContext,
	options: { page: 'ok' | 'down'; latest?: string },
): Promise<Seen> {
	const seen: Seen = { pages: [], announcements: 0 };
	await context.unroute('https://terminay.com/**');
	await context.route('https://terminay.com/**', async (route: Route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.pathname === '/whats-new/latest.json') {
			seen.announcements += 1;
			if (options.latest === undefined)
				return route.abort('internetdisconnected');
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'access-control-allow-origin': '*' },
				body: JSON.stringify({
					id: options.latest,
					title: 'November 2026',
					published: '2026-11-17',
				}),
			});
		}
		if (url.pathname === '/whats-new/embed/') {
			seen.pages.push({ url: url.href, referer: request.headers().referer });
			if (options.page === 'down') return route.abort('internetdisconnected');
			return route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: EMBED_PAGE,
			});
		}
		return route.abort('blockedbyclient');
	});
	return seen;
}

async function captureExternalLinks(
	electronApp: ElectronApplication,
): Promise<void> {
	await electronApp.evaluate(({ shell }) => {
		const state = globalThis as typeof globalThis & {
			__whatsNewOpened?: string[];
		};
		state.__whatsNewOpened = [];
		shell.openExternal = async (url: string) => {
			state.__whatsNewOpened?.push(url);
		};
	});
}

async function openedExternalLinks(
	electronApp: ElectronApplication,
): Promise<string[]> {
	return electronApp.evaluate(() => {
		const state = globalThis as typeof globalThis & {
			__whatsNewOpened?: string[];
		};
		return [...(state.__whatsNewOpened ?? [])];
	});
}

test.describe("What's New", () => {
	test('sits second in Home, shows the post, and clears its unread dot', async ({
		electronApp,
		mainWindow,
	}) => {
		const seen = await serveTerminayCom(mainWindow.context(), {
			page: 'ok',
			latest: '2026-11',
		});
		// The startup check may already have used this document's hourly read.
		// Start a fresh document after installing the announcement fixture.
		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await expect.poll(() => seen.announcements).toBeGreaterThanOrEqual(1);
		await homeControl(mainWindow).click();

		const items = homeSidebar(mainWindow).getByRole('tab');
		await expect(items.nth(0)).toHaveText('Home');
		await expect(items.nth(1)).toHaveText("What's New");
		await expect(items.nth(2)).toHaveText('Tabs');

		// Selecting Home read the announcement; nothing has been viewed yet.
		await expect(whatsNewDot(mainWindow)).toBeVisible();
		await mainWindow.screenshot({
			path: test.info().outputPath('whats-new-unread.png'),
		});
		await expect(whatsNewItem(mainWindow)).toHaveAttribute(
			'aria-label',
			"What's New, new post",
		);

		await whatsNewItem(mainWindow).click();
		await expect(panel(mainWindow)).toHaveAttribute(
			'data-terminay-whats-new',
			'ready',
		);
		await expect(whatsNewDot(mainWindow)).toHaveCount(0);

		const frame = mainWindow.frameLocator('[data-terminay-whats-new-frame]');
		await expect(
			frame.getByRole('heading', { name: 'November 2026' }),
		).toBeVisible();
		await mainWindow.screenshot({
			path: test.info().outputPath('whats-new-open.png'),
		});
		const last = seen.pages.at(-1);
		expect(last?.url).toMatch(
			/^https:\/\/terminay\.com\/whats-new\/embed\/\?theme=dark$/,
		);
		expect(last?.referer).toBeUndefined();

		// Leaving and coming back keeps it viewed.
		await mainWindow.locator('.project-tab').first().click();
		await homeControl(mainWindow).click();
		await expect(whatsNewDot(mainWindow)).toHaveCount(0);

		// Links open in the browser; anything unsafe or from elsewhere does not.
		await captureExternalLinks(electronApp);
		await frame.locator('#docs').click();
		await expect
			.poll(() => openedExternalLinks(electronApp))
			.toEqual(['https://terminay.com/docs/bots/']);
		await frame.locator('#bad').click();
		await mainWindow.evaluate(() => {
			window.postMessage(
				{
					type: 'terminay.whats-new.open-external',
					version: 1,
					url: 'https://evil.example/',
				},
				'*',
			);
		});
		await mainWindow.waitForTimeout(500);
		expect(await openedExternalLinks(electronApp)).toEqual([
			'https://terminay.com/docs/bots/',
		]);
		// The workspace was not navigated by the frame.
		await expect(panel(mainWindow)).toBeVisible();
	});

	test('shows a notice when terminay.com cannot be reached, and Retry recovers', async ({
		mainWindow,
	}) => {
		test.setTimeout(90_000);
		const context = mainWindow.context();
		await serveTerminayCom(context, { page: 'down' });
		await homeControl(mainWindow).click();
		await whatsNewItem(mainWindow).click();

		await expect(panel(mainWindow)).toHaveAttribute(
			'data-terminay-whats-new',
			'failed',
			{
				timeout: 25_000,
			},
		);
		await expect(
			mainWindow.getByRole('heading', { name: "Couldn't load What's New" }),
		).toBeVisible();
		await expect(
			mainWindow.getByRole('button', { name: 'Open in browser' }),
		).toBeVisible();
		await mainWindow.screenshot({
			path: test.info().outputPath('whats-new-offline.png'),
		});

		await serveTerminayCom(context, { page: 'ok', latest: '2026-11' });
		await mainWindow.getByRole('button', { name: 'Retry' }).click();
		await expect(panel(mainWindow)).toHaveAttribute(
			'data-terminay-whats-new',
			'ready',
		);
		await expect(
			mainWindow
				.frameLocator('[data-terminay-whats-new-frame]')
				.getByRole('heading', { name: 'November 2026' }),
		).toBeVisible();
	});
});
