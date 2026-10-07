import path from 'node:path'
import type { FrameLocator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { fileExplorerItem, openFileExplorer, selectFileView, setMonacoValue, setProjectRoot } from './support/ui'

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pJsteUAAAAASUVORK5CYII=',
  'base64',
)

const page = (heading: string) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Page</title>
<link rel="stylesheet" href="./style.css">
<link rel="stylesheet" href="https://terminay-external.invalid/external.css">
<link rel="stylesheet" href="../outside.css">
</head>
<body>
<h1 id="heading">${heading}</h1>
<img id="logo" src="img/pixel.png" alt="">
<p id="script">script did not run</p>
<p id="parent">pending</p>
<p id="storage">pending</p>
<p id="fetch">pending</p>
<script src="app.js"></script>
</body>
</html>
`

const APP_JS = `document.getElementById('script').textContent = 'script ran';
const say = (id, text) => { document.getElementById(id).textContent = text; };
try { void parent.document.title; say('parent', 'reached'); } catch { say('parent', 'blocked'); }
try { localStorage.setItem('probe', '1'); say('storage', 'reached'); } catch { say('storage', 'blocked'); }
fetch('https://terminay-external.invalid/data').then(() => say('fetch', 'reached'), () => say('fetch', 'blocked'));
`

/** The page inside the preview: the sandbox proxy's frame, then the page's own. */
const preview = (mainWindow: Page): FrameLocator =>
  mainWindow.frameLocator('.file-preview-html__frame:not([hidden])').frameLocator('iframe')

test('an HTML file opens as a sandboxed page that loads only project files', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-html-preview',
    seed: {
      files: {
        'outside.css': 'h1 { text-decoration: underline; }\n',
        'site/index.html': page('Hello page'),
        'site/style.css': 'h1 { color: rgb(1, 2, 3); }\n',
        'site/app.js': APP_JS,
        'site/img/pixel.png': PIXEL,
        'site/leave.html':
          '<!doctype html><p id="bye">bye</p><script>setTimeout(() => { location.href = "https://terminay-leave.invalid/"; }, 300)</script>\n',
      },
    },
  })
  // Chromium reports a load its policy refuses as a request that failed, so
  // what shows nothing left the page is how each one ended.
  const isExternal = (url: string) => url.includes('terminay-external.invalid')
  const externalRequests: string[] = []
  const externalFailures: string[] = []
  const externalResponses: string[] = []
  mainWindow.on('request', (request) => {
    if (isExternal(request.url())) externalRequests.push(request.url())
  })
  mainWindow.on('requestfailed', (request) => {
    if (isExternal(request.url())) externalFailures.push(request.failure()?.errorText ?? '')
  })
  mainWindow.on('response', (response) => {
    if (isExternal(response.url())) externalResponses.push(response.url())
  })

  // The project is the `site` folder, so `outside.css` lies outside it.
  await setProjectRoot(mainWindow, path.join(workspace.rootDir, 'site'))
  await openFileExplorer(mainWindow)
  await fileExplorerItem(mainWindow, 'index.html').dblclick()

  // Preview is the view the file opens in, with Text beside it.
  const switcher = mainWindow.locator('.file-mode-switcher:visible')
  await expect(switcher.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(switcher.getByRole('tab', { name: 'Text', exact: true })).toBeVisible()

  // The page is rendered, with the project's stylesheet, image, and script.
  const frame = preview(mainWindow)
  await expect(frame.locator('#heading')).toHaveText('Hello page')
  await expect(frame.locator('#heading')).toHaveCSS('color', 'rgb(1, 2, 3)')
  await expect.poll(() => frame.locator('#logo').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
  await expect(frame.locator('#script')).toHaveText('script ran')

  // Its script has no way out: not to the workspace, storage, or the network.
  await expect(frame.locator('#parent')).toHaveText('blocked')
  await expect(frame.locator('#storage')).toHaveText('blocked')
  await expect(frame.locator('#fetch')).toHaveText('blocked')
  expect(await frame.locator('body').evaluate(() => self.origin)).toBe('null')

  // Neither the stylesheet outside the project nor the external one applied.
  await expect(frame.locator('#heading')).not.toHaveCSS('text-decoration-line', 'underline')
  await expect(mainWindow.locator('.file-preview-html__notice')).toHaveText('Some resources were not loaded.')
  await expect.poll(() => externalFailures.length).toBe(externalRequests.length)
  for (const failure of externalFailures) expect(failure).toBe('csp')
  expect(externalResponses).toEqual([])

  // An edit made in Text shows in Preview without a save.
  await selectFileView(mainWindow, 'Text')
  await expect(mainWindow.locator('.monaco-editor')).toBeVisible()
  await setMonacoValue(mainWindow, page('Edited page'))
  await selectFileView(mainWindow, 'Preview')
  await expect(preview(mainWindow).locator('#heading')).toHaveText('Edited page')
  await expect(preview(mainWindow).locator('#heading')).toHaveCSS('color', 'rgb(1, 2, 3)')
  expect(await workspace.readText('site/index.html')).toContain('Hello page')

  // A page that navigates itself loses its frame, and the panel says why.
  await fileExplorerItem(mainWindow, 'leave.html').dblclick()
  await expect(mainWindow.locator('.file-preview-html__notice:visible')).toContainText('The page navigated away.', {
    timeout: 15_000,
  })
  await expect(
    mainWindow.locator('.file-preview-html__notice:visible').getByRole('button', { name: 'Reload' }),
  ).toBeVisible()
  expect(mainWindow.frames().filter((candidate) => candidate.url().includes('terminay-leave.invalid'))).toEqual([])
})
