#!/usr/bin/env node
import { spawn } from 'node:child_process'

const child = spawn(process.execPath, ['--test', 'scripts/server-ui-archive-integration-proof.test.mjs'], {
  cwd: process.cwd(), stdio: 'inherit',
})
const result = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => resolve({ code, signal }))
})
if (result.code !== 0 || result.signal !== null) {
  throw new Error(`server UI archive integration proof exited with code ${result.code} and signal ${result.signal}.`)
}
process.stdout.write('server-ui-archive-integration=generic-hosted-manager:ok\n')
