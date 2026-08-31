import assert from 'node:assert/strict'
import test from 'node:test'
import { createLongPressSession } from '../src/hooks/useLongPress.ts'

function createClock() {
	/** @type {{ delay: number, handler: () => void, id: number }[]} */
	const pending = []
	let nextId = 1
	let now = 0
	return {
		advance(ms) {
			now += ms
			const due = pending.filter((item) => item.delay <= now)
			for (const item of due) {
				const index = pending.indexOf(item)
				if (index >= 0) pending.splice(index, 1)
				item.handler()
			}
		},
		clearTimeout(id) {
			const index = pending.findIndex((item) => item.id === id)
			if (index >= 0) pending.splice(index, 1)
		},
		setTimeout(handler, delay) {
			const id = nextId
			nextId += 1
			pending.push({ delay: now + delay, handler, id })
			return id
		},
	}
}

function sessionWithClock(onLongPress, extra = {}) {
	const clock = createClock()
	return {
		clock,
		session: createLongPressSession({
			clearTimeout: (id) => clock.clearTimeout(id),
			onLongPress,
			setTimeout: (handler, delay) => clock.setTimeout(handler, delay),
			...extra,
		}),
	}
}

const touchDown = {
	button: 0,
	clientX: 10,
	clientY: 10,
	pointerId: 1,
	pointerType: 'touch',
}

test('fires after the delay when the pointer stays still', () => {
	const fires = []
	const { clock, session } = sessionWithClock(() => fires.push('edit'))
	session.pointerDown(touchDown)
	clock.advance(499)
	assert.deepEqual(fires, [])
	clock.advance(1)
	assert.deepEqual(fires, ['edit'])
	assert.equal(session.consumeClick(), true)
	assert.equal(session.consumeClick(), false)
})

test('a short press does not edit and still allows click', () => {
	const fires = []
	const { clock, session } = sessionWithClock(() => fires.push('edit'))
	session.pointerDown(touchDown)
	clock.advance(200)
	session.pointerUp({ pointerId: 1 })
	clock.advance(500)
	assert.deepEqual(fires, [])
	assert.equal(session.consumeClick(), false)
})

test('movement beyond the threshold cancels the hold', () => {
	const fires = []
	const { clock, session } = sessionWithClock(() => fires.push('edit'))
	session.pointerDown(touchDown)
	session.pointerMove({ clientX: 20, clientY: 10, pointerId: 1 })
	clock.advance(500)
	assert.deepEqual(fires, [])
	assert.equal(session.consumeClick(), false)
})

test('small movement still fires', () => {
	const fires = []
	const { clock, session } = sessionWithClock(() => fires.push('edit'))
	session.pointerDown(touchDown)
	session.pointerMove({ clientX: 14, clientY: 12, pointerId: 1 })
	clock.advance(500)
	assert.deepEqual(fires, ['edit'])
})

test('non-primary buttons do not start a hold', () => {
	const fires = []
	const { clock, session } = sessionWithClock(() => fires.push('edit'))
	session.pointerDown({ ...touchDown, button: 2, pointerType: 'mouse' })
	clock.advance(500)
	assert.deepEqual(fires, [])
	assert.equal(session.suppressContextMenu(), false)
})

test('touch holds suppress the context menu so iOS cannot steal the gesture', () => {
	const { clock, session } = sessionWithClock(() => {})
	session.pointerDown(touchDown)
	assert.equal(session.suppressContextMenu(), true)
	clock.advance(500)
	assert.equal(session.suppressContextMenu(), true)
	session.pointerUp({ pointerId: 1 })
	assert.equal(session.suppressContextMenu(), true)
	session.consumeClick()
	assert.equal(session.suppressContextMenu(), false)
})
