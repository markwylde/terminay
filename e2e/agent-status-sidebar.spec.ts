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
  await expect(mainWindow.locator('.agents-sidebar__prompt').first()).toHaveCSS(
    'white-space',
    'nowrap',
  )

  await emitHook(mainWindow, agentTerminalSessionId, {
    hook_event_name: 'PreToolUse',
    session_id: 'codex-e2e-root',
    tool_name: 'Agent',
    tool_use_id: 'spawn-reviewer',
    tool_input: {
      task_name: 'Reviewer',
      message: 'Review the stable lifecycle implementation',
    },
  })
  await emitHook(mainWindow, agentTerminalSessionId, {
    hook_event_name: 'SubagentStart',
    session_id: 'codex-e2e-root',
    agent_id: 'reviewer-child',
    agent_type: 'default',
  })
  const childRow = mainWindow.getByRole('button', {
    name: 'Focus Reviewer terminal',
  })
  await expect(childRow).toBeVisible()
  await expect(childRow.locator('.agents-sidebar__name')).toHaveCSS(
    'font-size',
    '13px',
  )
  await expect(childRow.locator('.agents-sidebar__metadata')).toHaveCSS(
    'font-size',
    '11px',
  )
  await expect(
    mainWindow.locator('.agents-sidebar__prompt').filter({
      hasText: 'Review the stable lifecycle implementation',
    }),
  ).toBeVisible()
  const childDisclosure = mainWindow.getByRole('button', {
    name: 'Collapse 1 subagent for Codex',
  })
  await expect(childDisclosure).toBeVisible()
  await expect(childDisclosure).toHaveCSS('width', '16px')
  const indentation = await mainWindow
    .locator('.agents-sidebar__row')
    .evaluateAll((rows) =>
      rows.slice(0, 2).map((row) =>
        Number.parseFloat(window.getComputedStyle(row).paddingLeft),
      ),
    )
  expect(indentation[1] - indentation[0]).toBe(12)
  await childDisclosure.click()
  await expect(childRow).not.toBeVisible()
  await mainWindow
    .getByRole('button', { name: 'Expand 1 subagent for Codex' })
    .click()
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

test('sidebar panels can be reordered vertically', async ({ mainWindow }) => {
  await openFileExplorer(mainWindow)
  const activeWorkspace = mainWindow.locator('.project-workspace--active')
  const panelTitles = activeWorkspace.locator('.sidebar-pane__title')
  await expect(panelTitles).toHaveText(['Explorer', 'Agents', 'Git'])

  const agentsHandle = mainWindow.getByRole('button', {
    name: 'Reorder Agents panel',
  })
  const gitHeader = mainWindow
    .locator('.sidebar-pane')
    .filter({ has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Git' }) })
    .locator('.sidebar-pane__header-row')
    .first()
  const gitHeaderBox = await gitHeader.boundingBox()
  if (!gitHeaderBox) {
    throw new Error('Git panel header is unavailable')
  }
  const agentsHandleBox = await agentsHandle.boundingBox()
  if (!agentsHandleBox) {
    throw new Error('Agents panel drag handle is unavailable')
  }
  await mainWindow.mouse.move(
    agentsHandleBox.x + agentsHandleBox.width / 2,
    agentsHandleBox.y + agentsHandleBox.height / 2,
  )
  await mainWindow.mouse.down()
  await mainWindow.mouse.move(
    agentsHandleBox.x + agentsHandleBox.width / 2,
    agentsHandleBox.y + agentsHandleBox.height / 2 + 8,
    { steps: 3 },
  )
  await mainWindow.mouse.move(
    gitHeaderBox.x + gitHeaderBox.width / 2,
    gitHeaderBox.y + gitHeaderBox.height - 2,
    { steps: 10 },
  )
  await mainWindow.mouse.up()
  await expect(panelTitles).toHaveText(['Explorer', 'Git', 'Agents'])

  await mainWindow.getByLabel('Toggle file explorer').click()
  await openFileExplorer(mainWindow)
  await expect(panelTitles).toHaveText(['Explorer', 'Git', 'Agents'])

  await mainWindow.waitForTimeout(150)
  await sendAppCommand(mainWindow, 'new-project')
  await openFileExplorer(mainWindow)
  await expect(panelTitles).toHaveText(['Explorer', 'Git', 'Agents'])
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
