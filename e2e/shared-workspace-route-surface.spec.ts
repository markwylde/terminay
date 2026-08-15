import { expect, test } from '@playwright/test'
import { startSharedWebShellFixture, type SharedWebShellFixture } from './support/shared-web-shell-fixture'

let fixture: SharedWebShellFixture
test.beforeAll(async () => { fixture = await startSharedWebShellFixture() })
test.afterAll(async () => { await fixture.close() })

for (const viewport of [{ name: 'wide', width: 1280, height: 900, layout: 'wide' }, { name: 'medium', width: 900, height: 900, layout: 'medium' }, { name: 'narrow', width: 390, height: 820, layout: 'narrow' }] as const) {
	test(`shared composed route renders in-page at ${viewport.name} width`, async ({ page }) => {
		await page.setViewportSize(viewport)
		await page.goto(`${fixture.origin}/e2e/fixtures/shared-workspace-route-surface.html`)
		const route = page.locator('[data-shared-workspace-route="connections"]')
		await expect(route).toHaveAttribute('data-shared-workspace-layout', viewport.layout)
		await expect(route.locator('[data-shared-panel-contract]')).toHaveCount(3)
		await expect(route.locator('[data-shared-panel-contract]').evaluateAll(items => items.map(item => item.getAttribute('data-shared-panel-contract')))).resolves.toEqual(['connection-form', 'connection-switcher', 'connection-error'])
		await expect(route.locator('[data-shared-panel-contract="connection-error"]')).toHaveAttribute('role', 'alert')
		await route.locator('[data-shared-panel-contract="connection-error"] [data-shared-panel-action]').first().click()
		const settingsRoute = page.locator('[data-shared-workspace-route="settings"]')
		await expect(settingsRoute).toHaveAttribute('data-shared-workspace-layout', viewport.layout)
		await expect(settingsRoute.locator('[data-shared-panel-contract]').evaluateAll(items => items.map(item => item.getAttribute('data-shared-panel-contract')))).resolves.toEqual(['settings', 'dictation-capture'])
		await expect(settingsRoute.locator('[data-shared-panel-contract="dictation-capture"]')).toHaveAttribute('role', 'dialog')
		await expect(settingsRoute.locator('[data-shared-panel-contract="dictation-capture"]')).toHaveAttribute('aria-modal', 'true')
		await settingsRoute.locator('[data-shared-panel-contract="dictation-capture"] [data-shared-panel-action="stop-dictation"]').click()
		await expect(page.locator('[data-shared-route-intent]')).toHaveText('dictation-capture:stop-dictation')
		for (const [routeName, panelIds] of [
			['recordings', ['recordings-library', 'recording-detail']],
			['macros', ['macro-library', 'macro-editor']],
			['file', ['file-viewer', 'folder-browser']],
			['git', ['git-status', 'quick-push-review']],
		] as const) {
			const sharedRoute = page.locator(`[data-shared-workspace-route="${routeName}"]`)
			await expect(sharedRoute).toHaveAttribute('data-shared-workspace-layout', viewport.layout)
			await expect(sharedRoute.locator('[data-shared-panel-contract]').evaluateAll(items => items.map(item => item.getAttribute('data-shared-panel-contract')))).resolves.toEqual(panelIds)
		}
		await page.locator('[data-shared-workspace-route="git"] [data-shared-panel-action="open-git"]').click()
		await expect(page.locator('[data-shared-route-intent]')).toHaveText('git-status:open-git')
		const workspaceRoute = page.locator('[data-shared-workspace-route="workspace"]')
		await expect(workspaceRoute).toHaveAttribute('data-shared-workspace-layout', viewport.layout)
		await expect(workspaceRoute.locator('[data-shared-panel-contract]').evaluateAll(items => items.map(item => item.getAttribute('data-shared-panel-contract')))).resolves.toEqual([
			'workspace-tabs', 'workspace-views', 'dockview-navigation', 'activity-indicator', 'activity-notifications', 'terminal-session', 'file-viewer', 'folder-browser', 'agent-status', 'ai-tab-metadata', 'command-surface', 'workspace-empty',
		])
		await expect(workspaceRoute.locator('[data-shared-panel-contract="workspace-views"]')).toHaveAttribute('role', 'navigation')
		await expect(workspaceRoute.locator('[data-shared-panel-contract="workspace-empty"]')).toHaveAttribute('role', 'status')
		const workspaceTabs = workspaceRoute.locator('[data-shared-panel-contract="workspace-tabs"] [role="tablist"]')
		await expect(workspaceTabs).toHaveAttribute('aria-label', 'Open workspace tabs')
		await expect(workspaceTabs.locator('[role="tab"]')).toHaveCount(2)
		await expect(workspaceTabs.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1)
		const folderTree = workspaceRoute.locator('[data-shared-panel-contract="folder-browser"] [role="tree"]')
		await expect(folderTree).toHaveAttribute('aria-label', 'Entries in Root')
		await expect(folderTree.locator('[role="treeitem"]')).toHaveCount(2)
		await expect(folderTree.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1)
		await folderTree.locator('[data-shared-panel-action="select-folder-entry"]').first().click()
		await expect(page.locator('[data-shared-route-intent]')).toHaveText('folder-browser:select-folder-entry')
		const terminalOutput = workspaceRoute.locator('[data-shared-panel-contract="terminal-session"] [data-shared-panel-output-region]')
		await expect(terminalOutput).toHaveAttribute('role', 'log')
		await expect(terminalOutput).toHaveAttribute('aria-live', 'off')
		await expect(terminalOutput).toHaveAttribute('aria-label', 'Terminal output for Build')
		await workspaceRoute.locator('[data-shared-panel-contract="terminal-session"] [data-shared-panel-action="retry-terminal"]').click()
		await expect(page.locator('[data-shared-route-intent]')).toHaveText('terminal-session:retry-terminal')
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
		expect(overflow).toBe(false)
	})
}

test('shared route surface rejects a mutable host model before it can render', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.goto(`${fixture.origin}/e2e/fixtures/shared-workspace-route-surface.html?mutable=1`)
	await expect(page.locator('[data-shared-route-rejection]')).toHaveText('Shared route models must be deeply frozen before rendering')
	await expect(page.locator('[data-shared-workspace-route="connections"]')).toHaveCount(0)
})
