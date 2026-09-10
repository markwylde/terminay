import assert from 'node:assert/strict'
import test from 'node:test'
import {
	PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH,
	PROJECT_TAB_OVERFLOW_FADE_WIDTH,
	fitProjectTabOverflow,
	insertVisibleIdByClientX,
	isProjectTabBarCompact,
	mergeVisibleProjectReorder,
	mergeVisibleProjectReorderByIds,
	moveItemByDrop,
	projectTabStripAvailableWidth,
} from '../src/workspace/projectTabOverflow.ts'

test('compact bars hide every tab and report compact layout', () => {
	const result = fitProjectTabOverflow({
		activeId: 'a',
		availableWidth: 800,
		compact: true,
		items: [
			{ id: 'a', width: 120 },
			{ id: 'b', width: 120 },
		],
	})
	assert.deepEqual(result, {
		hiddenIds: ['a', 'b'],
		layout: 'compact',
		visibleIds: [],
	})
})

test('tabs that fit stay visible and do not overflow', () => {
	const result = fitProjectTabOverflow({
		activeId: 'a',
		availableWidth: 400,
		compact: false,
		items: [
			{ id: 'a', width: 120 },
			{ id: 'b', width: 120 },
			{ id: 'c', width: 120 },
		],
	})
	assert.deepEqual(result, {
		hiddenIds: [],
		layout: 'tabs',
		visibleIds: ['a', 'b', 'c'],
	})
})

test('overflow hides from the end and keeps the active tab', () => {
	const result = fitProjectTabOverflow({
		activeId: 'a',
		availableWidth: 250,
		compact: false,
		items: [
			{ id: 'a', width: 120 },
			{ id: 'b', width: 120 },
			{ id: 'c', width: 120 },
			{ id: 'd', width: 120 },
		],
	})
	assert.deepEqual(result.visibleIds, ['a', 'b'])
	assert.deepEqual(result.hiddenIds, ['c', 'd'])
	assert.equal(result.layout, 'tabs')
})

test('an active tab at the end stays visible while earlier tabs overflow', () => {
	const result = fitProjectTabOverflow({
		activeId: 'd',
		availableWidth: 250,
		compact: false,
		items: [
			{ id: 'a', width: 120 },
			{ id: 'b', width: 120 },
			{ id: 'c', width: 120 },
			{ id: 'd', width: 120 },
		],
	})
	assert.ok(result.visibleIds.includes('d'))
	assert.equal(result.visibleIds.length, 2)
	assert.equal(result.hiddenIds.length, 2)
	assert.equal(result.hiddenIds.includes('d'), false)
})

test('overflow peeks the next tab under the switcher instead of leaving a hole', () => {
	const result = fitProjectTabOverflow({
		activeId: 'a',
		availableWidth: 1110,
		compact: false,
		items: [
			{ id: 'a', width: 160 },
			{ id: 'b', width: 160 },
			{ id: 'c', width: 160 },
			{ id: 'd', width: 160 },
			{ id: 'e', width: 160 },
			{ id: 'f', width: 160 },
			{ id: 'g', width: 160 },
			{ id: 'h', width: 160 },
		],
		overlapWidth: 96,
	})
	assert.deepEqual(result.visibleIds, ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
	assert.deepEqual(result.hiddenIds, ['h'])
})

test('at least one tab remains when the strip is narrower than a single tab', () => {
	const result = fitProjectTabOverflow({
		activeId: 'b',
		availableWidth: 40,
		compact: false,
		items: [
			{ id: 'a', width: 120 },
			{ id: 'b', width: 120 },
		],
	})
	assert.deepEqual(result.visibleIds, ['b'])
	assert.deepEqual(result.hiddenIds, ['a'])
})

test('strip available width subtracts trailing chrome instead of stretching the tab list', () => {
	assert.equal(projectTabStripAvailableWidth(800, 220), 580)
	assert.equal(projectTabStripAvailableWidth(200, 220), 0)
	assert.equal(projectTabStripAvailableWidth(0, 100), 0)
})

test('compact detection matches the 640px chrome breakpoint', () => {
	assert.equal(PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH, 640)
	assert.equal(PROJECT_TAB_OVERFLOW_FADE_WIDTH, 96)
	assert.equal(isProjectTabBarCompact(0), false)
	assert.equal(isProjectTabBarCompact(640), true)
	assert.equal(isProjectTabBarCompact(641), false)
})

test('visible strip reorder keeps overflowed tabs in their original slots', () => {
	const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
	assert.deepEqual(
		mergeVisibleProjectReorder(
			items,
			[{ id: 'c' }, { id: 'a' }, { id: 'b' }],
			['d'],
		).map((item) => item.id),
		['c', 'a', 'b', 'd'],
	)
	assert.deepEqual(
		mergeVisibleProjectReorder(
			items,
			[{ id: 'd' }, { id: 'c' }],
			['a', 'b'],
		).map((item) => item.id),
		['a', 'b', 'd', 'c'],
	)
})

test('pointer drop places a visible tab by other tab centers', () => {
	const visible = ['a', 'b', 'c', 'd']
	const centers = [
		{ id: 'a', center: 50 },
		{ id: 'b', center: 150 },
		{ id: 'c', center: 250 },
		{ id: 'd', center: 350 },
	]
	assert.deepEqual(insertVisibleIdByClientX(visible, centers, 'd', 40), [
		'd',
		'a',
		'b',
		'c',
	])
	assert.deepEqual(insertVisibleIdByClientX(visible, centers, 'd', 140), [
		'a',
		'd',
		'b',
		'c',
	])
	assert.deepEqual(insertVisibleIdByClientX(visible, centers, 'a', 400), [
		'b',
		'c',
		'd',
		'a',
	])
	assert.deepEqual(
		mergeVisibleProjectReorderByIds(
			[{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
			insertVisibleIdByClientX(['a', 'b', 'c', 'd'], centers, 'd', 140),
			['e'],
		).map((item) => item.id),
		['a', 'd', 'b', 'c', 'e'],
	)
})

test('menu drop reorders before and after the hovered row', () => {
	const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
	assert.deepEqual(
		moveItemByDrop(items, 'c', 'a', 'before').map((item) => item.id),
		['c', 'a', 'b'],
	)
	assert.deepEqual(
		moveItemByDrop(items, 'a', 'c', 'after').map((item) => item.id),
		['b', 'c', 'a'],
	)
	assert.deepEqual(
		moveItemByDrop(items, 'a', 'a', 'after').map((item) => item.id),
		['a', 'b', 'c'],
	)
})

/**
 * A strip holding tabs from several servers identifies a tab by
 * `(serverId, projectId)`, because project ids are per-server namespaces.
 * Every list rule here has to be told that identity, or it silently matches
 * nothing: hidden tabs stop being recognised and a reorder drops every tab.
 */
const handled = [
	{ id: 'one', serverId: 'a', handle: 'a:one' },
	{ id: 'one', serverId: 'b', handle: 'b:one' },
	{ id: 'two', serverId: 'a', handle: 'a:two' },
]
const byHandle = (item) => item.handle

test('a reorder by handle keeps every tab, including colliding project ids', () => {
	assert.deepEqual(
		mergeVisibleProjectReorderByIds(
			handled,
			['b:one', 'a:one', 'a:two'],
			[],
			byHandle,
		).map(byHandle),
		['b:one', 'a:one', 'a:two'],
	)
	// Without the accessor nothing matches, and the old order comes back
	// rather than a truncated list.
	assert.deepEqual(
		mergeVisibleProjectReorderByIds(handled, ['b:one', 'a:one', 'a:two'], [])
			.map(byHandle),
		['a:one', 'b:one', 'a:two'],
	)
})

test('hidden tabs are recognised by handle, not by project id', () => {
	assert.deepEqual(
		mergeVisibleProjectReorder(
			handled,
			[handled[2], handled[0]],
			['b:one'],
			byHandle,
		).map(byHandle),
		// The hidden tab stays put; the two visible ones swap around it.
		['a:two', 'b:one', 'a:one'],
	)
})

test('a switcher drop moves the dragged tab by handle', () => {
	assert.deepEqual(
		moveItemByDrop(handled, 'a:two', 'a:one', 'before', byHandle).map(byHandle),
		['a:two', 'a:one', 'b:one'],
	)
	// Two tabs sharing a project id are not interchangeable.
	assert.deepEqual(
		moveItemByDrop(handled, 'b:one', 'a:two', 'after', byHandle).map(byHandle),
		['a:one', 'a:two', 'b:one'],
	)
})
