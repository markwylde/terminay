import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const diagnosticsRoot = resolve('electron/diagnostics');
const releaseBuildRoot = resolve('dist-electron');

async function sourceFilesBelow(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) return sourceFilesBelow(path);
			return /\.[cm]?[jt]s$/u.test(entry.name) ? [path] : [];
		}),
	);
	return files.flat();
}

async function readSources(paths) {
	return Promise.all(
		paths.map(async (path) => ({
			path,
			source: await readFile(path, 'utf8'),
		})),
	);
}

async function releaseJavaScript() {
	const paths = await sourceFilesBelow(releaseBuildRoot);
	assert.ok(
		paths.length > 0,
		'the required Desktop release build contains no JavaScript',
	);
	return readSources(paths);
}

const diagnosticPaths = await sourceFilesBelow(diagnosticsRoot);
const diagnosticSources = await readSources(diagnosticPaths);
const productionSources = await readSources([
	resolve('electron/main.ts'),
	...diagnosticPaths,
]);

function combined(sources) {
	return sources
		.map(({ path, source }) => `\n/* ${path} */\n${source}`)
		.join('');
}

test('Desktop native crash collection is explicitly local-only', () => {
	const source = combined(productionSources);
	assert.match(
		source,
		/crashReporter\s*\.\s*start\s*\(\s*\{[\s\S]{0,2000}?uploadToServer\s*:\s*false/u,
		'Crashpad must be started with an inline uploadToServer: false configuration that can be audited in release source',
	);
	assert.doesNotMatch(
		source,
		/uploadToServer\s*:\s*true|setUploadToServer\s*\(|submitURL\s*:/u,
		'diagnostics must not enable crash upload or configure an upload destination',
	);
});

test('Desktop diagnostics introduce no logging dependency, endpoint, or network transport', async () => {
	const diagnostics = combined(diagnosticSources);
	const packageManifest = await readFile(resolve('package.json'), 'utf8');
	const packageLock = await readFile(resolve('package-lock.json'), 'utf8');

	assert.doesNotMatch(packageManifest, /["']electron-log["']\s*:/u);
	assert.doesNotMatch(
		packageLock,
		/["'](?:node_modules\/)?electron-log["']\s*:/u,
	);
	assert.doesNotMatch(
		diagnostics,
		/(?:from\s*|require\s*\(|import\s*\()\s*["'](?:node:)?(?:http|https|net|tls|dgram|ws|websocket|axios|undici)["']/u,
		'diagnostics modules must not import a network transport',
	);
	assert.doesNotMatch(
		diagnostics,
		/import\s*\{[^}]*\bnet\b[^}]*\}\s*from\s*["']electron["']/u,
		'diagnostics modules must not import Electron net',
	);
	assert.doesNotMatch(
		diagnostics,
		/\b(?:fetch|WebSocket)\s*\(|\bnet\s*\.\s*(?:fetch|request)\s*\(/u,
		'diagnostics modules must not send data through fetch, WebSocket, or Electron net',
	);
	assert.doesNotMatch(
		diagnostics,
		/["'`](?:https?|wss?):\/\//u,
		'diagnostics modules must not contain a diagnostics upload endpoint',
	);
});

test('always-on Desktop diagnostics do not enable raw Chromium or network logging', () => {
	const source = combined(productionSources);
	assert.doesNotMatch(
		source,
		/appendSwitch\s*\(\s*["'](?:enable-logging|log-file|log-net-log)["']/u,
		'always-on production code must not enable Chromium file or network logging switches',
	);
	assert.doesNotMatch(
		source,
		/appendArgument\s*\(\s*["']--(?:enable-logging|log-file|log-net-log)(?:=|["'])/u,
		'always-on production code must not append Chromium file or network logging arguments',
	);
	assert.doesNotMatch(
		source,
		/\bnetLog\s*\.\s*startLogging\s*\(/u,
		'always-on production code must not start Electron netLog capture',
	);
});

test('compiled Desktop diagnostics retain the local-only release contract', {
	skip: process.env.TERMINAY_REQUIRE_DESKTOP_DIAGNOSTICS_BUILD !== '1',
}, async () => {
	const artifacts = combined(await releaseJavaScript());

	assert.match(
		artifacts,
		/diagnostics\.launch\.started/u,
		'the release build must contain the Desktop diagnostics implementation',
	);
	assert.match(
		artifacts,
		/uploadToServer\s*:\s*(?:false|!1)/u,
		'the compiled Crashpad configuration must keep upload disabled',
	);
	assert.doesNotMatch(
		artifacts,
		/uploadToServer\s*:\s*(?:true|!0)|setUploadToServer\s*\(|submitURL\s*:/u,
		'the release artifact must not enable crash upload or contain an upload destination',
	);
	assert.doesNotMatch(
		artifacts,
		/["'`](?:https?|wss?):\/\/[^"'`\s]*(?:diagnostic|telemetry|crash|sentry|logs?)[^"'`\s]*/iu,
		'the release artifact must not contain a diagnostics, telemetry, crash, or logging endpoint',
	);
	assert.doesNotMatch(
		artifacts,
		/["']electron-log["']/u,
		'the release artifact must not contain electron-log',
	);
	assert.doesNotMatch(
		artifacts,
		/appendSwitch\s*\(\s*["'](?:enable-logging|log-file|log-net-log)["']|appendArgument\s*\(\s*["']--(?:enable-logging|log-file|log-net-log)(?:=|["'])|\bnetLog\s*\.\s*startLogging\s*\(/u,
		'the release artifact must not enable raw Chromium or network logging',
	);
});
