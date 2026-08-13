import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateProductionAudit } from './production-dependency-audit.mjs'

const packageJson = { dependencies: { npm: '12.0.2' } }
const report = (vulnerabilities) => ({
  vulnerabilities,
  metadata: { vulnerabilities: { high: Object.values(vulnerabilities).filter((item) => item.severity === 'high').length, critical: 0 } },
})

test('permits only the two bounded vulnerabilities inside the pinned npm installer', () => {
  const result = evaluateProductionAudit(report({
    'brace-expansion': { severity: 'high', nodes: ['node_modules/npm/node_modules/brace-expansion'] },
    'ip-address': { severity: 'high', nodes: ['node_modules/npm/node_modules/ip-address'] },
  }), packageJson)
  assert.deepEqual(result.exceptions.map((item) => item.name), ['brace-expansion', 'ip-address'])
})

test('fails closed for critical, unrelated, relocated, or unpinned vulnerabilities', () => {
  assert.throws(() => evaluateProductionAudit(report({ tar: { severity: 'critical', nodes: ['node_modules/npm/node_modules/tar'] } }), packageJson))
  assert.throws(() => evaluateProductionAudit(report({ minimatch: { severity: 'high', nodes: ['node_modules/minimatch'] } }), packageJson))
  assert.throws(() => evaluateProductionAudit(report({ 'ip-address': { severity: 'high', nodes: ['node_modules/ip-address'] } }), packageJson))
  assert.throws(() => evaluateProductionAudit(report({}), { dependencies: { npm: '12.0.1' } }))
})
