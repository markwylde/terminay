import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile('src/App.tsx', 'utf8')
const settingsWindow = await readFile('src/components/SettingsWindow.tsx', 'utf8')
const client = await readFile('src/services/ai/legacyAiTabMetadataClient.ts', 'utf8')
const task = await readFile('specs/tasks_completed/16-shared-responsive-server-ui.md', 'utf8')

test('AI metadata uses the narrow injected Desktop adapter and isolates broad preload compatibility', () => {
	assert.match(app, /createLegacyAiTabMetadataClient\(window\.terminayAiMetadataHost\)/)
	assert.match(app, /aiTabMetadataClient!\.generate\(/)
	assert.match(
		settingsWindow,
		/createLegacyAiTabMetadataClient\(window\.terminayAiMetadataHost\)/,
	)
	assert.match(settingsWindow, /aiTabMetadataClient\s*\.\s*listModels\('codex'\)/)
	assert.match(
		settingsWindow,
		/aiTabMetadataClient\s*\.\s*listModels\('claudeCode'\)/,
	)
	assert.doesNotMatch(settingsWindow, /window\.terminay\.listAiTabMetadataModels/)
	assert.doesNotMatch(app, /window\.terminay\.generateAiTabMetadata/)
	assert.match(client, /captureLegacyAiTabMetadataCapability/)
	assert.match(
		client,
		/const \{ generateAiTabMetadata, listAiTabMetadataModels \} = api/,
	)
	assert.match(client, /Object\.freeze\(\{\s*generateAiTabMetadata:/)
	assert.match(client, /capability\.generateAiTabMetadata\(request\)/)
	assert.match(client, /capability\.listAiTabMetadataModels\(provider\)/)
	assert.match(client, /legacy AI metadata response is invalid/)
	assert.match(client, /legacy AI model response is invalid/)
	assert.doesNotMatch(client, /window\.terminay/)
	assert.match(task, /\[x\] Migrate App AI tab metadata generation through the shared/)
})
