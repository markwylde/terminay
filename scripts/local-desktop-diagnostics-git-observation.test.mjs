import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(
	join(tmpdir(), 'terminay-diagnostics-git-observation-'),
);
const output = join(directory, 'git-observation.mjs');
await build({
	bundle: true,
	stdin: {
		contents: `
      export { gitObservationDiagnosticEvent } from './electron/diagnostics/gitObservation.ts'
      export {
        DIAGNOSTIC_EVENT_NAMES,
        encodeDiagnosticEvent,
        normalizeDiagnosticEvent,
      } from './electron/diagnostics/core.ts'
    `,
		loader: 'ts',
		resolveDir: process.cwd(),
	},
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
});
const {
	DIAGNOSTIC_EVENT_NAMES,
	encodeDiagnosticEvent,
	gitObservationDiagnosticEvent,
	normalizeDiagnosticEvent,
} = await import(pathToFileURL(output).href);

test.after(() => rm(directory, { force: true, recursive: true }));

const changes = {
	byClass: { 'default-branch-ref': 1, lock: 2 },
	byScope: { all: 1, ignore: 2 },
	cachedListingsServed: 3,
};
const measurement = {
	repository: 'r1',
	raisedBy: 'watch',
	claim: 'all',
	trusted: true,
	durationMs: 42,
};
const error = { code: 'ENOSPC', message: 'watch limit' };
const REPORTS = [
	[{ kind: 'watch.opened', repository: 'r1', watch: 'git-directory', recursive: true }, 'info'],
	[{ kind: 'watch.closed', repository: null, watch: 'discovery', recursive: false }, 'info'],
	[{ kind: 'watch.failed', repository: 'r1', watch: 'working-tree', recursive: true, error }, 'warning'],
	[{ kind: 'changes', repository: 'r1', changes }, 'info'],
	[
		{
			...measurement,
			kind: 'measurement.completed',
			remeasured: 2,
			carried: 0,
			worktrees: [
				{ id: 'w1', role: 'main', listIndex: 0, ahead: 0, additions: 0, deletions: 0, changedFiles: 0 },
				{ id: 'w2', role: 'linked', listIndex: 1, ahead: 3, additions: 11000, deletions: 254, changedFiles: 0 },
			],
			cached: true,
			published: 1,
			suppressed: 1,
			changes,
		},
		'info',
	],
	[{ ...measurement, kind: 'measurement.failed', restored: true, error }, 'warning'],
	[{ ...measurement, kind: 'measurement.abandoned', restored: true, error }, 'info'],
	[
		{
			kind: 'cache.mismatch',
			repository: 'r1',
			worktrees: [{ id: 'w2', role: 'linked', listIndex: 1, fields: ['ahead', 'lineAdditions'] }],
		},
		'warning',
	],
];

test('every Git observation report becomes one parseable, named diagnostic line', () => {
	for (const [report, severity] of REPORTS) {
		const input = gitObservationDiagnosticEvent(report);
		assert.equal(input.component, 'local-server');
		assert.equal(input.source, 'local-server-git');
		assert.equal(input.severity, severity, report.kind);
		assert.equal(input.event, `local-server.git.${report.kind}`);
		assert.ok(
			DIAGNOSTIC_EVENT_NAMES.includes(input.event),
			`${input.event} is not a declared diagnostic event`,
		);

		const line = encodeDiagnosticEvent(normalizeDiagnosticEvent(input, 'launch'));
		assert.equal(line.endsWith('\n'), true);
		assert.equal(line.trimEnd().includes('\n'), false, 'one report is one line');
		const parsed = JSON.parse(line);
		assert.equal(parsed.event, input.event);
		assert.equal(parsed.severity, severity);
		const { kind: _kind, ...fields } = report;
		assert.deepEqual(parsed.fields, fields, report.kind);
	}
});

test('the embedded server routes Git observation to diagnostics, and the standalone server to its own log', async () => {
	const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
	const authority = await read('electron/serverTerminalAuthority.ts');
	const main = await read('electron/main.ts');
	const cli = await read('apps/terminay-server/src/cli.ts');
	const service = await read('packages/server-core/src/gitService/service.ts');

	assert.match(
		authority,
		/this\.git = new GitService\(\{[\s\S]*?onObservation: \(report\) => options\.onGitObservation\?\.\(report\),\s*\}\);/u,
	);
	// Low-volume lifecycle evidence must not be starved by a console flood.
	assert.match(
		main,
		/onGitObservation: \(report\) => \{\s*void desktopDiagnostics\.record\(gitObservationDiagnosticEvent\(report\), \{\s*channel: 'lifecycle',\s*\}\);/u,
	);
	assert.match(
		cli,
		/const gitService = new GitService\(\{[\s\S]*?onObservation: \(report\) => \{\s*process\.stderr\.write\(\s*`\[terminay-server\] git observation \$\{JSON\.stringify\(report\)\}\\n`,/u,
	);
	// The service itself writes nothing: no console, no file, no stderr.
	assert.doesNotMatch(service, /console\.|process\.std(out|err)|appendFile|writeFile/u);
});
