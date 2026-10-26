import { expect, type Page, test } from '@playwright/test';
import {
	type SharedWebShellFixture,
	startSharedWebShellFixture,
} from './support/shared-web-shell-fixture';

let fixture: SharedWebShellFixture;
test.beforeAll(async () => {
	fixture = await startSharedWebShellFixture();
});
test.afterAll(async () => {
	await fixture.close();
});

const fixtureUrl = (query = '') =>
	`${fixture.origin}/e2e/fixtures/settings-remote-access.html${query}`;

const hostActions = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __remoteControlHostActions: string[] })
				.__remoteControlHostActions,
	);

const remoteList = (page: Page) =>
	page.getByRole('navigation', { name: 'Remote Access' });
const listItem = (page: Page, name: string) =>
	remoteList(page).getByRole('button', { name: new RegExp(`^${name}`, 'u') });
const savedServerLabels = (page: Page) =>
	remoteList(page)
		.locator('.settings-list-section')
		.filter({ hasText: 'Saved servers' })
		.locator('.settings-list-item-label');
const detailTitle = (page: Page) => page.locator('.settings-detail-title');

test('Opening Remote Access shows This server, then the saved servers, with exposure selected', async ({
	page,
}) => {
	await page.goto(fixtureUrl());
	await expect(
		remoteList(page).locator('.settings-list-section-title'),
	).toHaveText(['This server', 'Saved servers']);
	// This server is named after the selected server and says whether it is exposed.
	await expect(listItem(page, 'Local')).toContainText('Not exposed');
	await expect(listItem(page, 'Local')).toHaveAttribute('aria-current', 'true');
	// Local is this computer, not a saved server: This server covers it.
	await expect(savedServerLabels(page)).toHaveText([
		'studio.example',
		'Old build box',
	]);
	await expect(detailTitle(page)).toHaveText('Local');
	await expect(page.getByText('Exposure panel for Local')).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Add server…' }),
	).toBeVisible();
});

test('Exposure options live with exposure, not with a saved server', async ({
	page,
}) => {
	await page.goto(fixtureUrl());
	const options = page.getByRole('region', { name: 'Remote exposure' });
	await expect(options).toBeVisible();
	await listItem(page, 'studio.example').click();
	await expect(options).toHaveCount(0);
	await expect(page.getByText('Exposure panel for Local')).toHaveCount(0);
});

test('a saved server is renamed and forgotten from its detail', async ({
	page,
}) => {
	await page.goto(fixtureUrl());
	await listItem(page, 'Old build box').click();
	const detail = page.getByRole('region', { name: 'Old build box' });
	await expect(detailTitle(page)).toHaveText('Old build box');
	// Only what can be done to a remembered server is offered.
	await expect(detail.getByRole('button')).toHaveText(['Rename', 'Forget']);

	await detail.getByRole('button', { name: 'Rename' }).click();
	await page.getByLabel('Connection name').fill('Build box');
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(listItem(page, 'Build box')).toBeVisible();
	await expect(page.getByText('Connection renamed.')).toBeVisible();

	// Forget asks first, says what it does not do, and can be withdrawn.
	const renamed = page.getByRole('region', { name: 'Build box' });
	await renamed.getByRole('button', { name: 'Forget' }).click();
	const confirm = page.getByRole('region', { name: 'Confirm forget' });
	await expect(confirm).toContainText(
		'Forgetting does not revoke server access.',
	);
	await confirm.getByRole('button', { name: 'Cancel' }).click();
	await expect(savedServerLabels(page)).toHaveCount(2);

	await renamed.getByRole('button', { name: 'Forget' }).click();
	await page.getByRole('button', { name: 'Confirm forget' }).click();
	await expect(savedServerLabels(page)).toHaveText(['studio.example']);
	expect(await hostActions(page)).toEqual([
		'rename:remote:old:Build box',
		'forget:remote:old',
	]);
});

test('Saved servers do not follow the selector', async ({ page }) => {
	await page.goto(fixtureUrl());
	await page.getByLabel('Server').selectOption('studio.example');
	// This server follows the selector...
	await expect(listItem(page, 'studio.example')).toHaveCount(2);
	await expect(
		remoteList(page)
			.locator('.settings-list-section')
			.filter({ hasText: 'This server' })
			.locator('.settings-list-item-label'),
	).toHaveText(['studio.example']);
	await expect(page.getByText('Exposure panel for studio.example')).toBeVisible();
	// ...and the host's saved servers do not.
	await expect(savedServerLabels(page)).toHaveText([
		'studio.example',
		'Old build box',
	]);
});

test('Adding a server shows the pair form in the detail and how to start a server', async ({
	context,
	page,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto(fixtureUrl('?version=5.13.0-beta.214'));
	await page.getByRole('button', { name: 'Add server…' }).click();
	await expect(detailTitle(page)).toHaveText('Add server');
	// Nothing in the list is selected while the form is open.
	await expect(
		remoteList(page).locator('[aria-current="true"]'),
	).toHaveCount(0);

	// The pairing field comes first, and the guide is visible without a click.
	const form = page.getByRole('form', { name: 'Add connection' });
	await expect(form.getByLabel('Pairing URL')).toBeEditable();
	const guide = page.getByRole('region', { name: "Don't have a server yet?" });
	const docker = guide.getByRole('radio', { name: /^Docker/u });
	const linux = guide.getByRole('radio', { name: /^Linux host/u });
	await expect(docker).toBeChecked();
	await expect(linux).not.toBeChecked();
	const startDocker =
		'docker run -d --name terminay -v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay markwylde/terminay:5.13.0-beta.214';
	await expect(guide.getByText(startDocker, { exact: true })).toBeVisible();
	await expect(
		guide.getByText('docker exec -it terminay terminay daemon qr-code', {
			exact: true,
		}),
	).toBeVisible();

	// Copying places exactly that command on the clipboard and says so.
	const copyStart = guide.getByRole('button', {
		name: 'Copy command: Start the server',
	});
	await copyStart.click();
	await expect(copyStart).toHaveText('Copied');
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		startDocker,
	);

	// The further options stay out of the way until asked for.
	const publicCommand = guide.getByText(/TERMINAY_PUBLIC_HOST=/u);
	const hostNetwork = guide.getByText(/--network host/u);
	await expect(publicCommand).toBeHidden();
	await expect(hostNetwork).toBeHidden();
	await guide.getByText('More options').click();
	await expect(publicCommand).toContainText(
		'markwylde/terminay:5.13.0-beta.214',
	);
	await expect(hostNetwork).toBeVisible();
	await expect(
		guide.getByRole('link', { name: 'Installation guide' }),
	).toHaveAttribute('href', 'https://terminay.com/docs/installation');

	// The choice is one keyboard stop; arrows move it. A beta client installs
	// the rolling channel on a Linux host.
	await docker.focus();
	await page.keyboard.press('ArrowRight');
	await expect(linux).toBeChecked();
	await expect(linux).toBeFocused();
	await expect(
		guide.getByText('sudo npx terminay daemon install main', { exact: true }),
	).toBeVisible();
	await expect(copyStart).toHaveText('Copy');

	// Pairing with a link the person already has adds a saved server.
	await form.getByLabel('Pairing URL').fill('https://paired.example/v1/#pair');
	await form.getByRole('button', { name: 'Continue pairing' }).click();
	await expect(savedServerLabels(page)).toHaveText([
		'studio.example',
		'Old build box',
		'paired.example',
	]);
	await expect(form).toBeHidden();
	expect(await hostActions(page)).toEqual([
		'pair:https://paired.example/v1/#pair',
		'refresh',
	]);
});

test('a development build and an absent version name the untagged image', async ({
	page,
}) => {
	for (const query of ['', '?version=0.0.0', '?version=5.13.0%20%26%26%20id']) {
		await page.goto(fixtureUrl(query));
		await page.getByRole('button', { name: 'Add server…' }).click();
		await expect(
			page.getByText(
				'docker run -d --name terminay -v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay markwylde/terminay',
				{ exact: true },
			),
		).toBeVisible();
		await page.getByRole('radio', { name: /^Linux host/u }).click();
		await expect(
			page.getByText('sudo npx terminay daemon install', { exact: true }),
		).toBeVisible();
	}
});

test('at phone width Remote Access shows one column at a time and commands wrap', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(fixtureUrl('?version=5.13.0'));
	const shell = page.locator('.settings-shell');
	await expect(shell).toHaveAttribute('data-settings-layout', 'narrow');
	// The back control is labelled by the column it returns to.
	await page.getByRole('button', { name: /Remote Access/u }).first().tap();
	await expect(listItem(page, 'studio.example')).toBeVisible();
	await page.getByRole('button', { name: 'Add server…' }).tap();
	await expect(page.getByRole('form', { name: 'Add connection' })).toBeVisible();
	await page.getByText('More options').tap();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await context.close();
});

test('Empty saved-server list keeps This server and says where servers appear', async ({
	page,
}) => {
	await page.goto(fixtureUrl('?servers=none'));
	await expect(page.getByText('Exposure panel for Local')).toBeVisible();
	await expect(
		page.getByText('Servers this computer connects to appear here.'),
	).toBeVisible();
	await expect(savedServerLabels(page)).toHaveCount(0);
});
