import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Desktop is recognised only from a desktop host context', () => {
	const hook = read('src/host/useIsDesktopHost.ts');
	assert.match(hook, /useState\(false\)/, 'starts false, so a browser never shows it');
	assert.match(hook, /context\.hostKind === 'desktop'/);
});

test('every Command Bar entry for Import & Export is gated on a Desktop host', () => {
	const app = read('src/App.tsx');
	const entries = [...app.matchAll(/id: 'open-import-export'/g)];
	assert.ok(entries.length >= 2, 'both Command Bar lists offer the command');
	for (const entry of entries) {
		const before = app.slice(Math.max(0, entry.index - 400), entry.index);
		assert.match(
			before,
			/\.\.\.\(isDesktopHost\s*\?/,
			'the entry is spread in only when isDesktopHost is true',
		);
	}
	assert.equal(
		[...app.matchAll(/const isDesktopHost = useIsDesktopHost\(\);/g)].length,
		entries.length,
	);
});

test('Settings offers the Import & Export category only on a Desktop host', () => {
	const settings = read('src/components/SettingsWindow.tsx');
	assert.match(settings, /const importExportAvailable = useIsDesktopHost\(\);/);
	assert.match(
		settings,
		/\.\.\.\(importExportAvailable \? \[importExportSettingsCategory\] : \[\]\)/,
	);
	assert.match(
		settings,
		/activeCategoryId === 'import-export' &&\s*importExportAvailable/,
		'the page itself is drawn only on Desktop',
	);
	assert.match(
		settings,
		/activeCategoryId === 'import-export'\s*\?\s*undefined\s*:\s*renderServerSelector/,
		'the category spans every server, so the server selector is hidden',
	);
});
