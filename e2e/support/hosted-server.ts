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
  const repoDir = path.resolve(process.cwd(), '../terminay.com')
  return existsSync(path.join(repoDir, 'server/index.js')) &&
    existsSync(path.join(repoDir, 'scripts/build-app.mjs'))
}

export async function startHostedServer(): Promise<HostedServer> {
  const repoDir = path.resolve(process.cwd(), '../terminay.com')
  const staticDir = path.join(repoDir, 'app/dist')
  const pgPort = await getFreePort()
  const port = await getFreePort()
  const containerName = `terminay-e2e-postgres-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let serverProcess: ChildProcessWithoutNullStreams | null = null
  const logs: string[] = []

  await execFileAsync('npm', ['run', 'build:app'], { cwd: repoDir })
  for (const file of ['index.html', 'main.js', 'protocol.js']) {
    if (!existsSync(path.join(staticDir, file))) {
      throw new Error(`Terminay hosted app build did not create app/dist/${file}.`)
    }
  }

  await execFileAsync('docker', [
    'run',
    '--rm',
    '--name',
    containerName,
    '-e',
    'POSTGRES_DB=terminay_app',
    '-e',
    'POSTGRES_USER=terminay',
    '-e',
    'POSTGRES_PASSWORD=terminay',
    '-p',
    `127.0.0.1:${pgPort}:5432`,
    '-d',
    'postgres:17-alpine',
  ])
  await waitForPostgres(containerName)
  await waitForHostPort(pgPort)
  await new Promise((resolve) => setTimeout(resolve, 1_000))

  try {
    serverProcess = spawn(process.execPath, ['server/index.js'], {
      cwd: repoDir,
      env: {
        ...process.env,
        DATABASE_URL: `postgres://terminay:terminay@127.0.0.1:${pgPort}/terminay_app`,
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
        await execFileAsync('docker', ['rm', '-f', containerName]).catch(() => undefined)
      },
    }
  } catch (error) {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM')
    }
    await execFileAsync('docker', ['rm', '-f', containerName]).catch(() => undefined)
    throw error
  }
}
