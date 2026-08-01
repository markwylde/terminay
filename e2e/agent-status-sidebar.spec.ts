import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { sendAppCommand } from './support/app'
import { openFileExplorer } from './support/ui'

async function getActiveSessionId(page: Page): Promise<string> {
  const sessionId = await page
    .locator('.terminal-panel:visible')
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

/**
 * Playwright's Page.close can enter Chromium's native close-confirmation path
 * for an auxiliary Electron window after a settings write. The Settings
 * BrowserWindow has no user-owned document state to preserve, so close the
 * exact test auxiliary window through Electron instead. This keeps the test
 * focused on the integration setting rather than an OS alert modal.
 */
async function destroySettingsWindow(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const settingsWindow = BrowserWindow.getAllWindows().find(
      (window) =>
        !window.isDestroyed() &&
        new URL(window.webContents.getURL()).searchParams.get('view') === 'settings',
    )
    if (!settingsWindow) {
      throw new Error('Settings window is unavailable')
    }
    settingsWindow.destroy()
  })
}

test('canonical server working state projects to the Terminal 2 tab indicator', async ({
  mainWindow,
}) => {
  await sendAppCommand(mainWindow, 'new-terminal')
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
    session_id: 'codex-terminal-two',
    prompt: 'Project this working state into Terminal 2',
    model: 'gpt-test-codex',
  })

  await expect(
    agentTab.locator('.agent-status-indicator[data-agent-state="working"]'),
  ).toBeVisible()
})

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
  await expect(mainWindow.locator('.agents-sidebar__name')).toContainText(
    'Implement the stable agent status flow',
  )
  await expect(mainWindow.locator('.agents-sidebar__metadata')).toContainText(
    'Terminal 2 · Codex · gpt-test-codex',
  )
  await expect(mainWindow.locator('.agents-sidebar__name').first()).toHaveCSS(
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
  await expect(childRow).not.toBeVisible()
  const childDisclosure = mainWindow.getByRole('button', {
    name: 'Expand 1 subagent for Implement the stable agent status flow',
  })
  await expect(childDisclosure).toBeVisible()
  await expect(childDisclosure).toHaveCSS('width', '16px')
  await childDisclosure.click()
  await expect(childRow).toBeVisible()
  await expect(childRow.locator('.agents-sidebar__name')).toHaveCSS(
    'font-size',
    '13px',
  )
  await expect(childRow.locator('.agents-sidebar__metadata')).toHaveCount(0)
  await expect(
    mainWindow.locator('.agents-sidebar__prompt').filter({
      hasText: 'Review the stable lifecycle implementation',
    }),
  ).toBeVisible()
  await expect(childRow.locator('..')).toHaveCSS('min-height', '32px')
  const indentation = await mainWindow
    .locator('.agents-sidebar__row')
    .evaluateAll((rows) =>
      rows.slice(0, 2).map((row) =>
        Number.parseFloat(window.getComputedStyle(row).paddingLeft),
      ),
    )
  expect(indentation[1] - indentation[0]).toBe(12)
  await mainWindow
    .getByRole('button', {
      name: 'Collapse 1 subagent for Implement the stable agent status flow',
    })
    .click()
  await expect(childRow).not.toBeVisible()
  await mainWindow
    .getByRole('button', {
      name: 'Expand 1 subagent for Implement the stable agent status flow',
    })
    .click()
  await expect(childRow).toBeVisible()

  await sendAppCommand(mainWindow, 'new-project')
  await mainWindow
    .locator('.project-tab')
    .filter({ hasText: 'Project 1' })
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
  await expect(
    agentTab.locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " dv-tab ")][1]',
    ),
  ).toHaveClass(/dv-active-tab/)
  await expect(
    mainWindow.locator(
      `.project-workspace--active .terminal-panel[data-terminay-terminal-session-id="${agentTerminalSessionId}"]`,
    ),
  ).toBeVisible()

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

  await agentTab.click()
  const agentTerminalInput = mainWindow
    .locator(`.terminal-panel[data-terminay-terminal-session-id="${agentTerminalSessionId}"]`)
    .getByRole('textbox', { name: 'Terminal input' })
  await agentTerminalInput.pressSequentially("printf 'trailing repaint\\n'")
  await agentTerminalInput.press('Enter')
  await mainWindow.waitForTimeout(400)
  await expect(
    agentTab.locator('.agent-status-indicator[data-agent-state="done"]'),
  ).toBeVisible()
})

test('real Codex SubagentStart transcript metadata supplies the task name', async ({
  mainWindow,
}) => {
  const terminalSessionId = await getActiveSessionId(mainWindow)
  const transcriptDirectory = await mkdtemp(
    join(tmpdir(), 'terminay-codex-e2e-'),
  )
  const transcriptPath = join(
    transcriptDirectory,
    'rollout-2026-07-26T22-23-55-child-math.jsonl',
  )
  try {
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'child-math',
          session_id: 'codex-transcript-root',
          parent_thread_id: 'codex-transcript-root',
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: 'codex-transcript-root',
                depth: 1,
                agent_path: '/root/math_question_one',
              },
            },
          },
          thread_source: 'subagent',
        },
      })}\n`,
    )

    await emitHook(mainWindow, terminalSessionId, {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'codex-transcript-root',
      prompt: 'Spawn one named math agent',
    })
    await emitHook(mainWindow, terminalSessionId, {
      hook_event_name: 'SubagentStart',
      session_id: 'codex-transcript-root',
      turn_id: 'child-turn',
      transcript_path: transcriptPath,
      agent_id: 'child-math',
      agent_type: 'default',
    })

    await openFileExplorer(mainWindow)
    await mainWindow
      .getByRole('button', {
        name: 'Expand 1 subagent for Spawn one named math agent',
      })
      .click()
    await expect(
      mainWindow.getByRole('button', {
        name: 'Focus math_question_one terminal',
      }),
    ).toBeVisible()
    await expect(mainWindow.getByText('Subagent 1', { exact: true })).toHaveCount(
      0,
    )
  } finally {
    await rm(transcriptDirectory, { recursive: true, force: true })
  }
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
  electronApp,
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
  await destroySettingsWindow(electronApp)

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
  await destroySettingsWindow(electronApp)

  const sessionId = await getActiveSessionId(mainWindow)
  await emitHook(mainWindow, sessionId, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'codex-restored',
    prompt: 'Agent integration restored',
  })
  await expect(
    mainWindow.getByRole('button', { name: /^Agents/ }),
  ).toBeVisible()
  await expect(mainWindow.locator('.agents-sidebar__name')).toContainText(
    'Agent integration restored',
  )
})
