import { expect, test } from './fixtures';
import {
	fileExplorerItem,
	openFileExplorer,
	setProjectRoot,
} from './support/ui';

test('File explorer opens MDX through the isolated preview surface', async ({
	createWorkspace,
	mainWindow,
}) => {
	const workspace = await createWorkspace({
		name: 'mdx-browser-runtime',
		seed: {
			files: {
				'guide.mdx': '# MDX guide',
				'node_modules/react/package.json': '{"main":"index.js"}',
				'node_modules/react/index.js':
					'export default { createElement(type, props) { return { type, props } } }',
				'node_modules/react/jsx-runtime.js':
					'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment=Symbol.for("fragment")',
				'node_modules/react-dom/client.js':
					'export function createRoot(){return {render(){}}}',
			},
		},
	});
	await setProjectRoot(mainWindow, workspace.rootDir);
	await openFileExplorer(mainWindow);
	await fileExplorerItem(mainWindow, 'guide.mdx').dblclick();
	await expect(mainWindow.locator('.file-panel')).toBeVisible();
	const previewTab = mainWindow
		.locator('.file-panel')
		.getByRole('tab', { name: 'Preview' });
	if (await previewTab.isVisible()) await previewTab.click();
	await expect(mainWindow.locator('iframe[title="MDX preview"]')).toBeVisible({
		timeout: 30_000,
	});
});
