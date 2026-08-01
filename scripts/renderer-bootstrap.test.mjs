import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../src/main.tsx', import.meta.url),
	'utf8',
);
const rendererAppSource = await readFile(
	new URL('../src/rendererApp.tsx', import.meta.url),
	'utf8',
);
const rendererRuntimeSource = await readFile(
	new URL('../src/rendererRuntime.tsx', import.meta.url),
	'utf8',
);
const globalCss = await readFile(
	new URL('../src/index.css', import.meta.url),
	'utf8',
);

test('renderer bootstrap has no static imports and paints before loading React', () => {
	assert.doesNotMatch(source, /^\s*import(?:\s|\{|\*)/m);
	assert.match(source, /renderStatus\('Loading Terminay…'\)/);
	assert.match(source, /void import\('\.\/rendererApp\.tsx'\)/);
	assert.match(source, /const BOOT_TIMEOUT_MS = 15_000/);
});

test('renderer bootstrap loading shell uses the local logo and color scheme', () => {
	assert.match(source, /const AUXILIARY_VIEWS = new Set\(\[/);
	assert.match(
		source,
		/if \(isAuxiliaryView\) \{[\s\S]*installBootstrapStyle\(\)/,
	);
	assert.match(source, /const TERMINAY_LOGO_PATH = '\/terminay\.svg'/);
	assert.match(source, /logo\.src = TERMINAY_LOGO_PATH/);
	assert.match(source, /color-scheme: light dark/);
	assert.match(source, /prefers-color-scheme: dark/);
	assert.match(source, /place-items: center/);
	assert.match(
		rendererAppSource,
		/<BootstrapStatusShell message="Loading Terminay…" \/>/,
	);
	assert.match(rendererAppSource, /if \(isAuxiliaryView\) return null/);
	assert.match(rendererAppSource, /src=\{TERMINAY_LOGO_PATH\}/);
	assert.match(globalCss, /color-scheme: light dark/);
	assert.match(globalCss, /prefers-color-scheme: dark/);
	assert.match(globalCss, /terminay-server-connecting__logo/);
	assert.match(globalCss, /terminay-server-connecting--silent/);
	assert.doesNotMatch(rendererRuntimeSource, /Loading server settings…/);
	assert.doesNotMatch(rendererRuntimeSource, /Loading server macros…/);
	assert.doesNotMatch(rendererRuntimeSource, /Loading server recordings…/);
});

test('renderer bootstrap reports only fixed fail-closed errors', () => {
	assert.match(source, /\.catch\(\(\) =>/);
	assert.match(source, /textContent = message/);
	assert.doesNotMatch(
		source,
		/innerHTML|eval\(|String\(error\)|error\.message/,
	);
	assert.match(source, /Terminay renderer modules could not be loaded\./);
	assert.match(
		source,
		/Terminay renderer modules did not become ready in time\./,
	);
});

test('desktop bootstrap CSS has no external network dependency', () => {
	assert.doesNotMatch(globalCss, /@import|https?:\/\//);
	assert.match(globalCss, /["']Segoe UI["'].*Roboto.*Arial/);
});
