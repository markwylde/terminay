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
  'esbuild',
  'qrcode',
  'selfsigned',
  'ws',
]

const appInput = {
  remote: path.join(__dirname, 'remote.html'),
}

const electronInput = {
  main: path.join(__dirname, 'electron/main.ts'),
  extensionHostEntry: path.join(__dirname, 'packages/server-core/src/extensions/child.ts'),
  // The Desktop MCP adapter is a renderer-free Node entry launched from the
  // packaged application's unpacked resources.
  serverMcpEntry: path.join(__dirname, 'apps/terminay-server/src/desktopMcpEntry.ts'),
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
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
})
