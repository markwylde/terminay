import { expect, test, type Page } from '@playwright/test'
import {
  startSharedWebShellFixture,
  type SharedWebShellFixture,
} from './support/shared-web-shell-fixture'

let fixture: SharedWebShellFixture

test.beforeAll(async () => {
  fixture = await startSharedWebShellFixture()
})

test.afterAll(async () => {
  await fixture.close()
})

const routeRegions = {
  workspace: [
    'projects',
    'workspace-views',
    'dockview-panels',
    'sidebar',
    'terminal',
    'file',
    'folder',
    'agents',
    'git',
    'command-surface',
  ],
  settings: ['settings-sections', 'settings-editor'],
  connections: ['connection-list', 'connection-actions', 'connection-status'],
  recordings: ['recording-list', 'recording-controls', 'recording-replay'],
  macros: ['macro-list', 'macro-editor', 'macro-preview'],
  file: ['file-tree', 'file-tabs', 'file-editor', 'file-diff'],
  git: ['git-status', 'git-worktrees', 'git-quick-push'],
} as const

for (const viewport of [
  { name: 'wide browser', width: 1280, height: 820, layout: 'wide' },
  { name: 'medium browser', width: 900, height: 780, layout: 'medium' },
  { name: 'narrow mobile browser', width: 390, height: 740, layout: 'narrow' },
] as const) {
  test(`shared web shell exposes routes and regions without horizontal overflow at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(fixture.url)
    await page.getByLabel('Viewport width model').fill(String(viewport.width))

    const shell = page.locator('[data-shared-ui="responsive-workspace"]')
    await expect(shell).toBeVisible()
    await expect(shell).toHaveClass(new RegExp(`workspace-shell--${viewport.layout}`))
    await expect(shell).toHaveAttribute('data-shared-route', 'workspace')
    await expect(shell).toHaveAttribute('data-shared-route-component', 'shared.route.workspace')
    await expect(shell).toHaveAttribute(
      'data-shared-route-registry',
      'workspace,connections,settings,recordings,macros,file,git',
    )

    for (const route of Object.keys(routeRegions) as (keyof typeof routeRegions)[]) {
      const regions = routeRegions[route]
      await page.getByRole('tab', { name: routeLabel(route), exact: true }).click()
      await expect(shell).toHaveAttribute('data-shared-route', route)
      await expect(shell).toHaveAttribute('data-shared-route-component', `shared.route.${route}`)
      await expect(shell).toHaveAttribute('data-shared-route-presentation', 'in-page')
      await expectSharedRegions(page, regions)
      await expectNoHorizontalOverflow(page)
    }
  })
}

for (const viewport of [
  { name: 'wide', width: 1280, height: 820 },
  { name: 'medium', width: 900, height: 780 },
  { name: 'narrow', width: 390, height: 740 },
] as const) {
  test(`shared web shell skips route navigation into the active panel at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(fixture.url)
    await page.getByLabel('Viewport width model').fill(String(viewport.width))

    const shell = page.locator('[data-shared-ui="responsive-workspace"]')
    const activeTab = page.getByRole('tab', { name: 'Workspace', exact: true })
    const panel = page.getByRole('tabpanel', { name: 'Workspace' })
    const skipLink = page.getByRole('link', { name: 'Skip route navigation' })
    await expect(skipLink).toHaveAttribute('href', `#${await panel.getAttribute('id')}`)
    await skipLink.focus()
    await expect(skipLink).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(panel).toBeFocused()
    await expect(activeTab).toHaveAttribute('aria-selected', 'true')
    await expect(shell).toHaveAttribute('data-shared-route', 'workspace')
    await expectNoHorizontalOverflow(page)
  })
}

test('shared web shell preserves the selected route across portrait and landscape reflow', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 740 })
	await page.goto(fixture.url)
	await page.getByLabel('Viewport width model').fill('390')

	const shell = page.locator('[data-shared-ui="responsive-workspace"]')
	await page.getByRole('tab', { name: 'Recordings', exact: true }).click()
	await expect(shell).toHaveAttribute('data-shared-route', 'recordings')
	await expect(shell).toHaveClass(/workspace-shell--narrow/)
	await expectSharedRegions(page, routeRegions.recordings)
	await expectNoHorizontalOverflow(page)

	await page.setViewportSize({ width: 844, height: 390 })
	await page.getByLabel('Viewport width model').fill('844')
	await expect(shell).toHaveAttribute('data-shared-route', 'recordings')
	await expect(shell).toHaveClass(/workspace-shell--medium/)
	await expectSharedRegions(page, routeRegions.recordings)
	await expectNoHorizontalOverflow(page)
})

test('shared web shell renders the host-neutral accessibility preference contract', async ({ page }) => {
	await page.setViewportSize({ width: 900, height: 780 })
	await page.goto(fixture.url)
	await page.getByLabel('Viewport width model').fill('900')

	const shell = page.locator('[data-shared-ui="responsive-workspace"]')
	await expect(shell).toHaveAttribute('data-shared-motion', 'standard')
	await expect(shell).toHaveAttribute('data-shared-forced-colors', 'false')
	await expect(shell).toHaveAttribute('data-shared-color-scheme', 'system')

	await page.getByLabel('Reduced motion preference').evaluate((input: HTMLInputElement) => input.click())
	await page.getByLabel('Forced colors preference').evaluate((input: HTMLInputElement) => input.click())
	await page.getByLabel('Color scheme preference').selectOption('dark')
	await expect(shell).toHaveAttribute('data-shared-motion', 'none')
	await expect(shell).toHaveAttribute('data-shared-forced-colors', 'true')
	await expect(shell).toHaveAttribute('data-shared-color-scheme', 'dark')
	await expect(shell).toHaveCSS('color-scheme', 'dark')
	await expectNoHorizontalOverflow(page)
})

for (const viewport of [
  { name: 'wide', width: 1280, height: 820, orientation: 'vertical' },
  { name: 'medium', width: 900, height: 780, orientation: 'vertical' },
  { name: 'narrow', width: 390, height: 740, orientation: 'horizontal' },
] as const) {
  test(`shared route rail uses the shared roving tab contract at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(fixture.url)
    await page.getByLabel('Viewport width model').fill(String(viewport.width))

    const shell = page.locator('[data-shared-ui="responsive-workspace"]')
    const routeRail = page.getByRole('tablist', { name: 'Workspace routes' })
    await expect(routeRail).toHaveAttribute('aria-orientation', viewport.orientation)
    const workspace = page.getByRole('tab', { name: 'Workspace', exact: true })
    const connections = page.getByRole('tab', { name: 'Connections', exact: true })
    await expect(workspace).toHaveAttribute('aria-selected', 'true')
    await expect(workspace).toHaveAttribute('tabindex', '0')
    await expect(connections).toHaveAttribute('tabindex', '-1')
    await expect(page.getByRole('tabpanel', { name: 'Workspace' })).toHaveAttribute('aria-labelledby', await workspace.getAttribute('id') ?? '')

    await workspace.focus()
    await page.keyboard.press('ArrowRight')
    await expect(connections).toBeFocused()
    await expect(shell).toHaveAttribute('data-shared-route', 'connections')
    await expect(connections).toHaveAttribute('aria-selected', 'true')
    await expect(connections).toHaveAttribute('tabindex', '0')
    await expect(page.getByRole('tabpanel', { name: 'Connections' })).toHaveAttribute('aria-labelledby', await connections.getAttribute('id') ?? '')
    await expectNoHorizontalOverflow(page)
  })
}

function routeLabel(route: keyof typeof routeRegions): string {
  return route === 'git' ? 'Git' : `${route.slice(0, 1).toUpperCase()}${route.slice(1)}`
}

async function expectSharedRegions(
  page: Page,
  regions: readonly string[],
): Promise<void> {
  for (const region of regions) {
    await expect(page.locator(`[data-shared-region-marker="${region}"]`)).toBeVisible()
  }
  await expect(page.locator('[data-shared-region="terminal"]')).toBeVisible()
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement
    const body = document.body
    const shell = document.querySelector('[data-shared-ui="responsive-workspace"]')
    const terminal = document.querySelector('[data-shared-region="terminal"]')
    const viewportWidth = documentElement.clientWidth
    const shellRect = shell?.getBoundingClientRect()
    const terminalRect = terminal?.getBoundingClientRect()
    return {
      bodyScrollWidth: body.scrollWidth,
      documentScrollWidth: documentElement.scrollWidth,
      shellLeft: shellRect?.left ?? Number.NaN,
      shellRight: shellRect?.right ?? Number.NaN,
      terminalLeft: terminalRect?.left ?? Number.NaN,
      terminalRight: terminalRect?.right ?? Number.NaN,
      viewportWidth,
    }
  })
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth)
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth)
  expect(overflow.shellLeft).toBeGreaterThanOrEqual(0)
  expect(overflow.shellRight).toBeLessThanOrEqual(overflow.viewportWidth)
  expect(overflow.terminalLeft).toBeGreaterThanOrEqual(0)
  expect(overflow.terminalRight).toBeLessThanOrEqual(overflow.viewportWidth)
}
