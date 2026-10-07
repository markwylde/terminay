import { expect, test } from '@playwright/test';
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
	`${fixture.origin}/e2e/fixtures/remote-control-management.html${query}`;

const hostActions = (page: import('@playwright/test').Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __remoteControlHostActions: string[] })
				.__remoteControlHostActions,
	);

test('Remote Control lists the servers the host remembers, and renames and forgets them', async ({
	page,
}) => {
	await page.goto(fixtureUrl());
	const servers = page.getByRole('listbox', { name: 'Saved Terminay servers' });
	// Every remembered server is listed. Local is this computer, not a saved
	// server, so it is not.
	await expect(servers.getByRole('option')).toHaveText([
		'studio.example',
		'Old build box',
	]);

	await servers.getByRole('option', { name: 'Old build box' }).click();
	const detail = page.getByRole('region', { name: 'Old build box' });
	await expect(
		detail.getByRole('heading', { name: 'Old build box' }),
	).toBeVisible();
	// Only what can be done to a remembered server is offered.
	await expect(detail.getByRole('button')).toHaveText(['Rename', 'Forget']);

	await detail.getByRole('button', { name: 'Rename' }).click();
	await page.getByLabel('Connection name').fill('Build box');
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(
		servers.getByRole('option', { name: 'Build box' }),
	).toBeVisible();
	await expect(page.getByText('Connection renamed.')).toBeVisible();

	// Forget asks first, says what it does not do, and can be withdrawn.
	const renamed = page.getByRole('region', { name: 'Build box' });
	await renamed.getByRole('button', { name: 'Forget' }).click();
	const confirm = page.getByRole('region', { name: 'Confirm forget' });
	await expect(confirm).toContainText(
		'Forgetting does not revoke server access.',
	);
	await confirm.getByRole('button', { name: 'Cancel' }).click();
	await expect(servers.getByRole('option')).toHaveCount(2);

	await renamed.getByRole('button', { name: 'Forget' }).click();
	await page.getByRole('button', { name: 'Confirm forget' }).click();
	await expect(servers.getByRole('option')).toHaveText(['studio.example']);
	expect(await hostActions(page)).toEqual([
		'rename:remote:old:Build box',
		'forget:remote:old',
	]);
});

test('Add connection shows how to start a server that matches the client', async ({
	context,
	page,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto(fixtureUrl('?version=5.13.0-beta.214'));
	await page.getByRole('button', { name: 'Add connection…' }).click();

	// The pairing field comes first, and the guide is visible without a click.
	const form = page.getByRole('form', { name: 'Add connection' });
	await expect(form.getByLabel('Pairing URL')).toBeEditable();
	const guide = page.getByRole('region', { name: "Don't have a server yet?" });
	const docker = guide.getByRole('radio', { name: /^Docker/u });
	const linux = guide.getByRole('radio', { name: /^Linux host/u });
	await expect(docker).toBeChecked();
	await expect(linux).not.toBeChecked();
	const startDocker =
		'docker run -d --name terminay -v terminay-data:/var/lib/terminay markwylde/terminay:5.13.0-beta.214';
	await expect(guide.getByText(startDocker, { exact: true })).toBeVisible();
	await expect(
		guide.getByText('docker exec -it terminay terminay daemon qr-code', {
			exact: true,
		}),
	).toBeVisible();
	expect(
		await form
			.getByLabel('Pairing URL')
			.evaluate(
				(field, heading) =>
					heading !== null &&
					(field.compareDocumentPosition(heading) &
						Node.DOCUMENT_POSITION_FOLLOWING) !==
						0,
				await guide.getByRole('heading').elementHandle(),
			),
	).toBe(true);

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
	const manual = guide.getByRole('link', {
		name: 'Install from the release archive',
	});
	await expect(publicCommand).toBeHidden();
	await expect(hostNetwork).toBeHidden();
	await expect(manual).toBeHidden();
	await guide.getByText('More options').click();
	await expect(publicCommand).toContainText(
		'markwylde/terminay:5.13.0-beta.214',
	);
	await expect(hostNetwork).toBeVisible();
	await expect(manual).toBeVisible();
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
	await expect(
		guide.getByText('sudo npx terminay daemon qr-code', { exact: true }),
	).toBeVisible();
	await expect(guide.getByText(startDocker, { exact: true })).toBeHidden();
	// The copy control does not claim the new command was copied.
	await expect(copyStart).toHaveText('Copy');

	// Pairing with a link the person already has is unaffected by the guide.
	await form.getByLabel('Pairing URL').fill('https://paired.example/v1/#pair');
	await form.getByRole('button', { name: 'Continue pairing' }).click();
	await expect(
		page
			.getByRole('listbox', { name: 'Saved Terminay servers' })
			.getByRole('option', { name: 'paired.example' }),
	).toBeVisible();
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
		await page.getByRole('button', { name: 'Add connection…' }).click();
		await expect(
			page.getByText(
				'docker run -d --name terminay -v terminay-data:/var/lib/terminay markwylde/terminay',
				{ exact: true },
			),
		).toBeVisible();
		await page.getByRole('radio', { name: /^Linux host/u }).click();
		await expect(
			page.getByText('sudo npx terminay daemon install', { exact: true }),
		).toBeVisible();
	}
});

test('at phone width the saved servers stay reachable and commands wrap', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(fixtureUrl('?version=5.13.0'));
	await expect(
		page.getByRole('option', { name: 'studio.example' }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Add connection…' }).tap();
	await page.getByText('More options').tap();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await context.close();
});

test('with no saved servers Remote Control lands on Exposure', async ({
	page,
}) => {
	await page.goto(fixtureUrl('?servers=none'));
	await expect(page.getByText('Exposure panel')).toBeVisible();
	await expect(page.getByText('No saved servers yet.')).toBeVisible();
	await expect(
		page.getByRole('listbox', { name: 'Saved Terminay servers' }),
	).toBeEmpty();
});
