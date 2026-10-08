import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(
	join(tmpdir(), 'terminay-diagnostics-session-holder-'),
);
const output = join(directory, 'session-holder-observation.mjs');
await build({
	bundle: true,
	stdin: {
		contents: `
      export { createSessionHolderDiagnostics } from './electron/diagnostics/sessionHolderObservation.ts'
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
	createSessionHolderDiagnostics,
	DIAGNOSTIC_EVENT_NAMES,
	encodeDiagnosticEvent,
	normalizeDiagnosticEvent,
} = await import(pathToFileURL(output).href);

test.after(() => rm(directory, { force: true, recursive: true }));

const holder = { pid: 4242, startedAt: 1_791_449_383_524 };
const other = { pid: 5151, startedAt: 1_791_452_710_855 };
const closed = {
	kind: 'closed',
	holder,
	late: false,
	reason: 'limit',
	closedAt: 1_791_453_808_000,
	liveSessions: 3,
	endedSessions: 0,
	attached: false,
	draining: true,
	limitMs: 300_000,
	attachCount: 2,
	sinceAttachMs: 1_650_000,
	sinceDetachMs: 300_000,
};
/** Every report kind, with the severity it must be recorded at. */
const REPORTS = [
	[
		{
			kind: 'attached',
			holder,
			buildId: '5.14.0:1791452158106',
			sameBuild: false,
			draining: false,
			liveSessions: 3,
			endedSessions: 1,
			limitMs: 300_000,
		},
		'info',
	],
	[{ kind: 'record-removed', holder }, 'info'],
	[{ kind: 'incompatible', holder, signal: 'SIGTERM' }, 'warning'],
	[{ kind: 'unreachable', holder, reason: 'busy' }, 'warning'],
	[{ kind: 'launched', holder: other, durationMs: 180, limitMs: null }, 'info'],
	[{ kind: 'launch-failed', durationMs: 10_000, error: 'session holder did not start' }, 'warning'],
	[{ kind: 'drained', holder, cause: 'build-mismatch' }, 'info'],
	[{ kind: 'limit-set', limitMs: 300_000, holders: 2 }, 'info'],
	[{ kind: 'connection-closed', holder, requested: true, announced: false, liveSessions: 3 }, 'info'],
	[{ kind: 'connection-closed', holder, requested: false, announced: false, liveSessions: 3 }, 'warning'],
	[{ kind: 'connection-closed', holder, requested: false, announced: true, liveSessions: 3 }, 'warning'],
	[closed, 'warning'],
	[{ ...closed, late: true }, 'warning'],
	[{ ...closed, reason: 'signal', signal: 'SIGTERM', attached: true }, 'warning'],
	[{ ...closed, reason: 'crash', error: 'TypeError: x\n    at /app/holder.js:1:1' }, 'warning'],
	[{ ...closed, reason: 'end-all', attached: true }, 'info'],
	[{ ...closed, reason: 'empty', liveSessions: 0 }, 'info'],
	[{ ...closed, reason: 'first-attach-timeout', liveSessions: 0 }, 'info'],
	[
		{ kind: 'session-ended', holder, session: 7, exitCode: 1, signal: 1, requested: false, endedUnattached: false },
		'info',
	],
];

test('every session-holder report becomes one parseable, named diagnostic line', () => {
	const event = createSessionHolderDiagnostics();
	const kinds = new Set();
	for (const [report, severity] of REPORTS) {
		kinds.add(report.kind);
		const input = event(report);
		assert.equal(input.component, 'local-server');
		assert.equal(input.source, 'local-server-session-holder');
		assert.equal(input.severity, severity, `${report.kind} ${report.reason ?? ''}`);
		assert.equal(input.event, `local-server.session-holder.${report.kind}`);
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
		for (const [key, value] of Object.entries(report)) {
			if (key === 'kind' || key === 'holder' || key === 'session') continue;
			assert.deepEqual(parsed.fields[key], value, `${report.kind}.${key}`);
		}
	}
	// Nothing declared is left without a report, and nothing reported undeclared.
	assert.deepEqual(
		[...kinds].map((kind) => `local-server.session-holder.${kind}`).sort(),
		DIAGNOSTIC_EVENT_NAMES.filter((name) => name.startsWith('local-server.session-holder.')).sort(),
	);
});

test('a holder keeps one diagnostic id within a launch, beside its process id and start time', () => {
	const event = createSessionHolderDiagnostics();
	const fields = REPORTS.map(([report]) => event(report).fields);
	const forHolder = fields.filter((entry) => entry.holderPid === holder.pid);
	assert.ok(forHolder.length > 10);
	assert.deepEqual(new Set(forHolder.map((entry) => entry.holder)), new Set(['h1']));
	assert.deepEqual(new Set(forHolder.map((entry) => entry.holderStartedAt)), new Set([holder.startedAt]));
	assert.equal(fields.find((entry) => entry.holderPid === other.pid).holder, 'h2');
	// A report about no particular holder names none.
	assert.equal('holder' in event({ kind: 'limit-set', limitMs: null, holders: 0 }).fields, false);
	// A second launch numbers its own.
	assert.equal(createSessionHolderDiagnostics()({ kind: 'record-removed', holder: other }).fields.holder, 'h1');
});

test('a session is named by a process-local id, and no record field can carry an authority-bearing one', () => {
	const event = createSessionHolderDiagnostics();
	const ended = event(REPORTS.at(-1)[0]).fields;
	assert.equal(ended.session, 's7');
	const allowed = new Set([
		'attachCount', 'attached', 'announced', 'buildId', 'cause', 'closedAt', 'draining', 'durationMs',
		'endedSessions', 'endedUnattached', 'error', 'exitCode', 'holder', 'holderPid', 'holderStartedAt',
		'holders', 'late', 'limitMs', 'liveSessions', 'reason', 'requested', 'sameBuild', 'session',
		'signal', 'sinceAttachMs', 'sinceDetachMs',
	]);
	for (const [report] of REPORTS)
		for (const key of Object.keys(event(report).fields))
			assert.ok(allowed.has(key), `${report.kind} records an unexpected field: ${key}`);
});

test('the embedded server routes holder reports to diagnostics, and the standalone server to its own log', async () => {
	const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
	const authority = await read('electron/serverTerminalAuthority.ts');
	const main = await read('electron/main.ts');
	const cli = await read('apps/terminay-server/src/cli.ts');
	const sources = await Promise.all(
		['factory', 'holder', 'client', 'closeRecord', 'observation', 'process'].map((name) =>
			read(`packages/server-core/src/sessionHolder/${name}.ts`),
		),
	);

	assert.match(
		authority,
		/createSessionHolderPtyFactory\(\{[\s\S]*?onObservation: \(report\) =>\s*options\.onSessionHolderObservation\?\.\(report\),/u,
	);
	// Low-volume lifecycle evidence must not be starved by a console flood.
	assert.match(
		main,
		/onSessionHolderObservation: \(report\) => \{\s*void desktopDiagnostics\.record\(sessionHolderDiagnosticEvent\(report\), \{\s*channel: 'lifecycle',\s*\}\);/u,
	);
	assert.match(
		cli,
		/sessionHolder: createSessionHolderPtyFactory\(\{[\s\S]*?onObservation: logSessionHolderObservation,/u,
	);
	assert.match(cli, /`\[terminay-server\] session holder \$\{JSON\.stringify\(report\)\}\\n`/u);
	// server-core owns no log sink, and nothing here watches or polls for a
	// close record: it is read when a server starts and never otherwise.
	for (const source of sources) {
		assert.doesNotMatch(source, /console\.|process\.std(out|err)|appendFile/u);
		assert.doesNotMatch(source, /setInterval/u);
	}
});
