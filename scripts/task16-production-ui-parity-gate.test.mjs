import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
	TASK19_FEATURE_MATRIX,
	TASK19_SURFACES,
} from './task19-compatibility-matrix.mjs'

const TASK16 = 'specs/tasks/16-shared-responsive-server-ui.md'
const TASK19 = 'specs/tasks/19-migration-and-compatibility-cleanup.md'

const REQUIRED_OPEN_TASK16_ITEMS = Object.freeze([
	'Make the production Electron and web hosts render the same extracted',
	'Render projects, logical workspace views, Dockview panels, sidebars,',
	'Render the complete shared route components in the actual Electron and',
	'Add visual/E2E proof that compares the actual production Electron and',
])

const REQUIRED_OPEN_TASK19_ITEMS = Object.freeze([
	'Complete the project-code and reproducible rendered feature matrix',
	'Remove broad application preload IPC, renderer workspace authority',
])

function checklistItemIsOpen(source, prefix) {
	return source
		.split(/\r?\n/u)
		.some((line) => line.startsWith('- [ ] ') && line.includes(prefix))
}

test('parity stays open until the shared production tree has positive visual proof', async () => {
	const [task16, task19, desktopRuntime, sharedWorkspace, webComposition, webEntry] = await Promise.all([
		readFile(TASK16, 'utf8'),
		readFile(TASK19, 'utf8'),
		readFile('src/rendererRuntime.tsx', 'utf8'),
		readFile('src/shared/ConnectedRendererWorkspace.tsx', 'utf8'),
		readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
		readFile('src/web/main.tsx', 'utf8'),
	])

	const desktopUsesSharedWorkspace =
		desktopRuntime.includes('<ConnectedRendererWorkspace') &&
		desktopRuntime.includes('terminalClientContext={terminalClientContext}')
	const sharedWorkspaceUsesRealApp =
		sharedWorkspace.includes("import App from '../App'") &&
		sharedWorkspace.includes('<App')
	const webUsesSharedWorkspace =
		webEntry.includes("import { ConnectedWebRendererWorkspace }") &&
		webEntry.includes('<ConnectedWebRendererWorkspace') &&
		!webEntry.includes('ServerWorkspaceSurface') &&
		webComposition.includes("import { ConnectedRendererWorkspace }") &&
		webComposition.includes('<ConnectedRendererWorkspace')

	assert.equal(
		desktopUsesSharedWorkspace && sharedWorkspaceUsesRealApp && webUsesSharedWorkspace,
		true,
		'Electron and authenticated web must both mount the exact ConnectedRendererWorkspace -> App production tree',
	)

	for (const item of REQUIRED_OPEN_TASK16_ITEMS) {
		assert.equal(
			checklistItemIsOpen(task16, item),
			true,
			`Task 16 parity item was prematurely checked: ${item}`,
		)
	}
	for (const item of REQUIRED_OPEN_TASK19_ITEMS) {
		assert.equal(
			checklistItemIsOpen(task19, item),
			true,
			`Task 19 parity/cleanup item was prematurely checked: ${item}`,
		)
	}

	for (const feature of TASK19_FEATURE_MATRIX) {
		for (const surface of ['wide-web', 'mobile-web']) {
			assert.equal(
				feature.status[surface],
				'partial',
				`${feature.id}/${surface} cannot be promoted before production component-tree parity`,
			)
		}
	}
	assert.deepEqual(TASK19_SURFACES, [
		'local-desktop',
		'remote-desktop',
		'wide-web',
		'mobile-web',
	])
})
