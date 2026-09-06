import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension from '../dist/index.js';
import { createGrokRecordMapper } from '../dist/provider.js';
import { subagentRecordFrom } from '../dist/subagents.js';

const sessionId = '01a0760d-1be1-78a3-bb81-13bd11557257';

/** Collects what the mapping publishes for a bound Grok root. */
function collect(records) {
	const events = [];
	const publish = new Proxy(
		{},
		{
			get: (_target, kind) => (event) => {
				events.push({ kind, ...event });
			},
		},
	);
	const context = {
		publish,
		binding: { providerSessionId: sessionId },
		journal: { role: 'root' },
	};
	const map = createGrokRecordMapper();
	for (const record of records) map(record, context);
	return events;
}

const turnStarted = {
	type: 'turn_started',
	session_id: sessionId,
	session_relationship: 'primary',
	model_id: 'grok-4',
};

/**
 * Captured from a real `grok --always-approve -p` run that spawned two
 * subagents: `meta.json` appears with status running and is rewritten to
 * completed, so children finish independently.
 */
const META_RUNNING = {
	subagent_id: '01a076d9-3575-7780-8725-79906444cb49',
	parent_session_id: sessionId,
	child_session_id: '01a076d9-3575-7780-8725-79906444cb49',
	subagent_type: 'general-purpose',
	description: 'Compute 17 times 19',
	prompt: 'Compute 17 times 19. Reply with only the resulting number.',
	status: 'running',
	started_at: '2026-09-06T13:11:29.862137Z',
	child_cwd: '/private/tmp/grok-subagent-probe',
	effective_model_id: 'grok-4.6',
};
const META_COMPLETED = {
	...META_RUNNING,
	status: 'completed',
	completed_at: '2026-09-06T13:11:32.433288Z',
	duration_ms: 2604,
};

const record = (meta) => subagentRecordFrom(meta);

test('a subagent is enumerated from its own meta.json and carries its own state', () => {
	const events = collect([
		turnStarted,
		record(META_RUNNING),
		record(META_COMPLETED),
	]);
	const started = events.find((event) => event.kind === 'subagentStarted');
	assert.equal(started.subagentId, META_RUNNING.subagent_id);
	assert.equal(started.title, 'Compute 17 times 19');
	assert.equal(started.parentAgentId, sessionId);
	const done = events.find((event) => event.kind === 'subagentDone');
	assert.equal(done.subagentId, META_RUNNING.subagent_id);
	assert.equal(done.outcome, 'success');
});

test('a child prompt and output are never projected', () => {
	const events = collect([turnStarted, record(META_RUNNING)]);
	assert.equal(JSON.stringify(events).includes('Reply with only'), false);
});

test('a repeated running record does not restart the child', () => {
	const events = collect([
		turnStarted,
		record(META_RUNNING),
		record(META_RUNNING),
	]);
	assert.equal(
		events.filter((event) => event.kind === 'subagentStarted').length,
		1,
	);
});

test('children complete independently and never complete their root', () => {
	const second = {
		...META_RUNNING,
		subagent_id: '01a076d9-0000-0000-0000-000000000002',
		child_session_id: '01a076d9-0000-0000-0000-000000000002',
		description: 'Sum 1 through 100',
	};
	const events = collect([
		turnStarted,
		record(META_RUNNING),
		record(second),
		record(META_COMPLETED),
	]);
	assert.deepEqual(
		events
			.filter((event) => event.kind === 'subagentDone')
			.map((event) => event.subagentId),
		[META_RUNNING.subagent_id],
	);
	assert.equal(
		events.some((event) => event.kind === 'done'),
		false,
		'the root stays working while a sibling runs',
	);
});

test('a child declaring another parent is never attached', () => {
	const events = collect([
		turnStarted,
		record({ ...META_RUNNING, parent_session_id: 'some-other-session' }),
	]);
	assert.equal(
		events.some((event) => event.kind === 'subagentStarted'),
		false,
	);
});

test('a meta.json without identity is ignored', () => {
	assert.equal(subagentRecordFrom({ description: 'no ids' }), undefined);
	assert.equal(subagentRecordFrom(null), undefined);
	assert.equal(subagentRecordFrom([1, 2]), undefined);
});

test('an interrupted child completes with a non-success outcome', () => {
	const events = collect([
		turnStarted,
		record(META_RUNNING),
		record({ ...META_RUNNING, status: 'cancelled' }),
	]);
	assert.equal(events.at(-1).outcome, 'cancelled');
});

test('Grok records no fault distinct from a turn outcome, so nothing is blocked', () => {
	// Verified against every rollout on this machine: the only event types Grok
	// writes are first_token, loop_started, mcp_*, permission_requested,
	// permission_resolved, phase_changed, tool_started, tool_completed,
	// turn_started, turn_ended and yolo_toggled. There is no fault record, so a
	// failed turn is a completion outcome and never a blocked state.
	const events = collect([
		turnStarted,
		{ type: 'turn_ended', outcome: 'error' },
	]);
	assert.equal(
		events.some((event) => event.kind === 'waitStarted'),
		false,
	);
	assert.equal(events.at(-1).kind, 'done');
	assert.equal(events.at(-1).outcome, 'error');
});

test('an explicit permission request stays explicit, not inferred', () => {
	const events = collect([
		turnStarted,
		{ type: 'permission_requested', tool_name: 'run_terminal_command' },
	]);
	const wait = events.at(-1);
	assert.equal(wait.state, 'waiting');
	assert.equal(
		wait.inferred,
		undefined,
		'Grok records permission requests explicitly',
	);
});

/**
 * Recorded Grok 1.0.13 run: the CLI created `<session>/subagents/` about twelve
 * seconds after it created `events.jsonl`, so that directory does not exist
 * while the root binds. `subagentsAppearLate` reproduces exactly that ordering
 * by resolving nothing for the `subagents` path, as the real filesystem did.
 */
const RECORDED_SESSION = '01a07725-52c0-7d60-a13b-1ef9edc8bd7f';
const RECORDED_DIRECTORY = `/home/test/.grok/sessions/%2Fprivate%2Fvar%2Ffolders%2Fgw%2Fn_lr8lp97k93jpcv2qg_1mpw0000gn%2FT%2Fterminay-conformance-rvnAd5/${RECORDED_SESSION}`;

async function recordedSessionFiles() {
	const base = new URL('../fixtures/v0.1/three-subagents/', import.meta.url);
	const events = (await readFile(new URL('events.jsonl', base), 'utf8'))
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	const files = { [`${RECORDED_DIRECTORY}/events.jsonl`]: events };
	const children = await readdir(new URL('subagents/', base));
	for (const child of children.sort()) {
		files[`${RECORDED_DIRECTORY}/subagents/${child}/meta.json`] = [
			JSON.parse(
				await readFile(new URL(`subagents/${child}/meta.json`, base), 'utf8'),
			),
		];
	}
	return files;
}

function subagentsAppearLate(terminal) {
	const files = {
		...terminal.observation.files,
		async resolveHomeDirectory(relativePath, request) {
			// `<session>/subagents` does not exist while the root is binding; only
			// the session directory that already holds events.jsonl does.
			if (relativePath.replace(/\/$/, '').endsWith('/subagents'))
				return undefined;
			return terminal.observation.files.resolveHomeDirectory(
				relativePath,
				request,
			);
		},
	};
	return {
		...terminal,
		observation: { ...terminal.observation, files },
	};
}

test('children created after the root binds are still enumerated', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			subagentsAppearLate(
				fixtureTerminal({
					foregroundExecutable: 'grok',
					files: await recordedSessionFiles(),
					openFilePaths: [`${RECORDED_DIRECTORY}/events.jsonl`],
				}),
			),
		);
		const events = harness.events();
		assert.deepEqual(
			events
				.filter((event) => event.kind === 'subagent.started')
				.map((event) => event.title)
				.sort(),
			['Compute 17 times 19', 'Compute 2 to the 12', 'Sum numbers 1 to 100'],
		);
		assert.deepEqual(
			events
				.filter((event) => event.kind === 'subagent.started')
				.map((event) => event.parentAgentId),
			[RECORDED_SESSION, RECORDED_SESSION, RECORDED_SESSION],
		);
		assert.deepEqual(
			events
				.filter((event) => event.kind === 'subagent.done')
				.map((event) => event.outcome),
			['success', 'success', 'success'],
		);
		assert.deepEqual(
			events
				.filter((event) => event.kind === 'subagent.done')
				.map((event) => event.subagentId)
				.sort(),
			events
				.filter((event) => event.kind === 'subagent.started')
				.map((event) => event.subagentId)
				.sort(),
		);
		assert.equal(JSON.stringify(events).includes('prompt'), false);
	} finally {
		await harness.dispose();
	}
});
