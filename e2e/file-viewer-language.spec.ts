import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { fileExplorerItem, openFileExplorer, setProjectRoot } from './support/ui'

const TYPESCRIPT_LANGUAGE_EXTENSION_ID = 'com.terminay.language.typescript'

/** The built-in TypeScript language extension is staged like the other
 * built-ins. When this checkout has not staged it there is no language session
 * to observe, so the suite skips instead of asserting an absent capability. */
function hasBuiltInTypeScriptLanguageServer(): boolean {
  const manifestPath = path.join(process.cwd(), 'extensions', 'builtins.json')
  if (!existsSync(manifestPath)) return false
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      extensions?: readonly { extensionId?: string; directory?: string }[]
    }
    const entry = manifest.extensions?.find(
      (candidate) => candidate.extensionId === TYPESCRIPT_LANGUAGE_EXTENSION_ID,
    )
    if (entry?.directory === undefined) return false
    return existsSync(path.join(process.cwd(), 'extensions', entry.directory))
  } catch {
    return false
  }
}

type EditorMarker = {
  message: string
  owner: string
  resource: string
  severity: number
  startLineNumber: number
}

async function serverMarkers(page: Page): Promise<EditorMarker[]> {
  return page.evaluate(() => {
    const monacoApi = (
      window as Window & {
        monaco?: {
          editor?: {
            getModelMarkers: (filter: Record<string, never>) => readonly {
              message: string
              owner: string
              resource: { toString: () => string }
              severity: number
              startLineNumber: number
            }[]
          }
        }
      }
    ).monaco
    const markers = monacoApi?.editor?.getModelMarkers({}) ?? []
    return markers
      .filter((marker) => marker.owner === 'terminay')
      .map((marker) => ({
        message: marker.message,
        owner: marker.owner,
        resource: marker.resource.toString(),
        severity: marker.severity,
        startLineNumber: marker.startLineNumber,
      }))
  })
}

test.describe('file viewer language intelligence', () => {
  test.skip(
    !hasBuiltInTypeScriptLanguageServer(),
    'The built-in TypeScript language extension is not staged in this checkout.',
  )

  test('Text mode shows server diagnostics and completion for a TypeScript project @language-typescript', async ({
    createWorkspace,
    mainWindow,
  }) => {
    // The first request starts a real TypeScript language server against the
    // fixture project; give the whole journey room beyond the default budget.
    test.setTimeout(180_000)
    const workspace = await createWorkspace({
      name: 'file-viewer-language',
      seed: {
        files: {
          'package.json': `${JSON.stringify({ name: 'language-fixture', private: true, version: '0.0.0' }, null, 2)}\n`,
          'src/index.ts': [
            "import * as util from './util'",
            '',
            "const message: number = util.greet('terminay')",
            '',
            'export { message }',
            '',
          ].join('\n'),
          'src/util.ts': [
            'export function greet(name: string): string {',
            "  return 'hi ' + name",
            '}',
            '',
            'export const version = 1',
            '',
          ].join('\n'),
          'tsconfig.json': `${JSON.stringify(
            {
              compilerOptions: {
                module: 'ESNext',
                moduleResolution: 'Bundler',
                noEmit: true,
                strict: true,
                target: 'ES2022',
              },
              include: ['src'],
            },
            null,
            2,
          )}\n`,
        },
      },
    })

    await setProjectRoot(mainWindow, workspace.rootDir)
    await openFileExplorer(mainWindow)
    await expect(fileExplorerItem(mainWindow, 'src')).toBeVisible()
    await fileExplorerItem(mainWindow, 'src').click()
    await expect(fileExplorerItem(mainWindow, 'index.ts')).toBeVisible()
    await fileExplorerItem(mainWindow, 'index.ts').dblclick()
    await mainWindow.getByRole('tab', { name: 'Text' }).click()
    await expect(mainWindow.locator('.monaco-editor')).toBeVisible()

    // A language session starts on the first request and reads the project's
    // own tsconfig, so allow it a generous first-load budget.
    await expect
      .poll(async () => (await serverMarkers(mainWindow)).length, { timeout: 60_000 })
      .toBeGreaterThan(0)

    const markers = await serverMarkers(mainWindow)
    // The sibling import resolves through the project on disk: no marker on it.
    expect(markers.filter((marker) => marker.startLineNumber === 1)).toEqual([])
    // The real type error is reported as an error marker on its own line.
    const typeError = markers.find((marker) => marker.startLineNumber === 3)
    expect(typeError, JSON.stringify(markers)).toBeDefined()
    expect(typeError?.severity).toBe(8)
    // The editor's model is anonymous (an in-memory URI); the marker must be
    // on that model rather than on some other resource.
    const modelUris = await mainWindow.evaluate(() => {
      const monacoApi = (
        window as Window & {
          monaco?: { editor?: { getModels: () => readonly { uri: { toString: () => string } }[] } }
        }
      ).monaco
      return monacoApi?.editor?.getModels().map((model) => model.uri.toString()) ?? []
    })
    expect(modelUris).toContain(typeError?.resource)

    await mainWindow.locator('.monaco-editor .inputarea').first().click()
    await mainWindow.keyboard.press('Control+End')
    await mainWindow.keyboard.type('\nutil.')
    const suggestions = mainWindow.locator('.suggest-widget .monaco-list-row')
    await expect(suggestions.filter({ hasText: 'greet' }).first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
