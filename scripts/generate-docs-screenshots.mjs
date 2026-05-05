import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'

const rootDir = process.cwd()
const outputDir = path.join(rootDir, 'docs', 'public', 'screenshots')
const screenshotPaths = {
  commandBar: path.join(outputDir, 'termide-command-bar.png'),
  files: path.join(outputDir, 'termide-files.png'),
  folders: path.join(outputDir, 'termide-folders.png'),
  hero: path.join(outputDir, 'termide-hero-workspace.png'),
  macros: path.join(outputDir, 'termide-macros.png'),
  remoteAccess: path.join(outputDir, 'termide-remote-access.png'),
  settings: path.join(outputDir, 'termide-settings.png'),
  shortcuts: path.join(outputDir, 'termide-shortcuts.png'),
  workspace: path.join(outputDir, 'termide-workspace.png'),
}
const windowSize = { width: 1000, height: 600 }
const screenshotDeviceScaleFactor = 2

async function waitForVisible(locator, timeout = 10_000) {
  await locator.waitFor({ state: 'visible', timeout })
}

async function openChildWindow(electronApp, action) {
  const nextWindowPromise = electronApp.waitForEvent('window')
  await action()
  const nextWindow = await nextWindowPromise
  await nextWindow.waitForLoadState('domcontentloaded')
  await enablePageDarkMode(nextWindow)
  await nextWindow.setViewportSize(windowSize)
  return nextWindow
}

async function enableAppDarkMode(electronApp) {
  await electronApp.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'dark'
  })
}

async function enablePageDarkMode(page) {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addStyleTag({
    content: ':root { color-scheme: dark; }',
  })
}

async function setScreenshotDeviceScaleFactor(page, size = windowSize) {
  const cdpSession = await page.context().newCDPSession(page)
  await cdpSession.send('Emulation.setDeviceMetricsOverride', {
    width: size.width,
    height: size.height,
    deviceScaleFactor: screenshotDeviceScaleFactor,
    mobile: false,
  })
}

async function setBrowserWindowSize(electronApp, page, size = windowSize) {
  await electronApp.evaluate(({ BrowserWindow }, options) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getTitle() === options.title)
    if (!window) {
      return
    }

    window.setSize(options.size.width, options.size.height)
    window.center()
  }, { size, title: await page.title() })
  await page.setViewportSize(size)
  await setScreenshotDeviceScaleFactor(page, size)
}

async function installScreenshotWindowControls(page, placement = 'tabbar') {
  await page.addStyleTag({
    content: `
      .docs-screenshot-window-controls {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 100%;
        padding: 0 18px 0 26px;
        flex: 0 0 auto;
        -webkit-app-region: drag;
      }

      .docs-screenshot-window-controls--floating {
        position: fixed;
        top: 18px;
        left: 18px;
        z-index: 10000;
        height: auto;
        padding: 0;
      }

      .docs-screenshot-window-control {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: block;
        box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.25);
      }

      .docs-screenshot-window-control--close {
        background: #ff5f57;
      }

      .docs-screenshot-window-control--minimize {
        background: #ffbd2e;
      }

      .docs-screenshot-window-control--zoom {
        background: #28c840;
      }

      .app-shell--macos .project-tabbar {
        padding-left: 0 !important;
      }
    `,
  })

  await page.evaluate((nextPlacement) => {
    document.querySelector('.docs-screenshot-window-controls')?.remove()

    const controls = document.createElement('div')
    controls.className =
      nextPlacement === 'floating'
        ? 'docs-screenshot-window-controls docs-screenshot-window-controls--floating'
        : 'docs-screenshot-window-controls'
    controls.setAttribute('aria-hidden', 'true')

    for (const name of ['close', 'minimize', 'zoom']) {
      const control = document.createElement('span')
      control.className = `docs-screenshot-window-control docs-screenshot-window-control--${name}`
      controls.append(control)
    }

    const tabbar = document.querySelector('.project-tabbar')
    if (nextPlacement === 'tabbar' && tabbar) {
      tabbar.prepend(controls)
      return
    }

    document.body.append(controls)
  }, placement)
}

async function submitEditWindowResult(editWindow, result) {
  const closePromise = editWindow.waitForEvent('close')
  try {
    await editWindow.evaluate(async (nextResult) => {
      await window.termide.submitEditWindowResult(nextResult)
    }, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Target page, context or browser has been closed')) {
      throw error
    }
  }
  await closePromise
}

async function editActiveProject(electronApp, page, { title, icon, hue, rootFolder }) {
  const editWindow = await openChildWindow(electronApp, async () => {
    await page.locator('.project-tab--active').dblclick()
  })

  await waitForVisible(editWindow.getByRole('heading', { name: 'Edit Project Tab' }))
  const color = await editWindow.evaluate((nextHue) => {
    const normalizedHue = nextHue / 360
    const saturation = 0.65
    const lightness = 0.6
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
    const p = 2 * lightness - q
    const toHex = (value) => Math.round(value * 255).toString(16).padStart(2, '0')
    return `#${toHex(hue2rgb(p, q, normalizedHue + 1 / 3))}${toHex(hue2rgb(p, q, normalizedHue))}${toHex(hue2rgb(p, q, normalizedHue - 1 / 3))}`
  }, hue)
  await submitEditWindowResult(editWindow, {
    kind: 'project',
    result: { color, emoji: icon, rootFolder, title },
  })
}

async function sendAppCommand(page, command) {
  await page.evaluate(async (nextCommand) => {
    if (!window.termideTest) {
      throw new Error('termideTest bridge is unavailable')
    }

    await window.termideTest.sendAppCommand(nextCommand)
  }, command)
}

async function closePanelsByTitle(page, titles) {
  for (const title of titles) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const tab = page.locator('.dv-tab:visible').filter({ hasText: title }).first()
      if (!(await tab.count())) {
        break
      }

      await tab.click({ force: true, timeout: 2_000 })
      await sendAppCommand(page, 'close-active')
      await page.waitForTimeout(180)
    }
  }
}

async function seedWorkspace(tempDir) {
  const workspaceDir = path.join(tempDir, 'termide-docs-shot')
  await mkdir(path.join(workspaceDir, 'docs'), { recursive: true })
  await mkdir(path.join(workspaceDir, 'src'), { recursive: true })
  await writeFile(
    path.join(workspaceDir, 'README.md'),
    '# Termide\n\nA desktop terminal workspace for projects.\n\n- Command bar\n- Colorful tabs\n- Remote access\n',
  )
  await writeFile(path.join(workspaceDir, 'docs', 'index.astro'), '<Layout title="Termide" />\n')
  await writeFile(path.join(workspaceDir, 'src', 'App.tsx'), 'export function App() { return <main>Termide</main> }\n')
  await writeFile(path.join(workspaceDir, 'src', 'remote.ts'), 'export const remoteAccess = true\n')
  await writeFile(path.join(workspaceDir, 'package.json'), '{ "scripts": { "docs:screenshots": "playwright" } }\n')
  return workspaceDir
}

async function seedCommandBar(page) {
  await page.evaluate(async () => {
    const macros = await window.termide.getMacros()
    const docsMacros = [
      {
        id: 'docs-screenshot-open-readme',
        title: 'Open README.md',
        description: 'Open the project README beside the active terminal grid.',
        template: 'cat README.md',
        submitMode: 'type-only',
        steps: [{ id: 'type-open-readme', type: 'type', content: 'cat README.md' }],
        fields: [],
      },
      {
        id: 'docs-screenshot-opencode',
        title: 'Launch opencode',
        description: 'Start an AI coding session from the current project.',
        template: 'opencode',
        submitMode: 'type-only',
        steps: [{ id: 'type-opencode', type: 'type', content: 'opencode' }],
        fields: [],
      },
    ]

    await window.termide.updateMacros([
      ...macros.filter((macro) => !docsMacros.some((docsMacro) => docsMacro.id === macro.id)),
      ...docsMacros,
    ])
  })
}

async function openFileExplorer(page) {
  const sidebar = page.locator('.file-explorer-sidebar')
  if (!(await sidebar.count())) {
    await page.getByLabel('Toggle file explorer').click()
  }
  await waitForVisible(sidebar)
}

function escapeShellSingleQuoted(value) {
  return value.replace(/'/g, "'\\''")
}

function terminalDemoCommand(body) {
  const screen = `\\033[2J\\033[3J\\033[H${body.trimEnd()}\\n`.replace(/\n/g, '\\n')
  return `export PS1='termide $ '; printf '%b' '${escapeShellSingleQuoted(screen)}'\r`
}

async function writeToTerminalPanels(page, workspaceDir) {
  const commands = [
    terminalDemoCommand(`
\\033[36mTermide workspace\\033[0m

$ cat README.md
# Termide

A focused terminal workspace for project work.

- Command bar
- Colorful tabs
- Remote access

$ git status --short
 M docs/src/pages/docs/workspace.astro
 M src/App.tsx
`),
    terminalDemoCommand(`
\\033[32mplain bash\\033[0m

$ pwd
~/Projects/termide

$ echo ready
ready

$ npm run docs:build
[ok] screenshots captured
[ok] docs built
`),
    terminalDemoCommand(`
$ ls -la
total 16
drwxr-xr-x  docs
drwxr-xr-x  src
-rw-r--r--  README.md
-rw-r--r--  package.json

$ code docs/src/pages/docs/workspace.astro
`),
    terminalDemoCommand(`
\\033[35mopencode\\033[0m

workspace: termide
status: ready for a coding session
next: review docs screenshot polish

$ npm run smoke
[ok] lint
[ok] build
`),
  ]

  const sessions = await page.locator('.terminal-panel').evaluateAll((panels) =>
    panels
      .map((panel) => panel.getAttribute('data-termide-terminal-session-id'))
      .filter(Boolean),
  )

  for (const [index, sessionId] of sessions.entries()) {
    await page.evaluate(
      ({ command, targetSessionId }) => {
        window.termide.writeTerminal(targetSessionId, command)
      },
      { command: commands[index] ?? 'printf "Termide\\n"\\r', targetSessionId: sessionId },
    )
  }

  await page.waitForTimeout(900)
}

async function createProjectTabs(electronApp, page, workspaceDir) {
  const projects = [
    { title: 'Termide', icon: 'T', hue: 205 },
    { title: 'Docs', icon: 'D', hue: 145 },
    { title: 'Shells', icon: 'S', hue: 295 },
    { title: 'API', icon: 'A', hue: 30 },
    { title: 'Release', icon: 'V', hue: 52 },
  ]

  for (const [index, project] of projects.entries()) {
    if (index > 0) {
      await sendAppCommand(page, 'new-project')
      await waitForVisible(page.locator('.project-tab--active'))
    }

    await editActiveProject(electronApp, page, { ...project, rootFolder: workspaceDir })
  }

  await page.locator('.project-tab').filter({ hasText: 'Termide' }).click()
  await waitForVisible(page.locator('.project-tab--active').filter({ hasText: 'Termide' }))
}

async function createHeroTerminalGrid(page, workspaceDir) {
  await sendAppCommand(page, 'split-vertical')
  await waitForVisible(page.locator('.terminal-tab-content').nth(1))

  await page.mouse.click(820, 180)
  await sendAppCommand(page, 'split-horizontal')
  await waitForVisible(page.locator('.terminal-tab-content').nth(2))

  await page.mouse.click(420, 180)
  await sendAppCommand(page, 'split-horizontal')
  await waitForVisible(page.locator('.terminal-tab-content').nth(3))

  await writeToTerminalPanels(page, workspaceDir)
}

async function capture(page, name) {
  const viewportSize = page.viewportSize() ?? windowSize
  const scaledSize = {
    width: viewportSize.width * screenshotDeviceScaleFactor,
    height: viewportSize.height * screenshotDeviceScaleFactor,
  }

  await page.setViewportSize(scaledSize)
  await page.screenshot({
    path: screenshotPaths[name],
    animations: 'disabled',
    scale: 'css',
    style: `
      html,
      body {
        width: ${viewportSize.width}px !important;
        height: ${viewportSize.height}px !important;
        overflow: hidden !important;
      }

      body {
        zoom: ${screenshotDeviceScaleFactor};
      }
    `,
  })
  await page.setViewportSize(viewportSize)
  await setScreenshotDeviceScaleFactor(page, viewportSize)
  console.log(`Saved ${path.relative(rootDir, screenshotPaths[name])}`)
}

async function captureCommandBar(page) {
  await seedCommandBar(page)
  await sendAppCommand(page, 'open-command-bar')
  await waitForVisible(page.getByRole('dialog', { name: 'Command bar' }))
  await page.getByPlaceholder('Search commands...').fill('open')
  await waitForVisible(page.locator('.macro-launcher-list'))
  await page.addStyleTag({
    content: `
      .macro-launcher-overlay {
        background: rgba(5, 8, 12, 0.30) !important;
        backdrop-filter: none !important;
      }
    `,
  })
  await capture(page, 'commandBar')
  await page.keyboard.press('Escape')
}

async function captureFiles(page) {
  await openFileExplorer(page)
  await page.locator('.file-explorer-tree-item').filter({ hasText: 'README.md' }).first().dblclick()
  await waitForVisible(page.locator('.file-panel'))
  await closePanelsByTitle(page, ['Terminal 1', 'Terminal 2', 'Terminal 3', 'Terminal 4'])
  await page.locator('.dv-tab').filter({ hasText: 'README.md' }).first().click()
  await capture(page, 'files')
}

async function captureFolders(page) {
  await openFileExplorer(page)
  await page.locator('.file-explorer-tree-item').filter({ hasText: 'docs' }).first().dblclick()
  await waitForVisible(page.locator('.folder-viewer'))
  await closePanelsByTitle(page, ['Terminal 1', 'Terminal 2', 'Terminal 3', 'Terminal 4', 'README.md'])
  await page.locator('.dv-tab').filter({ hasText: 'docs' }).first().click()
  await page.getByRole('button', { name: 'Gallery' }).click()
  await waitForVisible(page.locator('.folder-viewer__grid--gallery'))
  await capture(page, 'folders')
}

async function captureSettings(electronApp, page) {
  const settingsWindow = await openChildWindow(electronApp, async () => {
    await page.evaluate(async () => {
      await window.termide.openSettingsWindow({ sectionId: 'typography' })
    })
  })
  await setBrowserWindowSize(electronApp, settingsWindow)
  await installScreenshotWindowControls(settingsWindow, 'floating')
  await waitForVisible(settingsWindow.getByRole('heading', { name: 'Settings' }))
  await settingsWindow.getByPlaceholder('Search settings...').fill('font')
  await capture(settingsWindow, 'settings')
  await settingsWindow.close()
}

async function captureShortcuts(electronApp, page) {
  const settingsWindow = await openChildWindow(electronApp, async () => {
    await page.evaluate(async () => {
      await window.termide.openSettingsWindow({ sectionId: 'keyboard-shortcuts' })
    })
  })
  await setBrowserWindowSize(electronApp, settingsWindow)
  await installScreenshotWindowControls(settingsWindow, 'floating')
  await waitForVisible(settingsWindow.getByRole('heading', { name: 'Settings' }))
  await settingsWindow.getByPlaceholder('Search settings...').fill('command')
  await capture(settingsWindow, 'shortcuts')
  await settingsWindow.close()
}

async function captureMacros(electronApp, page) {
  await seedCommandBar(page)
  const macrosWindow = await openChildWindow(electronApp, async () => {
    await page.evaluate(async () => {
      await window.termide.openMacrosWindow()
    })
  })
  await setBrowserWindowSize(electronApp, macrosWindow)
  await installScreenshotWindowControls(macrosWindow, 'floating')
  await waitForVisible(macrosWindow.getByRole('heading', { name: 'Macros' }))
  await macrosWindow.getByText('Launch opencode').click()
  await waitForVisible(macrosWindow.locator('.settings-hero-title-input'))
  await capture(macrosWindow, 'macros')
  await macrosWindow.close()
}

async function captureRemoteAccess(electronApp, page) {
  const settingsWindow = await openChildWindow(electronApp, async () => {
    await page.evaluate(async () => {
      await window.termide.openSettingsWindow({ sectionId: 'remote-access-host' })
    })
  })
  await setBrowserWindowSize(electronApp, settingsWindow)
  await installScreenshotWindowControls(settingsWindow, 'floating')
  await waitForVisible(settingsWindow.getByRole('heading', { name: 'Pair Device & Live Access' }))
  await settingsWindow.getByRole('button', { name: 'Pair Device' }).click()
  await waitForVisible(settingsWindow.getByAltText('Remote pairing QR code'))
  await capture(settingsWindow, 'remoteAccess')
  await settingsWindow.getByRole('button', { name: 'Stop Remote Access' }).click().catch(() => undefined)
  await settingsWindow.close()
}

async function main() {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'termide-docs-user-data-'))
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'termide-docs-shot-'))
  const workspaceDir = await seedWorkspace(tempDir)
  let electronApp

  try {
    await mkdir(outputDir, { recursive: true })

    electronApp = await electron.launch({
      args: ['--force-device-scale-factor=2', '--high-dpi-support=1', '.'],
      env: {
        ...process.env,
        CI: '1',
        TEMP: tempDir,
        TERMIDE_E2E_TEMP_DIR: tempDir,
        TERMIDE_TEST: '1',
        TERMIDE_USER_DATA_DIR: userDataDir,
        TMP: tempDir,
        TMPDIR: tempDir,
      },
    })

    await enableAppDarkMode(electronApp)
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await enablePageDarkMode(page)
    await waitForVisible(page.locator('.project-tabbar'))
    await setBrowserWindowSize(electronApp, page)

    await page.evaluate(async () => {
      const settings = await window.termide.getTerminalSettings()
      await window.termide.updateTerminalSettings({
        ...settings,
        fontSize: 11,
        lineHeight: 1.12,
      })
    })
    await page.addStyleTag({
      content: '.remote-access-button { display: none !important; }',
    })
    await installScreenshotWindowControls(page)

    await createProjectTabs(electronApp, page, workspaceDir)
    await openFileExplorer(page)
    await createHeroTerminalGrid(page, workspaceDir)
    await capture(page, 'workspace')
    await capture(page, 'hero')
    await captureCommandBar(page)
    await captureFiles(page)
    await captureFolders(page)
    await captureMacros(electronApp, page)
    await captureSettings(electronApp, page)
    await captureShortcuts(electronApp, page)
    await captureRemoteAccess(electronApp, page)
  } finally {
    if (electronApp) {
      await electronApp.close().catch(() => {
        if (electronApp.process().exitCode === null) {
          electronApp.process().kill('SIGKILL')
        }
      })
    }
    await rm(userDataDir, { recursive: true, force: true })
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
