import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const nodeBuiltins = [
  'node:fs',
  'node:fs/promises',
  'node:path',
  'node:crypto',
  'node:child_process',
  'node:util',
  'node:http',
  'node:https',
  'node:os',
  'node:net',
  'node:tls',
  'node:stream',
  'node:buffer',
  'node:events',
  'node:url',
  'node:zlib',
  'node:module',
  'node:process',
  'node-pty',
  'qrcode',
  'selfsigned',
  'ws',
]

const appInput = {
  main: path.join(__dirname, 'index.html'),
  remote: path.join(__dirname, 'remote.html'),
}

const electronInput = {
  main: path.join(__dirname, 'electron/main.ts'),
  serverUiPreload: path.join(__dirname, 'electron/serverUiPreload.ts'),
  extensionHostEntry: path.join(__dirname, 'packages/server-core/src/extensions/child.ts'),
  // Keep the packaged desktop MCP process on the server-owned adapter. The
  // legacy Electron entry remains available for compatibility tests, but the
  // installed provider command points at this renderer-free bundle.
  serverMcpEntry: path.join(__dirname, 'apps/terminay-server/src/mcpEntry.ts'),
  mcpEntry: path.join(__dirname, 'electron/mcpEntry.ts'),
}

export default defineConfig({
  build: {
    // The desktop bootstrap must execute before any dependency graph work.
    // Vite's preload helper otherwise gates the dynamic renderer import on
    // stylesheet/module preload events in Electron.
    modulePreload: false,
    rollupOptions: {
      input: appInput,
    },
    rolldownOptions: {
      input: appInput,
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          resolve: {
            alias: {
              tslib: path.join(__dirname, 'node_modules/tslib/tslib.es6.mjs'),
            },
          },
          build: {
            rolldownOptions: {
              input: electronInput,
              external: nodeBuiltins,
            },
            rollupOptions: {
              input: electronInput,
              external: nodeBuiltins,
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
})
