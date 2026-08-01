import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type HostedServer = {
  hostedDomain: string
  origin: string
  port: number
  stop: () => Promise<void>
}

const HOSTED_E2E_POSTGRES_LABEL = 'com.terminay.e2e-hosted-pairing=true'

async function removeHostedE2ePostgres(containerName: string): Promise<void> {
  await execFileAsync('docker', ['rm', '--force', containerName]).catch(() => undefined)
}

/**
 * A timed-out Playwright worker cannot run its normal finally block. Reap only
 * containers that this harness explicitly labelled, never arbitrary local
 * PostgreSQL containers.
 */
async function removeOrphanedHostedE2ePostgres(): Promise<void> {
  const { stdout } = await execFileAsync('docker', [
    'ps', '-aq', '--filter', `label=${HOSTED_E2E_POSTGRES_LABEL}`,
  ]).catch(() => ({ stdout: '' }))
  const containerIds = stdout.split(/\s+/u).filter(Boolean)
  await Promise.all(containerIds.map((containerId) =>
    execFileAsync('docker', ['rm', '--force', containerId]).catch(() => undefined),
  ))
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
        } else {
          reject(new Error('Unable to allocate a local port.'))
        }
      })
    })
  })
}

async function waitForHealthz(port: number, process: ChildProcessWithoutNullStreams, logs: string[]): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    if (process.exitCode !== null) {
      throw new Error(`Terminay hosted server exited before it was ready.\n${logs.join('')}`)
    }

    const healthy = await new Promise<boolean>((resolve) => {
      const request = http.get(`http://127.0.0.1:${port}/healthz`, (response) => {
        response.resume()
        resolve(response.statusCode === 200)
      })
      request.on('error', () => resolve(false))
      request.setTimeout(750, () => {
        request.destroy()
        resolve(false)
      })
    })
    if (healthy) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`Timed out waiting for Terminay hosted server.\n${logs.join('')}`)
}

async function waitForPostgres(containerName: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 60_000) {
    try {
      await execFileAsync('docker', ['exec', containerName, 'pg_isready', '-U', 'terminay', '-d', 'terminay_app'])
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw new Error('Timed out waiting for local Terminay PostgreSQL container.')
}

async function waitForHostPort(port: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
      socket.setTimeout(500, () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (connected) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for local PostgreSQL port forwarding.')
}

export function hasHostedServerSource(): boolean {
  const repoDir = resolveHostedServerRepo()
  return existsSync(path.join(repoDir, 'server/index.js')) &&
    existsSync(path.join(repoDir, 'scripts/build-app.mjs'))
}

export async function startHostedServer(): Promise<HostedServer> {
  const repoDir = resolveHostedServerRepo()
  const staticDir = path.join(repoDir, 'app/dist')
  const externalDatabaseUrl = process.env.TERMINAY_E2E_DATABASE_URL
  const pgPort = externalDatabaseUrl
    ? Number(new URL(externalDatabaseUrl).port || '5432')
    : await getFreePort()
  const port = await getFreePort()
  const containerName = `terminay-e2e-postgres-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let serverProcess: ChildProcessWithoutNullStreams | null = null
  let ownsPostgresContainer = false
  const logs: string[] = []

  try {
    await removeOrphanedHostedE2ePostgres()
    await execFileAsync('npm', ['run', 'build:app'], { cwd: repoDir })
    for (const file of ['index.html', 'main.js', 'protocol.js']) {
      if (!existsSync(path.join(staticDir, file))) {
        throw new Error(`Terminay hosted app build did not create app/dist/${file}.`)
      }
    }

    if (!externalDatabaseUrl) {
      await execFileAsync('docker', [
        'run',
        '--rm',
        '--name',
        containerName,
        '--label',
        HOSTED_E2E_POSTGRES_LABEL,
        '-e',
        'POSTGRES_DB=terminay_app',
        '-e',
        'POSTGRES_USER=terminay',
        '-e',
        'POSTGRES_PASSWORD=terminay',
        // The hosted-service proof needs a fresh disposable database. Keep its
        // state off Docker's persistent volume store so this local test neither
        // retains credentials nor depends on reclaiming unrelated image/volume
        // cache space.
        '--tmpfs',
        '/var/lib/postgresql/data:rw,noexec,nosuid,size=128m',
        '-p',
        `127.0.0.1:${pgPort}:5432`,
        '-d',
        'postgres:17-alpine',
      ])
      ownsPostgresContainer = true
      await waitForPostgres(containerName)
    }
    await waitForHostPort(pgPort)
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    serverProcess = spawn(process.execPath, ['server/index.js'], {
      cwd: repoDir,
      env: {
        ...process.env,
        DATABASE_URL: externalDatabaseUrl ??
          `postgres://terminay:terminay@127.0.0.1:${pgPort}/terminay_app`,
        PORT: String(port),
        STATIC_DIR: staticDir,
        TERMINAY_HOSTED_DOMAIN: 'localhost',
        TERMINAY_MANAGER_HOST: 'app.localhost',
      },
    })
    serverProcess.stdout.on('data', (chunk) => logs.push(chunk.toString()))
    serverProcess.stderr.on('data', (chunk) => logs.push(chunk.toString()))
    await waitForHealthz(port, serverProcess, logs)

    return {
      hostedDomain: `http://localhost:${port}`,
      origin: `http://localhost:${port}`,
      port,
      stop: async () => {
        if (serverProcess && serverProcess.exitCode === null) {
          serverProcess.kill('SIGTERM')
          await new Promise((resolve) => {
            serverProcess?.once('exit', resolve)
            setTimeout(resolve, 5_000)
          })
        }
        if (ownsPostgresContainer) {
          await removeHostedE2ePostgres(containerName)
        }
      },
    }
  } catch (error) {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM')
    }
    if (ownsPostgresContainer) {
      await removeHostedE2ePostgres(containerName)
    }
    throw error
  }
}

function resolveHostedServerRepo(): string {
  return path.resolve(
    process.env.TERMINAY_HOSTED_SERVER_REPO ?? path.join(process.cwd(), '../terminay.com'),
  )
}
