import { expect, test } from './fixtures'
import { openFileExplorer, setProjectRoot } from './support/ui'

test('Documentation opens MDX through the isolated preview surface', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'mdx-browser-runtime',
    seed: {
      files: {
        'guide.mdx': '# MDX guide',
        'node_modules/react/package.json': '{"main":"index.js"}',
        'node_modules/react/index.js': 'export default { createElement(type, props) { return { type, props } } }',
        'node_modules/react/jsx-runtime.js': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment=Symbol.for("fragment")',
        'node_modules/react-dom/client.js': 'export function createRoot(){return {render(){}}}',
      },
    },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  const documentationPane = mainWindow.locator('.project-workspace--active .sidebar-pane').filter({
    has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Documentation' }),
  })
  if (await documentationPane.evaluate((element) => element.classList.contains('sidebar-pane--collapsed'))) {
    await documentationPane.locator('.sidebar-pane__header').click()
  }
  await expect(mainWindow.getByRole('tree'), `Documentation pane: ${await documentationPane.innerText()}`).toBeVisible()
  await mainWindow.getByRole('treeitem', { name: /^Guide$/i }).click()
  await expect(mainWindow.locator('iframe[title="MDX preview"]')).toBeVisible()
})
