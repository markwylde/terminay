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
	// The server performs the move, and only one function asks it to.
	assert.equal(app.split('.movePanel(').length - 1, 1)
	const move = between(app, 'const moveTerminalToProject = useCallback(', 'const moveTerminalToFolder = useCallback(')
	assert.match(move, /\.movePanel\(\{ panelId: canonicalPanel\.id, targetProjectId \}\)/)
	// The move function itself rearranges nothing: a tab changes project only
	// when reconciliation places it where the confirmed projection says.
	assert.equal(move.includes('exportTerminalForMove('), false)
	assert.equal(move.includes('acceptMovedTerminal('), false)
	assert.equal(move.includes('activateProject('), false)
	// A refused move forgets that this device asked for it and says why, in
	// the project the terminal is still in: on the folder that is on screen,
	// since the terminal's own folder may be behind it.
	assert.match(
		move,
		/\.catch\(\(error: unknown\) => \{[\s\S]*?pendingTerminalMovesRef\.current\.delete\(sessionId\);[\s\S]*?\(commandWorkspace\(sourceProjectId\) \?\? sourceWorkspace\)\.reportError\(/,
	)
	assert.equal(app.split('.exportTerminalForMove(').length - 1, 1)
	assert.equal(app.split('.acceptMovedTerminal(').length - 1, 1)
	const reconcile = between(app, 'const runPass = () => {', 'const schedulePass = () => {')
	assert.ok(reconcile.includes('.exportTerminalForMove('))
	assert.ok(reconcile.includes('.acceptMovedTerminal('))
	assert.match(
		between(app, 'const reportTerminalTabDrag = useCallback(\n\t\t(sourceProjectId', '[moveTerminalToFolder, moveTerminalToProject]'),
		/moveTerminalToProject\(\s*ended\.sourceProjectId,\s*ended\.panelId,\s*targetProjectId,\s*\)/,
	)
	assert.match(app, /projectTabAcceptsTerminalDrop\(from, displayedProjects, candidate\)/)
})

test('a drop on a folder moves through the one folder move path', () => {
	// As with a project: the server makes the move, and one function asks.
	assert.equal(app.split('.movePanelToFolder(').length - 1, 1)
	const move = between(app, 'const moveTerminalToFolder = useCallback(', 'The terminal being dragged toward')
	assert.match(move, /\.movePanelToFolder\(\{\s*panelId: canonicalPanel\.id,\s*folderId: targetFolderId,\s*\}\)/)
	// A folder is named by id and nothing else: no path picks its root.
	assert.equal(/worktree|rootFolder|\.path\b/.test(move), false)
	// Nothing is rearranged, selected, or closed until the move is confirmed.
	for (const forbidden of ['exportTerminalForMove(', 'acceptMovedTerminal(', 'selectFolder(', 'activateProject(', 'closePanel('])
		assert.equal(move.includes(forbidden), false, forbidden)
	assert.match(move, /canonicalPanel\.folderId === targetFolderId/)
	assert.match(
		move,
		/\.catch\(\(error: unknown\) => \{[\s\S]*?pendingTerminalMovesRef\.current\.delete\(sessionId\);[\s\S]*?\.reportError\(/,
	)
	// The drop names the folder; the move waits for the drag to end, exactly
	// as a drop on a project tab does.
	const drop = between(app, 'const dropTerminalOnFolder = useCallback(', 'const toggleActiveProjectExplorer')
	assert.match(drop, /terminalTabDragRef\.current\?\.sourceProjectId !== projectId\) return;/)
	assert.match(drop, /terminalDropTargetFolderIdRef\.current = folderId;/)
	assert.equal(drop.includes('moveTerminalToFolder('), false)
	assert.match(
		between(app, 'const reportTerminalTabDrag = useCallback(\n\t\t(sourceProjectId', '[moveTerminalToFolder, moveTerminalToProject]'),
		/moveTerminalToFolder\(\s*ended\.sourceProjectId,\s*ended\.panelId,\s*targetFolderId,\s*\)/,
	)
	// Only the device that asked follows the terminal, to its folder.
	const reconcile = between(app, 'const runPass = () => {', 'const schedulePass = () => {')
	assert.match(reconcile, /if \(requestedHere\) \{\s*selectFolder\(session\.projectId, panel\.folderId\);/)
})

test('a panel that has changed folder is let go, never closed', () => {
	const reconcile = between(app, 'const reconcileServerPanels = useCallback(', 'const filteredMacros')
	const folderBranch = between(reconcile, 'canonical.folderId !== projectedFolderId', 'if (canonical.title')
	// The moving flag is what keeps the removal from closing the terminal.
	assert.match(folderBranch, /movingTerminalSessionIdsRef\.current\.add\(sessionId\);\s*api\.removePanel\(panel\);/)
	// It is kept until the folder it now belongs to can show it.
	assert.match(folderBranch, /if \(canHandOver\?\.\(canonical\) === false\) continue;/)
	// And a removal by any other route closes nothing that is another folder's.
	const close = between(app, 'const closeServerPanel = useCallback(', 'const commitServerPanelOrder')
	assert.match(close, /if \(panel\.folderId !== projectedFolderId\) return;[\s\S]*store\s*\.closePanel\(panelId\)/)
})

test('only a terminal tab dragged in the main window is reported', () => {
	const report = between(controller, 'const onDragStart = () => {', 'const onDragEnd')
	assert.match(report, /targetWindow !== window \|\| !data\.panelId/)
	assert.match(report, /panel\?\.view\.tabComponent === 'terminalTab'/)
})
