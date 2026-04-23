import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from './fixtures'
import { fileExplorerItem, openFileExplorer, setProjectRoot } from './support/ui'

const execFileAsync = promisify(execFile)

test('file viewer supports markdown image pdf hex and diff modes', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-modes',
    seed: {
      files: {
        'README.md': '# Markdown Title\n\nThis is **rendered**.\n',
        'doc.pdf': Buffer.from(
          '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 50 120 Td (Hello PDF) Tj ET\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
          'utf8',
        ),
        'diff-target.tsx': 'export function Example() {\n  return <div className="start">old</div>\n}\n',
        'pixel.png': Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pJsteUAAAAASUVORK5CYII=',
          'base64',
        ),
        'switch.txt': 'switch me\n',
      },
    },
  })

  await execFileAsync('git', ['init'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'E2E'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['add', 'diff-target.tsx'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspace.rootDir })
  await workspace.writeText(
    'diff-target.tsx',
    'export function Example() {\n  const label = "new"\n  return <div className="updated">{label}</div>\n}\n',
  )

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'README.md').dblclick()
  await expect(mainWindow.locator('.file-preview-markdown')).toContainText('Markdown Title')

  await fileExplorerItem(mainWindow, 'pixel.png').dblclick()
  await expect(mainWindow.locator('.file-preview-image__asset')).toBeVisible()

  await fileExplorerItem(mainWindow, 'doc.pdf').dblclick()
  await expect(mainWindow.locator('.file-preview-pdf canvas')).toBeVisible()

  await fileExplorerItem(mainWindow, 'switch.txt').dblclick()
  await mainWindow.getByRole('tab', { name: 'HEX' }).click()
  await expect(mainWindow.locator('.file-hex-viewer')).toBeVisible()
  await mainWindow.getByRole('tab', { name: 'Preview' }).click()
  await expect(mainWindow.locator('.file-preview-text')).toContainText('switch me')

  await fileExplorerItem(mainWindow, 'diff-target.tsx').dblclick()
  await mainWindow.getByRole('tab', { name: 'Diff' }).click()
  await expect(mainWindow.locator('.file-diff-viewer')).toBeVisible()
  await expect(mainWindow.locator('.file-diff-viewer')).toContainText('const label = "new"')
  await expect(mainWindow.locator('.file-diff-viewer .file-token--keyword', { hasText: 'const' })).toHaveCount(1)
  await expect(mainWindow.locator('.file-diff-viewer .file-token--string', { hasText: '"new"' })).toHaveCount(1)
  await expect(mainWindow.locator('.file-diff-viewer .file-token--tag-name', { hasText: 'div' }).first()).toBeVisible()

  await workspace.writeText(
    'diff-target.tsx',
    'export function Example() {\n  const label = "again"\n  return <section className="updated">{label}</section>\n}\n',
  )
  await expect(mainWindow.locator('.file-diff-viewer')).toContainText('const label = "again"')
  await expect(mainWindow.locator('.file-diff-viewer .file-token--tag-name', { hasText: 'section' }).first()).toBeVisible()
})
