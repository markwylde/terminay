import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { foldersColumn } from './support/folders';
import { createStartedProject } from './support/project-start';

/**
 * The Folders tree and the sidebar each have one width on a device, shared by
 * every project, and Home's sidebar has its own. Each test resizes a column
 * the way a person does and reads the widths back off the screen.
 */

test.describe.configure({ timeout: 90_000 });

const ACTIVE = '.project-workspace--active';

function sidebar(page: Page): Locator {
	return page.locator(`${ACTIVE} .workspace-split-layout__navigation`);
}

function homeSidebar(page: Page): Locator {
	return page.locator('.home-view .workspace-split-layout__navigation');
}

/** Show the project sidebar if it is hidden. Its column is in the page either
 * way, so what is checked is whether its contents are drawn. */
async function openSidebar(page: Page) {
	const contents = page.locator(`${ACTIVE} .file-explorer-sidebar`);
	if (!(await contents.isVisible()))
		await page.getByLabel('Toggle file explorer').click();
	await expect(contents).toBeVisible();
}

async function widthOf(column: Locator): Promise<number> {
	return (await column.boundingBox())?.width ?? 0;
}

/** Drag a separator sideways by `dx` pixels. */
async function dragSeparator(page: Page, separator: Locator, dx: number) {
	const handle = await separator.boundingBox();
	if (handle === null) throw new Error('The separator is not on screen.');
	const x = handle.x + handle.width / 2;
	const y = handle.y + handle.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx, y, { steps: 6 });
	await page.mouse.up();
}

async function expectWidthNear(column: Locator, width: number) {
	await expect
		.poll(async () => Math.abs((await widthOf(column)) - width))
		.toBeLessThan(3);
}

test('resizing the Folders tree or the sidebar in one project resizes it in every project, and both survive a reload', async ({
	mainWindow,
}) => {
	await createStartedProject(mainWindow);
	const projects = mainWindow.locator('.project-tab');
	await expect(projects).toHaveCount(2);
	const first = projects.first();
	const second = projects.last();

	await first.click();
	await expect(first).toHaveClass(/project-tab--active/);
	await expect(foldersColumn(mainWindow)).toBeVisible();
	await openSidebar(mainWindow);
	await expect(sidebar(mainWindow)).toBeVisible();

	const foldersBefore = await widthOf(foldersColumn(mainWindow));
	const sidebarBefore = await widthOf(sidebar(mainWindow));

	// Widen the Folders tree: the sidebar keeps its width.
	await dragSeparator(
		mainWindow,
		mainWindow.locator(`${ACTIVE} .workspace-split-layout__folders-separator`),
		60,
	);
	await expect
		.poll(() => widthOf(foldersColumn(mainWindow)))
		.toBeGreaterThan(foldersBefore + 40);
	const foldersWidth = await widthOf(foldersColumn(mainWindow));
	await expectWidthNear(sidebar(mainWindow), sidebarBefore);

	// Widen the sidebar, which sits on the trailing side.
	await dragSeparator(
		mainWindow,
		mainWindow.locator(`${ACTIVE} .workspace-split-layout__separator`),
		-50,
	);
	await expect
		.poll(() => widthOf(sidebar(mainWindow)))
		.toBeGreaterThan(sidebarBefore + 30);
	const sidebarWidth = await widthOf(sidebar(mainWindow));
	await expectWidthNear(foldersColumn(mainWindow), foldersWidth);

	// The other project has the same widths.
	await second.click();
	await expect(second).toHaveClass(/project-tab--active/);
	await expect(foldersColumn(mainWindow)).toBeVisible();
	await openSidebar(mainWindow);
	await expectWidthNear(foldersColumn(mainWindow), foldersWidth);
	await expectWidthNear(sidebar(mainWindow), sidebarWidth);

	// The device remembers them.
	await mainWindow.reload();
	await expect(foldersColumn(mainWindow)).toBeVisible();
	await expect(sidebar(mainWindow)).toBeVisible();
	await expectWidthNear(foldersColumn(mainWindow), foldersWidth);
	await expectWidthNear(sidebar(mainWindow), sidebarWidth);
});

test("Home's sidebar has its own remembered width and resizing it leaves the project columns alone", async ({
	mainWindow,
}) => {
	await expect(foldersColumn(mainWindow)).toBeVisible();
	const foldersWidth = await widthOf(foldersColumn(mainWindow));

	await mainWindow.getByRole('button', { name: 'Home', exact: true }).click();
	await expect(mainWindow.locator('[data-terminay-home-sidebar]')).toBeVisible();
	const homeBefore = await widthOf(homeSidebar(mainWindow));
	await dragSeparator(
		mainWindow,
		mainWindow.locator('.home-view .workspace-split-layout__separator'),
		70,
	);
	await expect
		.poll(() => widthOf(homeSidebar(mainWindow)))
		.toBeGreaterThan(homeBefore + 50);
	const homeWidth = await widthOf(homeSidebar(mainWindow));

	await mainWindow.locator('.project-tab').first().click();
	await expectWidthNear(foldersColumn(mainWindow), foldersWidth);

	await mainWindow.reload();
	await mainWindow.getByRole('button', { name: 'Home', exact: true }).click();
	await expect(mainWindow.locator('[data-terminay-home-sidebar]')).toBeVisible();
	await expectWidthNear(homeSidebar(mainWindow), homeWidth);
});
