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
  ptyHost: path.join(__dirname, 'electron/ptyHost.ts'),
  mcpEntry: path.join(__dirname, 'electron/mcpEntry.ts'),
}

export default defineConfig({
  build: {
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
