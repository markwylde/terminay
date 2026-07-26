import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { sendAppCommand } from './support/app'
import { openFileExplorer } from './support/ui'

async function getActiveSessionId(page: Page): Promise<string> {
  const sessionId = await page
    .locator('.terminal-panel')
    .first()
    .getAttribute('data-terminay-terminal-session-id')
  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }
  return sessionId
}

async function emitHook(
  page: Page,
  terminalSessionId: string,
  nativePayload: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    async ({ payload, sessionId }) => {
      if (!window.terminayTest) {
        throw new Error('Terminay test API is unavailable')
      }
      await window.terminayTest.emitAgentHook({
        provider: 'codex',
        terminalSessionId: sessionId,
        nativePayload: payload,
      })
    },
    { payload: nativePayload, sessionId: terminalSessionId },
  )
}

test('native agent lifecycle drives stable tabs, notifications, hierarchy, and focus', async ({
  mainWindow,
}) => {
  await sendAppCommand(mainWindow, 'new-terminal')
  await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(2)
  const agentTerminalSessionId = await getActiveSessionId(mainWindow)
  const agentTab = mainWindow
    .locator('.terminal-tab-content')
    .filter({ hasText: 'Terminal 2' })

  await mainWindow
    .locator('.terminal-tab-content')
    .filter({ hasText: 'Terminal 1' })
    .click()

  await emitHook(mainWindow, agentTerminalSessionId, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'codex-e2e-root',
    prompt: 'Implement the stable agent status flow',
    model: 'gpt-test-codex',
  })
  await expect(
    agentTab.locator('.agent-status-indicator[data-agent-state="working"]'),
  ).toBeVisible()

  await openFileExplorer(mainWindow)
  await expect(
    mainWindow.getByRole('button', { name: /^Agents/ }),
  ).toHaveAttribute('aria-expanded', 'true')
  await expect(mainWindow.getByRole('tab', { name: /Agents/ })).toHaveCount(0)
  await expect(mainWindow.locator('.agents-sidebar__name')).toContainText('Codex')
  await expect(mainWindow.locator('.agents-sidebar__metadata')).toContainText(
    'gpt-test-codex',
  )
  await expect(mainWindow.locator('.agents-sidebar__prompt')).toContainText(
    'Implement the stable agent status flow',
  )

  await emitHook(mainWindow, agentTerminalSessionId, {
    hook_event_name: 'SubagentStart',
    session_id: 'codex-e2e-root',
    agent_id: 'reviewer-child',
    agent_type: 'Reviewer',
  })
  const childRow = mainWindow.getByRole('button', {
    name: 'Focus Reviewer terminal',
  })
  await expect(childRow).toBeVisible()

  await emitHook(mainWindow, agentTerminalSessionId, {
    hook_event_name: 'PermissionRequest',
    session_id: 'codex-e2e-root',
    message: 'Approval required',
  })
  await expect(
    agentTab.locator('.agent-status-indicator[data-agent-state="waiting"]'),
  ).toBeVisible()
  await expect(mainWindow.locator('.terminal-activity-pill--attention')).toHaveText(
    '1',
  )

  await childRow.click()
  await expect(agentTab).toHaveClass(/terminal-tab-content--active/)

  await emitHook(mainWindow, agentTerminalSessionId, {
    hook_event_name: 'Stop',
    session_id: 'codex-e2e-root',
  })
  // A lead finishing does not make the terminal done while a child is active.
  await expect(
    agentTab.locator('.agent-status-indicator[data-agent-state="working"]'),
  ).toBeVisible()

  await emitHook(mainWindow, agentTerminalSessionId, {
    hook_event_name: 'SubagentStop',
    session_id: 'codex-e2e-root',
    agent_id: 'reviewer-child',
  })
  await expect(
    agentTab.locator('.agent-status-indicator[data-agent-state="done"]'),
  ).toBeVisible()

  await mainWindow.evaluate((sessionId) => {
    window.terminay.writeTerminal(sessionId, "printf 'trailing repaint\\n'\r")
  }, agentTerminalSessionId)
  await mainWindow.waitForTimeout(400)
  await expect(
    agentTab.locator('.agent-status-indicator[data-agent-state="done"]'),
  ).toBeVisible()
})

test('agent integration setting disables and restores the full agent surface', async ({
  appHarness,
  mainWindow,
}) => {
  const settingsWindow = await appHarness.openSettingsWindow({
    page: mainWindow,
    sectionId: 'agent-integration',
  })
  const integrationLabel = settingsWindow.getByLabel(
    'Agent status and sidebar',
  )
  const integrationToggle = integrationLabel.locator('input[type="checkbox"]')
  await expect(integrationToggle).toBeChecked()
  await integrationToggle.evaluate((element) => {
    ;(element as HTMLInputElement).click()
  })
  await expect(integrationToggle).not.toBeChecked()
  await expect(settingsWindow.locator('.settings-status')).toContainText('Saved')
  await settingsWindow.close()

  await openFileExplorer(mainWindow)
  await expect(
    mainWindow.getByRole('button', { name: /^Agents/ }),
  ).toHaveCount(0)

  const restoredSettingsWindow = await appHarness.openSettingsWindow({
    page: mainWindow,
    sectionId: 'agent-integration',
  })
  const restoredLabel = restoredSettingsWindow.getByLabel(
    'Agent status and sidebar',
  )
  const restoredToggle = restoredLabel.locator('input[type="checkbox"]')
  await expect(restoredToggle).not.toBeChecked()
  await restoredToggle.evaluate((element) => {
    ;(element as HTMLInputElement).click()
  })
  await expect(restoredToggle).toBeChecked()
  await expect(
    restoredSettingsWindow.locator('.settings-status'),
  ).toContainText('Saved')
  await restoredSettingsWindow.close()

  const sessionId = await getActiveSessionId(mainWindow)
  await emitHook(mainWindow, sessionId, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'codex-restored',
    prompt: 'Agent integration restored',
  })
  await expect(
    mainWindow.getByRole('button', { name: /^Agents/ }),
  ).toBeVisible()
  await expect(mainWindow.locator('.agents-sidebar__prompt')).toContainText(
    'Agent integration restored',
  )
})
