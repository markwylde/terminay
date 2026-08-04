import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getOrCreateDirectoryLoad } from '../src/workspace/directoryLoadCoordinator.ts';

const controller = await readFile(
	new URL('../src/workspace/useFileExplorerController.ts', import.meta.url),
	'utf8',
);

test('folder expansion shares one in-flight request and preserves cached children', () => {
	assert.match(
		controller,
		/directoryLoadsRef = useRef<Map<string, Promise<void>>>\(new Map\(\)\)/,
	);
	assert.match(
		controller,
		/return getOrCreateDirectoryLoad\(\s*directoryLoadsRef\.current,\s*dirPath,/,
	);
	assert.match(
		controller,
		/setExpandedPaths\(\(current\) => \(\{ \.\.\.current, \[path\]: !current\[path\] \}\)\)/,
	);
	assert.match(
		controller,
		/if \(!\(path in directoryChildren\)\) void loadDirectory\(path\)/,
	);
});

test('file explorer watches fail closed without global terminal errors', () => {
	assert.doesNotMatch(controller, /WATCH_RECONCILIATION_INTERVAL_MS/);
	assert.doesNotMatch(controller, /setInterval\(\(\) => \{[\s\S]*loadDirectory/);
	assert.match(controller, /const expandedWatchPaths = useMemo\(/);
	assert.match(
		controller,
		/getWatchResourcePath\(path, project\.rootFolder\)/,
	);
	assert.doesNotMatch(controller, /Failed to watch files:/);
	assert.match(
		controller,
		/catch\s*\{\s*if \(!disposed\) scheduleDirectoryRefresh\(path\);/s,
	);
});

test('concurrent expansion renders issue one request and a settled refresh issues one more', async () => {
	const loads = new Map();
	let requestCount = 0;
	let resolve;
	const create = () => {
		requestCount += 1;
		return new Promise((done) => {
			resolve = done;
		});
	};

	const first = getOrCreateDirectoryLoad(loads, '/project/src', create);
	const rerender = getOrCreateDirectoryLoad(loads, '/project/src', create);
	const repeatedExpansion = getOrCreateDirectoryLoad(
		loads,
		'/project/src',
		create,
	);
	assert.equal(first, rerender);
	assert.equal(first, repeatedExpansion);
	assert.equal(requestCount, 1);

	resolve();
	await first;
	await Promise.resolve();
	await getOrCreateDirectoryLoad(loads, '/project/src', async () => {
		requestCount += 1;
	});
	assert.equal(requestCount, 2);
});
