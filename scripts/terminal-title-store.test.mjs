import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// What each terminal displays is live state the server publishes beside the
// workspace (ADR-0058). A change to one terminal's title is heard by whoever
// shows that terminal, and by nobody else.

const outputDirectory = await mkdtemp(join(process.cwd(), 'scripts', '.terminal-title-store-'))
await build({ absWorkingDir: process.cwd(), bundle: true, entryPoints: ['src/shared/TerminalTitleStore.ts'], format: 'esm', outdir: outputDirectory, platform: 'node' })
const { TerminalTitleStore } = await import(pathToFileURL(join(outputDirectory, 'TerminalTitleStore.js')).href)
test.after(async () => { await rm(outputDirectory, { recursive: true, force: true }) })

const entry = (panelId, title, projectId = 'project-a') => ({ panelId, projectId, sessionId: `session-${panelId}`, title })

function fakeClient(snapshots) {
	let eventListener
	let resyncListener
	const calls = []
	const pending = []
	return {
		calls,
		emit(payload) { eventListener?.({ payload }) },
		emitResync() { resyncListener?.() },
		/** Answer the oldest unanswered snapshot query. */
		answer() { pending.shift()?.() },
		async query(operation) {
			calls.push(operation)
			assert.equal(operation, 'terminal-titles.snapshot')
			const titles = snapshots.shift() ?? {}
			if (titles instanceof Error) throw titles
			if (titles.held === true) await new Promise((resolve) => pending.push(resolve))
			return { result: { titles: titles.held === true ? titles.titles : titles } }
		},
		async subscribe(event) {
			calls.push(`subscribe:${event}`)
			return {
				onEvent(listener) { eventListener = listener; return () => { eventListener = undefined } },
				onResync(listener) { resyncListener = listener; return () => { resyncListener = undefined } },
				async unsubscribe() { calls.push('unsubscribe') },
			}
		},
	}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('the store subscribes, then loads every title', async () => {
	const client = fakeClient([{ 'panel-a': entry('panel-a', 'claude'), 'panel-b': entry('panel-b', 'Terminal 2') }])
	const store = new TerminalTitleStore({ client, enabled: true })
	await store.start()
	assert.deepEqual(client.calls, ['subscribe:terminal-titles', 'terminal-titles.snapshot'])
	assert.equal(store.title('panel-a'), 'claude')
	assert.equal(store.title('panel-b'), 'Terminal 2')
	assert.equal(store.title('panel-zz'), undefined)
	store.close()
})

test('a title change is heard by that terminal\'s listeners and no other\'s', async () => {
	const client = fakeClient([{ 'panel-a': entry('panel-a', 'Terminal 1'), 'panel-b': entry('panel-b', 'Terminal 2') }])
	const store = new TerminalTitleStore({ client, enabled: true })
	await store.start()
	const heard = { a: 0, b: 0, any: 0 }
	const stopA = store.subscribe('panel-a', () => { heard.a += 1 })
	store.subscribe('panel-b', () => { heard.b += 1 })
	store.subscribeAny(() => { heard.any += 1 })

	for (let frame = 1; frame <= 5; frame += 1) client.emit(entry('panel-a', `working ${frame}`))
	assert.deepEqual(heard, { a: 5, b: 0, any: 5 })
	assert.equal(store.title('panel-a'), 'working 5')
	assert.equal(store.title('panel-b'), 'Terminal 2')

	// The same title again is not a change.
	client.emit(entry('panel-a', 'working 5'))
	assert.deepEqual(heard, { a: 5, b: 0, any: 5 })

	stopA()
	client.emit(entry('panel-a', 'done'))
	assert.deepEqual(heard, { a: 5, b: 0, any: 6 })
	store.close()
})

test('a removed terminal has no title, and a malformed event changes nothing', async () => {
	const client = fakeClient([{ 'panel-a': entry('panel-a', 'claude') }])
	const store = new TerminalTitleStore({ client, enabled: true })
	await store.start()
	let heard = 0
	store.subscribe('panel-a', () => { heard += 1 })

	for (const payload of [null, 'x', [], {}, { panelId: 7, title: 'x' }, { panelId: 'panel-a' }, { panelId: 'panel-a', title: 7 }])
		client.emit(payload)
	assert.equal(heard, 0)
	assert.equal(store.title('panel-a'), 'claude')

	client.emit({ panelId: 'panel-a', projectId: 'project-a', sessionId: 'session-panel-a', removed: true })
	assert.equal(store.title('panel-a'), undefined)
	assert.equal(heard, 1)
	// Removing what is not held is not a change.
	client.emit({ panelId: 'panel-a', projectId: 'project-a', sessionId: 'session-panel-a', removed: true })
	assert.equal(heard, 1)
	store.close()
})

test('a server that publishes no titles is never asked for them', async () => {
	const client = fakeClient([])
	const store = new TerminalTitleStore({ client, enabled: false })
	await store.start()
	assert.deepEqual(client.calls, [])
	assert.equal(store.title('panel-a'), undefined)
	store.close()
})

test('a title that changes while the snapshot is in flight is not overwritten by it', async () => {
	const client = fakeClient([{ held: true, titles: { 'panel-a': entry('panel-a', 'stale'), 'panel-b': entry('panel-b', 'Terminal 2'), 'panel-c': entry('panel-c', 'gone soon') } }])
	const store = new TerminalTitleStore({ client, enabled: true })
	const starting = store.start()
	await settle()
	client.emit(entry('panel-a', 'fresh'))
	client.emit({ panelId: 'panel-c', projectId: 'project-a', sessionId: 'session-panel-c', removed: true })
	client.answer()
	await starting
	assert.equal(store.title('panel-a'), 'fresh')
	assert.equal(store.title('panel-b'), 'Terminal 2')
	assert.equal(store.title('panel-c'), undefined)
	store.close()
})

test('a resync reloads every title and tells only the terminals whose title differs', async () => {
	const client = fakeClient([
		{ 'panel-a': entry('panel-a', 'claude'), 'panel-b': entry('panel-b', 'Terminal 2'), 'panel-c': entry('panel-c', 'vim') },
		{ 'panel-a': entry('panel-a', 'claude'), 'panel-b': entry('panel-b', 'db') },
	])
	const store = new TerminalTitleStore({ client, enabled: true })
	await store.start()
	const heard = { a: 0, b: 0, c: 0, any: 0 }
	store.subscribe('panel-a', () => { heard.a += 1 })
	store.subscribe('panel-b', () => { heard.b += 1 })
	store.subscribe('panel-c', () => { heard.c += 1 })
	store.subscribeAny(() => { heard.any += 1 })

	client.emitResync()
	await settle()

	assert.deepEqual(heard, { a: 0, b: 1, c: 1, any: 1 })
	assert.equal(store.title('panel-b'), 'db')
	assert.equal(store.title('panel-c'), undefined)
	store.close()
})

test('a failed snapshot leaves the store empty and usable, and a closed store hears nothing', async () => {
	const client = fakeClient([new Error('offline')])
	const store = new TerminalTitleStore({ client, enabled: true })
	await assert.rejects(() => store.start(), /offline/)
	assert.equal(store.title('panel-a'), undefined)
	// The subscription stands, so a later title still arrives.
	client.emit(entry('panel-a', 'claude'))
	assert.equal(store.title('panel-a'), 'claude')

	let heard = 0
	store.subscribe('panel-a', () => { heard += 1 })
	store.close()
	client.emit(entry('panel-a', 'after close'))
	assert.equal(heard, 0)
	assert.equal(store.title('panel-a'), 'claude')
	await settle()
	assert.equal(client.calls.at(-1), 'unsubscribe')
})
