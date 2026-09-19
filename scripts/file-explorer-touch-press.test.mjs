import assert from 'node:assert/strict'
import test from 'node:test'
import {
	createFileExplorerTouchPress,
	FILE_EXPLORER_TOUCH_DRAG_HOLD_MS,
} from '../src/workspace/fileExplorerTouchPress.ts'

function createClock() {
	const pending = []
	let nextId = 1
	let now = 0
	return {
		advance(ms) {
			now += ms
			for (const item of pending.filter((entry) => entry.at <= now)) {
				pending.splice(pending.indexOf(item), 1)
				item.handler()
			}
		},
		clearTimeout(id) {
			const index = pending.findIndex((item) => item.id === id)
			if (index >= 0) pending.splice(index, 1)
		},
		setTimeout(handler, delay) {
			const id = nextId++
			pending.push({ at: now + delay, handler, id })
			return id
		},
	}
}

function pressWithClock() {
	const clock = createClock()
	const armed = []
	const press = createFileExplorerTouchPress({
		clearTimeout: (id) => clock.clearTimeout(id),
		onArm: (pointerId) => armed.push(pointerId),
		setTimeout: (handler, delay) => clock.setTimeout(handler, delay),
	})
	return { armed, clock, press }
}

const touchDown = { button: 0, clientX: 20, clientY: 20, pointerId: 7, pointerType: 'touch' }

test('the hold lasts one second', () => {
	assert.equal(FILE_EXPLORER_TOUCH_DRAG_HOLD_MS, 1000)
})

test('moving before one second leaves the touch to scroll and never arms', () => {
	const { armed, clock, press } = pressWithClock()
	press.pointerDown(touchDown)
	clock.advance(300)
	press.pointerMove({ clientX: 20, clientY: 60, pointerId: 7 })
	clock.advance(2000)
	assert.deepEqual(armed, [])
	assert.equal(press.armedPointerId(), null)
	assert.equal(press.pointerUp({ pointerId: 7 }), false)
})

test('holding still for one second arms the drag', () => {
	const { armed, clock, press } = pressWithClock()
	press.pointerDown(touchDown)
	clock.advance(999)
	assert.deepEqual(armed, [])
	press.pointerMove({ clientX: 22, clientY: 21, pointerId: 7 })
	clock.advance(1)
	assert.deepEqual(armed, [7])
	assert.equal(press.armedPointerId(), 7)
})

test('a quick tap is not armed and lets the click through', () => {
	const { armed, clock, press } = pressWithClock()
	press.pointerDown(touchDown)
	clock.advance(150)
	assert.equal(press.pointerUp({ pointerId: 7 }), false)
	clock.advance(2000)
	assert.deepEqual(armed, [])
	assert.equal(press.consumeClick(), false)
})

test('releasing an armed touch reports it and swallows the click', () => {
	const { clock, press } = pressWithClock()
	press.pointerDown(touchDown)
	clock.advance(1000)
	assert.equal(press.pointerUp({ pointerId: 7 }), true)
	assert.equal(press.armedPointerId(), null)
	assert.equal(press.consumeClick(), true)
	assert.equal(press.consumeClick(), false)
})

test('a cancelled touch disarms', () => {
	const { clock, press } = pressWithClock()
	press.pointerDown(touchDown)
	clock.advance(1000)
	press.pointerCancel({ pointerId: 7 })
	assert.equal(press.armedPointerId(), null)
	assert.equal(press.pointerUp({ pointerId: 7 }), false)
})

test('the native touch context menu is suppressed while a touch is held', () => {
	const { clock, press } = pressWithClock()
	press.pointerDown(touchDown)
	clock.advance(500)
	assert.equal(press.suppressContextMenu(), true)
})

test('mouse presses never arm and clear a finished touch', () => {
	const { armed, clock, press } = pressWithClock()
	press.pointerDown(touchDown)
	clock.advance(1000)
	press.pointerUp({ pointerId: 7 })
	press.pointerDown({ ...touchDown, button: 2, pointerId: 1, pointerType: 'mouse' })
	assert.equal(press.suppressContextMenu(), false)
	assert.equal(press.consumeClick(), false)
	press.pointerDown({ ...touchDown, pointerId: 1, pointerType: 'mouse' })
	clock.advance(2000)
	assert.deepEqual(armed, [7])
	assert.equal(press.armedPointerId(), null)
})
