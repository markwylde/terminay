import assert from 'node:assert/strict';
import test from 'node:test';

import {
	defaultTerminalSettings,
	normalizeTerminalSettings,
	PIXEL_CODEX_PROVIDER,
	terminalSettingsSections,
} from './terminalSettings.ts';

const fields = terminalSettingsSections.flatMap((section) => section.fields);

test('Pixel is off by default with no agent chosen', () => {
	assert.deepEqual(defaultTerminalSettings.pixel, {
		enabled: false,
		provider: 'unset',
	});
});

test('Settings > AI > Pixel has an Enable Pixel switch and an agent choice', () => {
	const enable = fields.find((field) => field.key === 'pixel.enabled');
	const provider = fields.find((field) => field.key === 'pixel.provider');
	assert.equal(enable?.input, 'boolean');
	assert.equal(enable?.label, 'Enable Pixel');
	assert.equal(enable?.categoryId, 'ai');
	assert.equal(provider?.input, 'select');
	assert.deepEqual(
		provider?.options?.map((option) => option.label),
		['Ask on first click', 'Claude Code', 'Codex'],
	);
	const section = terminalSettingsSections.find((s) => s.id === 'pixel');
	assert.match(section?.description ?? '', /not a sandbox/);
});

test('a chosen provider is kept and anything else falls back', () => {
	const kept = normalizeTerminalSettings({
		...defaultTerminalSettings,
		pixel: { enabled: true, provider: PIXEL_CODEX_PROVIDER },
	}).pixel;
	assert.deepEqual(kept, { enabled: true, provider: PIXEL_CODEX_PROVIDER });
	const reset = normalizeTerminalSettings({
		...defaultTerminalSettings,
		pixel: { enabled: 'yes', provider: '../../etc' },
	} as never).pixel;
	assert.deepEqual(reset, { enabled: false, provider: 'unset' });
});
