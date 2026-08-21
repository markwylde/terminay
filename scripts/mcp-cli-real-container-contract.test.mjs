import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const text = (path) => readFile(new URL(path, root), 'utf8')

test('real MCP client compatibility installs latest CLIs inside an isolated image', async () => {
  const [dockerfile, runner, probe, packageJson] = await Promise.all([
    text('Dockerfile.mcp-cli-compat'),
    text('scripts/run-mcp-cli-real-tests.sh'),
    text('scripts/mcp-cli-real-compat.test.mjs'),
    text('package.json'),
  ])
  const scripts = JSON.parse(packageJson).scripts

  assert.equal(scripts['e2e:mcp-cli-real-tests'], 'sh scripts/run-mcp-cli-real-tests.sh')
  for (const packageName of [
    '@anthropic-ai/claude-code',
    '@openai/codex',
    '@google/gemini-cli',
    'opencode-ai',
  ]) {
    assert.match(dockerfile, new RegExp(`${escapeRegex(packageName)}@latest`, 'u'))
  }
  assert.match(
    dockerfile,
    /--allow-scripts=@anthropic-ai\/claude-code,esbuild,opencode-ai,@github\/keytar,node-pty/u,
  )
  assert.match(dockerfile, /curl https:\/\/cursor\.com\/install -fsS \| bash/u)
  assert.match(runner, /--build-arg "CLI_COMPAT_CACHE_BUST=\$cache_bust"/u)
  assert.match(runner, /arm64\|aarch64\) platform=linux\/arm64/u)
  assert.match(runner, /x86_64\|amd64\) platform=linux\/amd64/u)
  assert.match(runner, /docker run[\s\S]*--rm[\s\S]*--network none/u)
  assert.doesNotMatch(runner, /^\s+(?:--volume|-v(?:[ =]|$))/mu)
  assert.doesNotMatch(runner, /HOME|\.claude|\.codex|\.cursor|\.gemini|opencode/u)

  for (const command of [
    "binary: 'claude', listArgs: ['mcp', 'list']",
    "binary: 'codex', listArgs: ['mcp', 'list']",
    "binary: 'cursor-agent', listArgs: ['mcp', 'list']",
    "binary: 'gemini', listArgs: ['mcp', 'list']",
    "binary: 'opencode', listArgs: ['mcp', 'list']",
  ]) {
    assert.match(probe, new RegExp(escapeRegex(command), 'u'))
  }
  assert.match(probe, /mkdtemp\(join\(tmpdir\(\), 'terminay-real-mcp-clients-'\)\)/u)
  assert.match(probe, /process\.env\.HOME = homeDirectory/u)
})

test('GitHub and Gitea CI call the same Docker compatibility entrypoint', async () => {
  const workflows = await Promise.all([
    text('.github/workflows/ci.yml'),
    text('.gitea/workflows/ci.yml'),
  ])
  for (const workflow of workflows) {
    assert.match(workflow, /^ {2}mcp-cli-compatibility:$/mu)
    assert.match(workflow, /name: Real MCP CLI compatibility/u)
    assert.match(workflow, /run: npm run e2e:mcp-cli-real-tests/u)
  }
})

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
