import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const tabList = await readFile('src/workspace/ProjectTabList.tsx', 'utf8')
const app = await readFile('src/App.tsx', 'utf8')
const controller = await readFile(
	'src/workspace/useTerminalDockviewWindowController.ts',
	'utf8',
)

const DROP_HANDLERS = ['onDragEnter', 'onDragOver', 'onDragLeave', 'onDrop']

function between(source, start, end) {
	const from = source.indexOf(start)
	assert.notEqual(from, -1, `missing ${start}`)
	const to = source.indexOf(end, from)
	assert.notEqual(to, -1, `missing ${end}`)
	return source.slice(from, to)
}

test('only the visible project tab is a terminal drop target', () => {
	const visibleTab = between(tabList, '<Reorder.Item', '</Reorder.Item>')
	for (const handler of DROP_HANDLERS) {
		// Once in the file, and that once is on the visible tab: the overflowed
		// copy and the drop placeholder carry none.
		assert.equal(tabList.split(`${handler}={`).length - 1, 1, handler)
		assert.ok(visibleTab.includes(`${handler}={`), handler)
	}
})

test('a project tab takes the drop only when it is an offered target', () => {
	const handlers = between(tabList, 'onDragEnter={', 'onClick={')
	for (const handler of ['onDragEnter', 'onDragOver', 'onDrop']) {
		const body = between(handlers, `${handler}={`, '}}')
		assert.match(
			body,
			/if \(!acceptsTerminalDrop\(keyOf\(project\)\)\) return;\s+event\.preventDefault\(\);/,
			handler,
		)
	}
	assert.match(
		tabList,
		/terminalDropTargetIds\?\.includes\(projectId\) === true/,
	)
	assert.match(
		between(handlers, 'onDrop={', '}}'),
		/event\.stopPropagation\(\);[\s\S]*onTerminalDrop\?\.\(keyOf\(project\)\)/,
	)
})

test('hovering a terminal tab over a project tab does not activate it', () => {
	assert.equal(
		between(tabList, 'onDragEnter={', 'onClick={').includes('onActivate('),
		false,
	)
})

test('the drop moves through the one existing move path', () => {
	// A second export or adopt call would be a second move implementation.
	assert.equal(app.split('.exportTerminalForMove(').length - 1, 1)
	assert.equal(app.split('.acceptMovedTerminal(movedTerminal)').length - 1, 1)
	assert.match(
		between(app, 'const reportTerminalTabDrag = useCallback(\n\t\t(sourceProjectId', '[moveTerminalToProject]'),
		/moveTerminalToProject\(\s*ended\.sourceProjectId,\s*ended\.panelId,\s*targetProjectId,\s*\)/,
	)
	assert.match(app, /projectTabAcceptsTerminalDrop\(from, displayedProjects, candidate\)/)
})

test('only a terminal tab dragged in the main window is reported', () => {
	const report = between(controller, 'const onDragStart = () => {', 'const onDragEnd')
	assert.match(report, /targetWindow !== window \|\| !data\.panelId/)
	assert.match(report, /panel\?\.view\.tabComponent === 'terminalTab'/)
})
