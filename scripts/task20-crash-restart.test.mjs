import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopLocalServerSupervisor } from '../apps/terminay-desktop/dist/main/index.js'

test('local crash loops require explicit serialized recovery and never overlap authorities', async () => {
  const counters = {
    active: 0,
    factories: 0,
    maxActive: 0,
    starts: 0,
    stops: 0,
  }
  const authorities = []
  let current
  const supervisor = createDesktopLocalServerSupervisor({
    create: (bootstrap) => {
      counters.factories += 1
      current = createAuthority(`local-${counters.factories}`, counters, bootstrap)
      authorities.push(current)
      return current
    },
  })

  try {
    const [first, coalesced] = await Promise.all([
      supervisor.start(),
      supervisor.start(),
    ])
    assert.equal(first.serverId, 'local-1')
    assert.equal(coalesced.serverId, first.serverId)
    assert.equal(counters.factories, 1)
    assert.equal(counters.starts, 1)
    assert.equal(counters.active, 1)

    for (let crash = 1; crash <= 3; crash += 1) {
      current.crash()
      assert.equal(supervisor.state, 'crashed')
      assert.equal(counters.factories, crash)
      assert.throws(() => supervisor.start(), /requires explicit restart/u)

      const recoveries = crash === 1
        ? await Promise.all([supervisor.restart(), supervisor.restart()])
        : [await supervisor.restart()]
      const recovered = recoveries[0]
      assert.equal(recovered.serverId, `local-${crash + 1}`)
      assert.equal(recoveries.every((readiness) => readiness.serverId === recovered.serverId), true)
      assert.equal(supervisor.state, 'ready')
      assert.equal(counters.active, 1)
      assert.equal(counters.maxActive, 1)
    }

    await Promise.all([supervisor.stop(), supervisor.stop()])
    assert.equal(supervisor.state, 'stopped')
    assert.equal(counters.active, 0)
    assert.equal(counters.stops, 4)
    assert.equal(authorities.every((authority) => authority.stopCalls === 1), true)
  } finally {
    await supervisor.stop()
  }
})

test('standalone server crash loops release the listener and recover the same data root', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-task20-crash-loop-'))
  const children = []

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const child = spawn(process.execPath, [
        'apps/terminay-server/dist/cli.js',
        '--server-id', 'task20-crash-loop',
        '--data-root', dataRoot,
        '--endpoint', 'disabled',
        '--health-port', '0',
      ], {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      children.push(child)

      const readiness = await readReadiness(child)
      assert.equal(readiness.ready, true)
      assert.equal(readiness.serverId, 'task20-crash-loop')
      assert.equal(readiness.dataRoot, dataRoot)
      assert.equal(typeof readiness.healthEndpoint, 'string')

      const ready = await fetch(`${readiness.healthEndpoint}/readyz`)
      assert.equal(ready.status, 200)
      assert.equal((await ready.json()).ready, true)

      child.kill('SIGKILL')
      await waitForExit(child)
      await assert.rejects(fetch(`${readiness.healthEndpoint}/healthz`))
    }
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    await Promise.all(children.map((child) => waitForExit(child)))
    await rm(dataRoot, { recursive: true, force: true })
  }
})

function readReadiness(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for standalone readiness: ${stderr}`)), 15_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const newline = stdout.indexOf('\n')
      if (newline < 0) return
      clearTimeout(timeout)
      try {
        resolve(JSON.parse(stdout.slice(0, newline)))
      } catch (error) {
        reject(new Error(`invalid standalone readiness: ${error}; stderr=${stderr}`))
      }
    })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`standalone server exited before readiness: code=${code} signal=${signal}; stderr=${stderr}`))
    })
  })
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', resolve))
}

function createAuthority(serverId, counters, bootstrap) {
  const listeners = new Set()
  const credential = bootstrap.claim()
  let state = 'created'
  const authority = {
    get state() {
      return state
    },
    stopCalls: 0,
    async start() {
      assert.equal(state, 'created')
      counters.starts += 1
      counters.active += 1
      counters.maxActive = Math.max(counters.maxActive, counters.active)
      state = 'ready'
      for (const listener of listeners) listener('ready')
      return {
        serverId,
        serverVersion: 'task20-test',
        origin: `http://127.0.0.1:${4300 + counters.starts}`,
        endpoint: `127.0.0.1:${4300 + counters.starts}`,
        bootstrapCredential: credential.value,
        bootstrapCredentialExpiresAt: credential.expiresAt,
      }
    },
    async stop() {
      authority.stopCalls += 1
      counters.stops += 1
      if (state === 'ready' || state === 'crashed') counters.active -= 1
      state = 'stopped'
      for (const listener of listeners) listener('stopped')
    },
    onStateChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    crash() {
      assert.equal(state, 'ready')
      state = 'crashed'
      for (const listener of listeners) listener('crashed')
    },
  }
  return authority
}
