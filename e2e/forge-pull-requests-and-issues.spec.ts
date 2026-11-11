import { execSync } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { folderGroup, folderRow, folderTerminals, git, initRepository } from './support/folders';
import { activeHome, expectHomeSection } from './support/home-tabs';
import { setProjectRoot } from './support/ui';

/**
 * Pull Requests and Issues end to end. A fake forge extension, uploaded through
 * Settings › Extensions, answers for `acme/app` on `https://forge.e2e.test`. The
 * project's `origin` is `https://forge.e2e.test/acme/app.git`, which the fake
 * claims, and Git rewrites it to a local bare repository, so checkout and Start
 * work fetch for real. Claude Code is the fake `claude` (e2e/fixtures/fake-claude-chat.mjs);
 * the prompt it was started with is read back from its command line.
 */

test.describe.configure({ timeout: 300_000 });

const ORIGIN = 'https://forge.e2e.test';
const SOURCE = 'dev.terminay.e2e-forge/forge';
const ISSUE_541 = 'Home sidebar: Pull Requests and Issues sections';
const ISSUE_541_BRANCH = 'issue-541-home-sidebar-pull-requests-and-issues-sections';
const ISSUE_542_BRANCH = 'issue-542-sync-forge-counts';

/** The fake source: one account, a claim on acme/app, fixed items. */
const EXTENSION_SOURCE = `
const ORIGIN = ${JSON.stringify(ORIGIN)};
const at = (day) => '2026-11-' + String(day).padStart(2, '0') + 'T10:00:00Z';
const reference = (kind, number) => ({ kind, origin: ORIGIN, owner: 'acme', name: 'app', number });
const pull = (number, title, day, head, extra = {}) => ({
  reference: reference('pullRequest', number),
  title,
  url: ORIGIN + '/acme/app/pulls/' + number,
  state: 'open',
  author: 'octo',
  labels: [{ name: 'feature', color: '0e8a16' }],
  comments: 1,
  createdAt: at(1),
  updatedAt: at(day),
  pullRequest: { headBranch: head, baseBranch: 'main', headOwner: 'acme', headName: 'app', ...extra },
});
const issue = (number, title, day) => ({
  reference: reference('issue', number),
  title,
  url: ORIGIN + '/acme/app/issues/' + number,
  state: 'open',
  author: 'octo',
  labels: [],
  comments: 0,
  createdAt: at(1),
  updatedAt: at(day),
});
const ITEMS = [
  pull(88, 'Add event stream', 10, 'change/13-events', {
    checks: {
      passed: 1, failed: 2, pending: 0, skipped: 0, total: 3,
      items: [
        { name: 'build', state: 'passed' },
        { name: 'lint', state: 'failed' },
        { name: 'test', state: 'failed' },
      ],
    },
  }),
  pull(90, 'Fix typo from a fork', 9, 'typo', { headOwner: 'forker' }),
  issue(541, ${JSON.stringify(ISSUE_541)}, 8),
  issue(542, 'Sync forge counts', 7),
];

export function activate(context) {
  context.subscriptions.add(context.forges.registerSource(${JSON.stringify(SOURCE)}, {
    async accounts() {
      return [{ origin: ORIGIN, login: 'octo', credentialSource: 'cli-config', state: 'ready', owners: ['octo', 'acme'] }];
    },
    async claim(remote) {
      return /acme\\/app(\\.git)?$/u.test(remote.url) ? { origin: ORIGIN, owner: 'acme', name: 'app' } : null;
    },
    async query(query) {
      const items = ITEMS.filter((item) =>
        item.reference.kind === query.kind && (query.state === 'open' || query.state === 'all'));
      return { items, totalCount: items.length };
    },
    async detail(ref) {
      const summary = ITEMS.find((item) => item.reference.kind === ref.kind && item.reference.number === ref.number);
      if (summary === undefined) throw new Error('no such item');
      return { summary, body: 'The body of #' + ref.number + '.', comments: [] };
    },
  }));
}
`;

const PACKAGE_JSON = JSON.stringify({
	name: 'terminay-e2e-forge',
	version: '1.0.0',
	type: 'module',
	exports: { '.': './dist/extension.js' },
	terminay: {
		manifestVersion: 1,
		id: 'dev.terminay.e2e-forge',
		displayName: 'E2E Forge extension',
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

/** Every running copy of the fake `claude`, as its full command line. */
function fakeClaudeCommandLines(): string[] {
	try {
		return execSync('ps -eo args')
			.toString()
			.split('\n')
			.filter((line) => line.includes('fake-claude-chat.mjs'));
	} catch {
		return [];
	}
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	const path = testInfo.outputPath('screenshots', `${name}.png`);
	await page.screenshot({ path });
	await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** A project cloned from a bare `…/acme/app.git` with a pushed PR branch. */
async function seedRepository(rootDir: string): Promise<string> {
	const base = await realpath(rootDir);
	const seed = join(base, 'seed');
	const bare = join(base, 'forge', 'acme', 'app.git');
	await mkdir(seed, { recursive: true });
	await mkdir(bare, { recursive: true });
	await writeFile(join(seed, 'README.md'), '# app\n', 'utf8');
	await initRepository(seed);
	await git(seed, 'checkout', '-b', 'change/13-events');
	await writeFile(join(seed, 'events.txt'), 'events\n', 'utf8');
	await git(seed, 'add', '.');
	await git(seed, 'commit', '-m', 'events');
	await git(seed, 'checkout', 'main');
	await git(bare, 'init', '--bare', '-b', 'main');
	await git(seed, 'push', bare, 'main', 'change/13-events');
	await git(base, 'clone', bare, 'app');
	// A claim must name the remote's own host, so `origin` reads as the forge's
	// HTTPS URL; Git rewrites it to the bare repository when it fetches.
	const app = join(base, 'app');
	const forgeUrl = `${ORIGIN}/acme/app.git`;
	await git(app, 'remote', 'set-url', 'origin', forgeUrl);
	await git(app, 'config', `url.${bare}.insteadOf`, forgeUrl);
	return app;
}

test('forge pull requests and issues: Home sections, worktree actions, project tabs, and Settings', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}, testInfo) => {
	const workspace = await createWorkspace({ name: 'forge' });
	const project = await seedRepository(workspace.rootDir);
	await setProjectRoot(mainWindow, project);

	await test.step('install the fake forge extension', async () => {
		const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'extensions' });
		await listItem(settings, 'Install extension…').click();
		await settings.locator('input[type="file"][accept*=".tgz"]').setInputFiles({
			name: 'terminay-e2e-forge-1.0.0.tgz',
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
	const detail = (number: number) => activeHome(mainWindow).locator(`[data-forge-detail="${number}"]`);

	await test.step('Home › Pull Requests lists and details pull requests', async () => {
		await home.click();
		// Needs my review counts both open pull requests in a neutral badge.
		await expect(sectionTab('pullRequests').locator('.home-sidebar__badge--neutral')).toHaveText('2', { timeout: 30_000 });
		await sectionTab('pullRequests').click();
		await expectHomeSection(mainWindow, 'pullRequests');
		await expect(pullsList().locator('[data-forge-scope="reviewRequested"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(pullsList().locator('[data-forge-group="acme/app"]')).toBeVisible({ timeout: 30_000 });
		await expect(pullsList().locator('[data-forge-row]')).toHaveCount(2);
		await expect(pullsList().locator('[data-forge-row]').first()).toContainText('Add event stream');

		// A fork's pull request says why it cannot be checked out.
		await pullsList().locator('[data-forge-row="90"]').click();
		await expect(detail(90)).toBeVisible();
		await expect(detail(90).locator('[data-forge-action="Check out in new worktree"]')).toBeDisabled();
		await expect(detail(90).locator('[data-forge-reason="Check out in new worktree"]')).toContainText(/fork/iu);

		// Failed checks come first.
		await pullsList().locator('[data-forge-row="88"]').click();
		await expect(detail(88)).toBeVisible();
		await expect(detail(88).locator('[data-forge-check]')).toHaveCount(3);
		await expect(detail(88).locator('[data-forge-check]').nth(0)).toHaveAttribute('data-forge-check', 'failed');
		await expect(detail(88).locator('[data-forge-check]').nth(1)).toHaveAttribute('data-forge-check', 'failed');
		await expect(detail(88).locator('[data-forge-check]').nth(2)).toHaveAttribute('data-forge-check', 'passed');
		await expect(detail(88).locator('[data-forge-body]')).toContainText('The body of #88.');
		await shot(mainWindow, testInfo, '01-home-pull-requests');
	});

	await test.step('Check out in new worktree creates and selects the linked folder', async () => {
		await detail(88).locator('[data-forge-action="Check out in new worktree"]').click();
		await expect(folderRow(mainWindow, 'change/13-events')).toBeVisible({ timeout: 30_000 });
		await expect(folderRow(mainWindow, 'change/13-events')).toHaveClass(/folders-tree__row--selected/);
		await shot(mainWindow, testInfo, '02-checked-out-folder');
	});

	await test.step('the project Pull Requests tab shows This worktree, and a row opens Home', async () => {
		const tab = mainWindow
			.locator('.project-workspace--active')
			.getByRole('tab', { name: /^Pull Requests/u });
		await expect(tab).toHaveAccessibleName('Pull Requests, 2', { timeout: 30_000 });
		await tab.click();
		const pane = mainWindow.locator('.project-workspace--active [data-forge-project-tab="pullRequest"]');
		await expect(pane.locator('[data-forge-tab-group="thisWorktree"] [data-forge-row="88"]')).toBeVisible({ timeout: 30_000 });
		await expect(pane.locator('[data-forge-tab-group="open"] [data-forge-row="90"]')).toBeVisible();
		await expect(pane.locator('[data-forge-show-all="pullRequest"]')).toBeVisible();
		await shot(mainWindow, testInfo, '03-project-pull-requests-tab');
		await pane.locator('[data-forge-row="88"]').click();
		await expectHomeSection(mainWindow, 'pullRequests');
		await expect(detail(88)).toBeVisible();
		// Now checked out, the item opens its worktree instead.
		await expect(detail(88).locator('[data-forge-action="Open worktree"]')).toBeEnabled({ timeout: 30_000 });
		await expect(pullsList().locator('[data-forge-row="88"] [data-forge-worktree-chip]')).toBeVisible();
	});

	await test.step('Review with agent starts Claude Code in the worktree with the prompt', async () => {
		await detail(88).locator('[data-forge-action="Review with agent"]').click();
		const panel = detail(88).locator('[data-forge-panel="review"]');
		await expect(panel.locator('select')).toHaveValue(/claude/iu, { timeout: 30_000 });
		await expect(panel.locator('textarea')).toHaveValue(/^Review pull request #88/u);
		await shot(mainWindow, testInfo, '04-review-with-agent');
		await panel.getByRole('button', { name: 'Start review' }).click();
		await expect(folderTerminals(mainWindow, 'change/13-events')).toHaveCount(1, { timeout: 30_000 });
		await expect
			.poll(() => fakeClaudeCommandLines().some((line) => line.includes('Review pull request #88')), { timeout: 30_000 })
			.toBe(true);
	});

	await test.step('Home › Issues: Start work with Shell only and with Claude Code', async () => {
		await home.click();
		await sectionTab('issues').click();
		await expectHomeSection(mainWindow, 'issues');
		await expect(issuesList().locator('[data-forge-scope="assigned"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(issuesList().locator('[data-forge-row]')).toHaveCount(2, { timeout: 30_000 });

		await issuesList().locator('[data-forge-row="541"]').click();
		await expect(detail(541)).toContainText(ISSUE_541);
		await detail(541).locator('[data-forge-action="Start work"]').click();
		const panel = detail(541).locator('[data-forge-panel="startWork"]');
		await expect(panel.locator('[data-forge-branch]')).toHaveValue(ISSUE_541_BRANCH);
		await expect(panel.locator('[data-forge-planned-path]')).not.toBeEmpty({ timeout: 30_000 });
		await panel.locator('[data-forge-launcher]').selectOption({ label: 'Shell only' });
		await shot(mainWindow, testInfo, '05-start-work');
		await panel.getByRole('button', { name: 'Start work' }).click();
		// The left column still shows Pull Requests from before; back to the tree.
		await mainWindow.locator('.project-workspace--active').getByRole('tab', { name: 'Tabs', exact: true }).click();
		await expect(folderRow(mainWindow, ISSUE_541_BRANCH)).toBeVisible({ timeout: 30_000 });
		await expect(folderTerminals(mainWindow, ISSUE_541_BRANCH)).toHaveCount(1, { timeout: 30_000 });

		await home.click();
		await expectHomeSection(mainWindow, 'issues');
		await issuesList().locator('[data-forge-row="542"]').click();
		await detail(542).locator('[data-forge-action="Start work"]').click();
		const second = detail(542).locator('[data-forge-panel="startWork"]');
		await expect(second.locator('[data-forge-branch]')).toHaveValue(ISSUE_542_BRANCH);
		await expect(second.locator('[data-forge-launcher]')).toHaveValue(/claude/iu, { timeout: 30_000 });
		await expect(second.locator('textarea')).toHaveValue(/^Work on issue #542/u);
		await expect(second.getByRole('button', { name: 'Start work' })).toBeEnabled({ timeout: 30_000 });
		await second.getByRole('button', { name: 'Start work' }).click();
		await expect(folderTerminals(mainWindow, ISSUE_542_BRANCH)).toHaveCount(1, { timeout: 30_000 });
		await expect
			.poll(() => fakeClaudeCommandLines().some((line) => line.includes('Work on issue #542')), { timeout: 30_000 })
			.toBe(true);
		await expect(folderGroup(mainWindow, ISSUE_542_BRANCH)).toBeVisible();
	});

	await test.step('Settings shows the account and switches; Issues on Home off stops listing its issues', async () => {
		const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'extensions' });
		await listItem(settings, 'E2E Forge extension').click();
		const forge = settings.locator('[data-forge-settings]');
		await expect(forge).toBeVisible({ timeout: 30_000 });
		await expect(forge).toContainText('octo');
		await expect(forge.getByRole('radiogroup', { name: 'Repositories' })).toBeVisible();
		await shot(settings, testInfo, '06-settings');
		const issuesSwitch = forge.locator('[data-forge-switch="issuesOnHome"] input[type="checkbox"]');
		await expect(issuesSwitch).toBeChecked();
		await forge.locator('[data-forge-switch="issuesOnHome"] .settings-switch').click();
		await expect(issuesSwitch).not.toBeChecked({ timeout: 30_000 });
		await settings.close();
		// The switch is per extension: the built-in forges still offer Issues, so
		// the section stays, but it no longer asks this source.
		await home.click();
		await sectionTab('issues').click();
		await expect(issuesList().locator('[data-forge-row]')).toHaveCount(0, { timeout: 30_000 });
		await expect(sectionTab('pullRequests').locator('.home-sidebar__badge--neutral')).toHaveText('2');
	});
});
