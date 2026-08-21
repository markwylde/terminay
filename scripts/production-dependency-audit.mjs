import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PINNED_NPM = '12.0.2'
const TEMPORARY_NPM_EXCEPTIONS = new Set(['brace-expansion', 'ip-address', 'npm', 'tar'])

export function evaluateProductionAudit(report, packageJson) {
  if (packageJson?.dependencies?.npm !== PINNED_NPM) {
    throw new Error(`production audit policy requires bundled npm ${PINNED_NPM}`)
  }
  const violations = []
  const exceptions = []
  for (const [name, vulnerability] of Object.entries(report?.vulnerabilities ?? {})) {
    if (!['high', 'critical'].includes(vulnerability?.severity)) continue
    const nodes = Array.isArray(vulnerability.nodes) ? vulnerability.nodes : []
    const isBoundedNpmException =
      vulnerability.severity === 'high' &&
      TEMPORARY_NPM_EXCEPTIONS.has(name) &&
      nodes.length > 0 &&
      nodes.every((path) =>
        path === (name === 'npm' ? 'node_modules/npm' : `node_modules/npm/node_modules/${name}`),
      )
    if (isBoundedNpmException) exceptions.push({ name, severity: vulnerability.severity, nodes })
    else violations.push({ name, severity: vulnerability?.severity ?? 'unknown', nodes })
  }
  if (violations.length > 0) throw new Error(`production dependency audit failed: ${JSON.stringify(violations)}`)
  return Object.freeze({
    counts: Object.freeze({ ...(report?.metadata?.vulnerabilities ?? {}) }),
    exceptions: Object.freeze(exceptions),
  })
}

export async function runProductionAudit(root = process.cwd()) {
  let stdout = ''
  try {
    ;({ stdout } = await execFileAsync('npm', ['audit', '--json', '--omit=dev'], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
    }))
  } catch (error) {
    stdout = error?.stdout ?? ''
    if (stdout.length === 0) throw error
  }
  const packageJson = JSON.parse(await readFile(`${root}/package.json`, 'utf8'))
  return evaluateProductionAudit(JSON.parse(stdout), packageJson)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await runProductionAudit()))
}
