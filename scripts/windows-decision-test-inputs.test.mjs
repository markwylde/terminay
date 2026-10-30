import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

/**
 * Pull-request CI has no Windows runner (pull-request-ci, ADR-0081 §9), so the
 * only pre-merge Windows signal is a test that passes Windows inputs to an
 * injected-host decision. A test of such a decision that reads
 * `process.platform` would take its Windows branch only on Windows, which CI
 * never runs, and would pass without testing anything there.
 */

const ROOT = new URL('..', import.meta.url).pathname;
const SEARCHED = ['packages', 'apps', 'scripts', 'electron', 'src'];
const SKIPPED = new Set(['node_modules', 'dist', 'dist-electron', 'release', '.turbo']);

/** The decisions that differ on Windows and take their platform as input. */
export const WINDOWS_DECISIONS = [
	'sessionHolderAddress',
	'sessionHolderEnabled',
	'windowsPipeName',
	'resolveControlSocketPlacement',
	'placeControlSocket',
	'gitCommandSocketHostOptions',
	'canInstallInPlace',
	'selectWindowsForegroundProcess',
	'ShellProfileDiscovery',
];

/** Why a test source decides Windows inputs from the host, or null. */
export function hostDecidedWindowsInputs(source) {
	const decisions = WINDOWS_DECISIONS.filter((name) => source.includes(name));
	if (decisions.length === 0) return null;
	if (!/\bprocess\.platform\b/u.test(source)) return null;
	return `tests ${decisions.join(', ')} but reads process.platform`;
}

function testFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (SKIPPED.has(entry.name)) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...testFiles(path));
		else if (/\.test\.(mjs|js|ts|tsx)$/u.test(entry.name)) files.push(path);
	}
	return files;
}

test('a test of a Windows decision that reads the host platform is caught', () => {
	const offending = `
		import { sessionHolderAddress } from '../dist/index.js';
		test('pipe', () => {
			sessionHolderAddress({ dataRoot: 'C:\\\\x', generation: '0123456789abcdef', platform: process.platform });
		});
	`;
	assert.match(hostDecidedWindowsInputs(offending), /sessionHolderAddress/);
	assert.equal(
		hostDecidedWindowsInputs(offending.replace('process.platform', "'win32'")),
		null,
	);
	assert.equal(hostDecidedWindowsInputs('process.platform === "darwin"'), null);
});

test('no test of a Windows decision takes its platform from the host', () => {
	const offenders = [];
	for (const directory of SEARCHED)
		for (const file of testFiles(join(ROOT, directory))) {
			if (file === new URL(import.meta.url).pathname) continue;
			const reason = hostDecidedWindowsInputs(readFileSync(file, 'utf8'));
			if (reason !== null) offenders.push(`${relative(ROOT, file)}: ${reason}`);
		}
	assert.deepEqual(offenders, []);
});
