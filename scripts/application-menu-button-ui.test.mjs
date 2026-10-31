import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.app-menu-ui-test-'));
const outputPath = join(testDirectory, 'application-menu-button.cjs');
await build({
	entryPoints: ['src/workspace/ApplicationMenuButton.tsx'],
	outfile: outputPath,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react'],
	logLevel: 'silent',
});
const { ApplicationMenuButton } = require(outputPath);

test.after(() => rm(testDirectory, { force: true, recursive: true }));

test('the menu button names itself and says it opens a menu', () => {
	const markup = renderToStaticMarkup(
		React.createElement(ApplicationMenuButton, {
			openApplicationMenu: async () => true,
		}),
	);
	assert.match(markup, /aria-label="Application menu"/u);
	assert.match(markup, /aria-haspopup="menu"/u);
	assert.match(markup, /class="project-tab-app-menu"/u);
});

test('the workspace draws the button only for a host that opens its menu', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const host = await readFile(
		'src/web/ConnectedWebRendererWorkspace.tsx',
		'utf8',
	);
	assert.match(
		app,
		/hostPresentation\?\.openApplicationMenu === undefined \? null : \(\s*<ApplicationMenuButton/u,
	);
	// Offered only where Desktop draws the title bar itself: Windows.
	assert.match(
		host,
		/hasNativeMenus && nativeTitlebarKindValue === 'overlay'\s*\?\s*\{ openApplicationMenu \}/u,
	);
});
