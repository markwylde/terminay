import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'

export type SharedWebShellFixture = {
  close: () => Promise<void>
  origin: string
  url: string
}

export async function startSharedWebShellFixture(): Promise<SharedWebShellFixture> {
  const repoDir = path.resolve(import.meta.dirname, '../..')
  const server: ViteDevServer = await createServer({
    configFile: false,
    root: repoDir,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
    resolve: {
      alias: {
        '@terminay/client-core': path.join(repoDir, 'packages/client-core/src/index.ts'),
        '@terminay/protocol': path.join(repoDir, 'packages/protocol/src/index.ts'),
        '@terminay/responsive-ui': path.join(repoDir, 'packages/responsive-ui/src/index.ts'),
      },
    },
  })
  await server.listen()
  await Promise.all([
    server.warmupRequest('/src/remote/main.tsx'),
    server.warmupRequest('/src/web/main.tsx'),
  ])
  const address = server.httpServer?.address()
  if (address === undefined || address === null || typeof address === 'string') {
    await server.close()
    throw new Error('Unable to allocate the shared web shell fixture port.')
  }
  const origin = `http://127.0.0.1:${address.port}`
  return {
    close: () => server.close(),
    origin,
    url: `${origin}/e2e/fixtures/shared-web-shell.html`,
  }
}
