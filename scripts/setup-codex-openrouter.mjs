import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const apiKey = process.env.OPENROUTER_API_KEY?.trim()
const model = process.env.TERMIDE_CODEX_TEST_MODEL?.trim() || 'openai/gpt-5.1-codex-mini'
const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex')

if (!apiKey) {
  throw new Error('OPENROUTER_API_KEY must be set before configuring Codex for OpenRouter.')
}

await mkdir(codexHome, { recursive: true })

const config = [
  'model_provider = "openrouter"',
  `model = ${JSON.stringify(model)}`,
  'model_reasoning_effort = "low"',
  '',
  '[model_providers.openrouter]',
  'name = "openrouter"',
  'base_url = "https://openrouter.ai/api/v1"',
  'env_key = "OPENROUTER_API_KEY"',
  '',
].join('\n')

await writeFile(path.join(codexHome, 'config.toml'), config, { mode: 0o600 })

console.log(`Configured Codex OpenRouter provider in ${path.join(codexHome, 'config.toml')}`)
console.log(`Using Codex test model ${model}`)
