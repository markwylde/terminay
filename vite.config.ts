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

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: path.join(__dirname, 'index.html'),
        remote: path.join(__dirname, 'remote.html'),
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
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
