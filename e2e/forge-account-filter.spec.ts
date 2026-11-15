import { gzipSync } from 'node:zlib';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { activeHome, expectHomeSection } from './support/home-tabs';

/**
 * Home's Account control (filter-forge-lists-by-account). A fake forge
 * extension, uploaded through Settings › Extensions, has two signed-in accounts
 * on two origins, each with its own pull requests; only the first has issues.
 * The control narrows each section to one account, is remembered per section
 * on the device, and offers Show all accounts when the chosen account has
 * nothing to list.
 */

test.describe.configure({ timeout: 300_000 });

const ALPHA = 'https://alpha.e2e.test';
const BETA = 'https://beta.e2e.test';
const SOURCE = 'dev.terminay.e2e-forge-accounts/forge';

const EXTENSION_SOURCE = `
const ALPHA = ${JSON.stringify(ALPHA)};
const BETA = ${JSON.stringify(BETA)};
const at = (day) => '2026-11-' + String(day).padStart(2, '0') + 'T10:00:00Z';
const item = (kind, origin, owner, name, number, title, day) => ({
  reference: { kind, origin, owner, name, number },
  title,
  url: origin + '/' + owner + '/' + name + (kind === 'issue' ? '/issues/' : '/pulls/') + number,
  state: 'open',
  author: 'alice',
  labels: [],
  comments: 0,
  createdAt: at(1),
  updatedAt: at(day),
  ...(kind === 'pullRequest'
    ? { pullRequest: { headBranch: 'b' + number, baseBranch: 'main', headOwner: owner, headName: name } }
    : {}),
});
const ITEMS = [
  item('pullRequest', ALPHA, 'acme', 'app', 11, 'Alpha: add event stream', 12),
  item('pullRequest', ALPHA, 'acme', 'app', 12, 'Alpha: fix flaky test', 10),
  item('pullRequest', BETA, 'beta', 'lib', 21, 'Beta: speed up parser', 11),
  item('issue', ALPHA, 'acme', 'app', 31, 'Alpha: crash on start', 9),
];

export function activate(context) {
  context.subscriptions.add(context.forges.registerSource(${JSON.stringify(SOURCE)}, {
    async accounts() {
      return [
        { origin: ALPHA, login: 'alice', credentialSource: 'cli-config', state: 'ready', owners: ['alice', 'acme'] },
        { origin: BETA, login: 'alice', credentialSource: 'cli-config', state: 'ready', owners: ['alice', 'beta'] },
      ];
    },
    async claim() {
      return null;
    },
    async query(query) {
      const items = ITEMS.filter((entry) =>
        entry.reference.kind === query.kind &&
        entry.reference.origin === query.origin &&
        (query.state === 'open' || query.state === 'all'));
      return { items, totalCount: items.length };
    },
    async detail(ref) {
      const summary = ITEMS.find((entry) =>
        entry.reference.kind === ref.kind && entry.reference.origin === ref.origin && entry.reference.number === ref.number);
      if (summary === undefined) throw new Error('no such item');
      return { summary, body: 'The body of #' + ref.number + '.', comments: [] };
    },
  }));
}
`;

const PACKAGE_JSON = JSON.stringify({
	name: 'terminay-e2e-forge-accounts',
	version: '1.0.0',
	type: 'module',
	exports: { '.': './dist/extension.js' },
	terminay: {
		manifestVersion: 1,
		id: 'dev.terminay.e2e-forge-accounts',
		displayName: 'E2E Forge Accounts extension',
		api: '^3.7.0',
		engines: { terminay: '>=1', node: '>=22' },
		entrypoint: 'dist/extension.js',
		permissions: ['forge-source'],
		contributes: {
			forgeSources: [
				{
					id: SOURCE,
					displayName: 'E2E Forge',
					kinds: ['pullRequest', 'issue'],
					allReach: 'readable',
				},
			],
		},
	},
});

function npmPackArchive(files: Readonly<Record<string, string>>): Buffer {
	const blocks: Buffer[] = [];
	for (const [path, contents] of Object.entries(files)) {
		const body = Buffer.from(contents);
		const header = Buffer.alloc(512);
		header.write(path, 0, 100, 'utf8');
		writeOctal(header, 100, 8, 0o644);
		writeOctal(header, 108, 8, 0);
		writeOctal(header, 116, 8, 0);
		writeOctal(header, 124, 12, body.length);
		writeOctal(header, 136, 12, 0);
		header.fill(0x20, 148, 156);
		header[156] = 0x30;
		header.write('ustar\0', 257, 6, 'ascii');
		header.write('00', 263, 2, 'ascii');
		writeOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0));
		blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(blocks));
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
	const text = value.toString(8).padStart(length - 2, '0');
	target.write(`${text}\0 `, offset, length, 'ascii');
}

function listItem(page: Page, label: string) {
	return page
		.locator('.settings-list-column .settings-list-item')
		.filter({ has: page.locator('.settings-list-item-label', { hasText: label }) });
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	const path = testInfo.outputPath('screenshots', `${name}.png`);
	await page.screenshot({ path });
	await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('forge account filter: Home sections narrow to one account and remember it per section', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}, testInfo) => {
	await createWorkspace({ name: 'forge-accounts' });

	await test.step('install the fake two-account forge extension', async () => {
		const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'extensions' });
		await listItem(settings, 'Install extension…').click();
		await settings.locator('input[type="file"][accept*=".tgz"]').setInputFiles({
			name: 'terminay-e2e-forge-accounts-1.0.0.tgz',
			mimeType: 'application/gzip',
			buffer: npmPackArchive({
				'package/package.json': PACKAGE_JSON,
				'package/dist/extension.js': EXTENSION_SOURCE,
			}),
		});
		await settings.getByRole('button', { name: /Install on/u }).click();
		await expect(settings.getByRole('status').filter({ hasText: /was installed/u })).toBeVisible({ timeout: 30_000 });
		await settings.close();
	});

	const home = mainWindow.getByRole('button', { name: 'Home', exact: true });
	const sectionTab = (section: string) => mainWindow.locator(`[data-terminay-home-section-tab="${section}"]`);
	const pullsList = () => activeHome(mainWindow).locator('[data-forge-list="pullRequest"]');
	const issuesList = () => activeHome(mainWindow).locator('[data-forge-list="issue"]');
	const accountSelect = (list: ReturnType<typeof pullsList>) => list.locator('[data-forge-account-select]');
	const rows = (list: ReturnType<typeof pullsList>) => list.locator('[data-forge-row]');
	const alphaLabel = 'alice · alpha.e2e.test (E2E Forge)';
	const betaLabel = 'alice · beta.e2e.test (E2E Forge)';
	const remembered = (kind: 'pullRequest' | 'issue') =>
		mainWindow.evaluate(
			(key) => JSON.parse(localStorage.getItem(key) ?? '{}').account ?? null,
			`terminay.forge.${kind}.view.v1`,
		);

	await test.step('Pull Requests lists both accounts and offers the Account control', async () => {
		await home.click();
		await sectionTab('pullRequests').click();
		await expectHomeSection(mainWindow, 'pullRequests');
		await expect(rows(pullsList())).toHaveCount(3, { timeout: 30_000 });
		await expect(accountSelect(pullsList())).toBeVisible();
		await expect(accountSelect(pullsList()).locator('option')).toHaveText(['All accounts', alphaLabel, betaLabel]);
		await expect(accountSelect(pullsList()).locator('option:checked')).toHaveText('All accounts');
		await shot(mainWindow, testInfo, '01-pull-requests-all-accounts');
	});

	await test.step('choosing an account narrows the list and closes another account’s preview', async () => {
		await pullsList().locator('[data-forge-row="21"]').click();
		await expect(activeHome(mainWindow).locator('[data-forge-detail="21"]')).toBeVisible();
		await accountSelect(pullsList()).selectOption({ label: alphaLabel });
		await expect(rows(pullsList())).toHaveCount(2);
		await expect(pullsList().locator('[data-forge-row="21"]')).toHaveCount(0);
		await expect(pullsList()).toContainText('Alpha: add event stream');
		await expect(activeHome(mainWindow).locator('[data-forge-detail="21"]')).toHaveCount(0);
		expect(await remembered('pullRequest')).toEqual({ sourceId: SOURCE, origin: ALPHA });
		await shot(mainWindow, testInfo, '02-pull-requests-one-account');
	});

	await test.step('Issues keeps its own choice, and an empty account offers Show all accounts', async () => {
		await sectionTab('issues').click();
		await expectHomeSection(mainWindow, 'issues');
		await expect(rows(issuesList())).toHaveCount(1, { timeout: 30_000 });
		await expect(accountSelect(issuesList()).locator('option:checked')).toHaveText('All accounts');
		await accountSelect(issuesList()).selectOption({ label: betaLabel });
		const empty = issuesList().locator('[data-forge-empty="noMatchesForAccount"]');
		await expect(empty).toBeVisible();
		await expect(empty).toContainText('No issues for alice on beta.e2e.test.');
		await shot(mainWindow, testInfo, '03-issues-empty-for-account');
		await empty.getByRole('button', { name: 'Show all accounts' }).click();
		await expect(rows(issuesList())).toHaveCount(1);
		await expect(accountSelect(issuesList()).locator('option:checked')).toHaveText('All accounts');
		expect(await remembered('issue')).toBeNull();
	});

	await test.step('the choice survives reopening Home', async () => {
		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await home.click();
		await sectionTab('pullRequests').click();
		await expectHomeSection(mainWindow, 'pullRequests');
		await expect(accountSelect(pullsList()).locator('option:checked')).toHaveText(alphaLabel, { timeout: 30_000 });
		await expect(rows(pullsList())).toHaveCount(2);
		await sectionTab('issues').click();
		await expect(accountSelect(issuesList()).locator('option:checked')).toHaveText('All accounts');
		await expect(rows(issuesList())).toHaveCount(1);
	});
});
