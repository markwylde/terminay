import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { projectTabsFromSnapshot } from '../src/workspace/useConnectionProjectTabs.ts'
import {
	agentBadgesForOtherServers,
	crossServerAgentStates,
} from '../src/workspace/crossServerAgentBadges.ts'
import { defaultTerminalSettings } from '../src/terminalSettings.ts'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

function snapshot(serverId, projectIds) {
	return {
		schemaVersion: 1,
		cursor: '0',
		revision: 1,
		serverId,
		viewOrder: ['view-1'],
		views: { 'view-1': { id: 'view-1', projectIds, activeProjectId: projectIds[0] } },
		projects: Object.fromEntries(
			projectIds.map((id) => [
				id,
				{ id, name: `Name ${id}`, root: `/srv/${id}`, sidebar: {} },
			]),
		),
		panels: {},
		terminalSessions: {},
	}
}

test('another server contributes its own tabs, stamped with its server id', () => {
	const tabs = projectTabsFromSnapshot(
		'server-b',
		snapshot('server-b', ['project-1', 'project-2']),
		defaultTerminalSettings.sidebar,
	)
	assert.deepEqual(
		tabs.map((tab) => [tab.serverId, tab.id, tab.title]),
		[
			['server-b', 'project-1', 'Name project-1'],
			['server-b', 'project-2', 'Name project-2'],
		],
	)
	// Order follows that server's own view, not this window's.
	assert.deepEqual(
		projectTabsFromSnapshot('server-b', null, defaultTerminalSettings.sidebar),
		[],
	)
})

test('a server whose view is unknown contributes nothing rather than guessing', () => {
	const tabs = projectTabsFromSnapshot(
		'server-b',
		{ ...snapshot('server-b', ['project-1']), viewOrder: [], views: {} },
		defaultTerminalSettings.sidebar,
	)
	assert.deepEqual(tabs, [])
})

test('badges from other servers are keyed by server and skip the active one', () => {
	const entry = (sessionId, state) => ({
		entryId: `${sessionId}:${state}`,
		kind: 'root',
		activationTerminalSessionId: sessionId,
		sessionId,
		agentId: sessionId,
		state,
		unread: true,
	})
	const snapshots = {
		'server-a': { revision: 1, entries: { a: entry('s1', 'waiting') }, eventCursors: {} },
		'server-b': { revision: 1, entries: { b: entry('s2', 'working') }, eventCursors: {} },
	}
	const projectOf = (serverId, sessionId) =>
		sessionId === 's1' ? 'project-1' : sessionId === 's2' ? 'project-1' : undefined
	const badges = agentBadgesForOtherServers(snapshots, 'server-a', projectOf)
	// The active server's badges come from its live inventory, not from here.
	assert.deepEqual(Object.keys(badges), ['server-b:project-1'])
	assert.deepEqual(badges['server-b:project-1'], { count: 1, state: 'recent' })
	// With no active server every attached one contributes.
	assert.deepEqual(
		Object.keys(agentBadgesForOtherServers(snapshots, undefined, projectOf)).sort(),
		['server-a:project-1', 'server-b:project-1'],
	)
	assert.deepEqual(crossServerAgentStates(snapshots).sort(), ['waiting', 'working'])
})

test('an agent whose terminal is not in its server workspace is not badged', () => {
	const snapshots = {
		'server-b': {
			revision: 1,
			entries: {
				b: {
					entryId: 'b',
					kind: 'root',
					activationTerminalSessionId: 'gone',
					sessionId: 'gone',
					agentId: 'gone',
					state: 'waiting',
					unread: true,
				},
			},
			eventCursors: {},
		},
	}
	assert.deepEqual(
		agentBadgesForOtherServers(snapshots, 'server-a', () => undefined),
		{},
	)
})

test('the workspace binds every surface to the active tab server', async () => {
	const app = await read('src/App.tsx')
	// One substitution: the whole tree below follows the tab in front.
	assert.match(
		app,
		/if \(activeConnection\?\.context === undefined\) return primaryClientContext;[\s\S]*connectionLabel: activeConnection\.label/u,
	)
	// The strip is a composition across attached connections, not one list.
	assert.match(app, /useConnectionProjectTabs\(/u)
	assert.match(app, /composeProjectTabs\(projectTabSources, rememberedTabOrder\)/u)
	// Tabs are addressed by `(serverId, projectId)`.
	assert.match(app, /activeProjectId=\{isHomeSelected \? '' : displayedActiveHandle\}/u)
	// Detaching a server drops back rather than showing an empty workspace.
	assert.match(app, /if \(byServerId\.has\(requestedServerId\)\) return;/u)
	// Reordering writes the client-owned composition.
	assert.match(app, /setTabOrder\(order\)/u)
})

test('the tab strip identifies a tab by its server and project together', async () => {
	const list = await read('src/workspace/ProjectTabList.tsx')
	assert.match(list, /project\.handle \?\? project\.id/u)
	assert.match(list, /data-tab-handle=/u)
	// A tab whose server is unusable is visible and takes no action.
	assert.match(list, /project-tab--inert/u)
	assert.match(list, /aria-disabled=\{isInert\(project\) \|\| undefined\}/u)
	// Overflowed tabs are still rendered, and the hidden set is keyed the same
	// way the visible one is — mixing the two dropped them from the strip.
	assert.match(list, /\.filter\(\(project\) => hidden\.has\(keyOf\(project\)\)\)/u)
	// Every list rule is told that identity rather than assuming project id.
	assert.doesNotMatch(
		list,
		/mergeVisibleProjectReorderByIds\(\s*(?:projects|items),\s*(?:nextVisibleIds),\s*(?:hiddenIds|hiddenNow),?\s*\)/u,
	)
})

test('the switcher menu speaks the same tab identity as the strip', async () => {
	const menu = await read('src/workspace/ProjectSwitcherMenu.tsx')
	// The active row, edit, activate, and close all address a tab by handle;
	// finding the active row by project id made long-press edit the wrong tab.
	assert.match(menu, /keyOf\(project\) === activeProjectId/u)
	assert.match(menu, /void onEdit\(keyOf\(active\)\)/u)
	assert.match(menu, /void onEdit\(keyOf\(project\)\)/u)
	assert.match(menu, /onClose\(keyOf\(project\)\)/u)
	// Drag targeting reads the handle attribute, not the project id one.
	assert.match(menu, /data-project-switcher-handle=/u)
	assert.match(menu, /dataset\.projectSwitcherHandle/u)
	// A caller that still speaks a bare project id is understood as one on the
	// server the window is already working in.
	const app = await read('src/App.tsx')
	assert.match(
		app,
		/parseCompositionTabKey\(handle\) \?\? \{\s*serverId: currentServerId,\s*projectId: handle,/u,
	)
})

test('a connection row is named by its server label alone', async () => {
	const control = await read('src/workspace/ConnectionsControl.tsx')
	// The connection menu is a radio group over attached servers. Its rows are
	// called by the server's own label; status and "this window" sit beside
	// the name rather than inside it.
	assert.match(control, /role="menuitemradio"/u)
	assert.match(control, /aria-checked=\{isCurrent\}/u)
	assert.match(control, /aria-label=\{connection\.label\}/u)
	assert.match(control, /className="remote-access-menu__meta" aria-hidden="true"/u)
})

test('per-server surfaces select a connection instead of merging servers', async () => {
	const workspace = await read('src/web/ConnectedWebRendererWorkspace.tsx')
	assert.match(workspace, /useSelectedServerConnection\(\)/u)
	assert.match(workspace, /<ServerSelector/u)
	// Every per-server client comes from the selected connection.
	assert.match(
		workspace,
		/const applicationClient =\s*selectedServer\.connection\?\.context\?\.applicationClient/u,
	)
})
