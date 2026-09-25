import assert from 'node:assert/strict';
import test from 'node:test';
import {
	actionKindsFor,
	combinationProblem,
	cronForPresetKind,
	describeRunOutcome,
	describeTrigger,
	emptyAutomationForm,
	formFromAutomation,
	formToDraft,
	groupSpaceTerminals,
	latestRuns,
	nextRunAt,
	overviewOutcome,
	presetForCron,
	previewSchedule,
	refusalMessage,
	selectAutomationServer,
} from '../src/workspace/automations/automationsModel.ts';

/**
 * The Automations section's rules, apart from React: which server it shows,
 * how triggers and outcomes read, and how the editor's form becomes a draft.
 */

const WITH = ['workspace.v1', 'automations.v1'];
const WITHOUT = ['workspace.v1'];

test('one server serving automations needs no selector', () => {
	const selection = selectAutomationServer(
		[{ serverId: 'local', label: 'Local', usable: true, capabilities: WITH }],
		undefined,
		'local',
	);
	assert.equal(selection.showsSelector, false);
	assert.equal(selection.selected?.serverId, 'local');
});

test('several servers serving automations offer a selector, defaulting to the working server', () => {
	const candidates = [
		{ serverId: 'local', label: 'Local', usable: true, capabilities: WITH },
		{ serverId: 'box', label: 'Build box', usable: true, capabilities: WITH },
		{ serverId: 'old', label: 'Old', usable: true, capabilities: WITHOUT },
		{ serverId: 'gone', label: 'Gone', usable: false, capabilities: WITH },
	];
	const byDefault = selectAutomationServer(candidates, undefined, 'box');
	assert.equal(byDefault.showsSelector, true);
	assert.deepEqual(
		byDefault.choices.map((choice) => choice.serverId),
		['local', 'box'],
	);
	assert.equal(byDefault.selected?.serverId, 'box');
	assert.deepEqual(
		byDefault.unsupported.map((choice) => choice.serverId),
		['old'],
	);
	// A person's choice wins; a choice that cannot serve automations does not.
	assert.equal(
		selectAutomationServer(candidates, 'local', 'box').selected?.serverId,
		'local',
	);
	assert.equal(
		selectAutomationServer(candidates, 'old', 'box').selected?.serverId,
		'box',
	);
	// Working in a server without automations falls back to one that has them.
	assert.equal(
		selectAutomationServer(candidates, undefined, 'old').selected?.serverId,
		'local',
	);
});

test('no server serving automations selects nothing and names why', () => {
	const selection = selectAutomationServer(
		[{ serverId: 'old', label: 'Old', usable: true, capabilities: WITHOUT }],
		undefined,
		'old',
	);
	assert.equal(selection.selected, undefined);
	assert.equal(selection.showsSelector, false);
	assert.deepEqual(selection.unsupported, [{ serverId: 'old', label: 'Old' }]);
});

test('triggers read in plain words', () => {
	assert.equal(
		describeTrigger({ kind: 'schedule', cron: '0 * * * *' }),
		'Every hour, on the hour',
	);
	assert.equal(
		describeTrigger({ kind: 'event', event: 'agent.needsInput' }),
		'When an agent needs input',
	);
	assert.equal(
		describeTrigger({ kind: 'schedule', cron: 'nonsense' }),
		'On schedule nonsense',
	);
});

test('the next run is the schedule’s next occurrence, only while enabled', () => {
	const now = Date.UTC(2026, 0, 5, 10, 17);
	const hourly = { enabled: true, trigger: { kind: 'schedule', cron: '0 * * * *' } };
	assert.equal(nextRunAt(hourly, now, 'UTC'), Date.UTC(2026, 0, 5, 11, 0));
	assert.equal(nextRunAt({ ...hourly, enabled: false }, now, 'UTC'), undefined);
	assert.equal(
		nextRunAt(
			{ enabled: true, trigger: { kind: 'event', event: 'agent.finished' } },
			now,
			'UTC',
		),
		undefined,
	);
});

test('the schedule preview describes and lists five runs, or names the invalid field', () => {
	const now = Date.UTC(2026, 0, 5, 10, 17);
	const preview = previewSchedule('0 * * * *', now, 'UTC');
	assert.equal(preview.ok, true);
	assert.equal(preview.description, 'Every hour, on the hour');
	assert.equal(preview.next.length, 5);
	assert.equal(preview.next[0], Date.UTC(2026, 0, 5, 11, 0));
	const refused = previewSchedule('61 * * * *', now, 'UTC');
	assert.equal(refused.ok, false);
	assert.match(refused.error, /minute/i);
	assert.equal(previewSchedule('   ', now, 'UTC').ok, false);
});

test('presets round-trip through their expressions', () => {
	assert.equal(presetForCron('0 * * * *').kind, 'hourly');
	assert.equal(presetForCron('30 9 * * 1-5').kind, 'weekdays');
	assert.equal(presetForCron('5 4 1 * *').kind, 'custom');
	// Switching kinds keeps the chosen time.
	assert.equal(
		cronForPresetKind('weekdays', { kind: 'daily', hour: 7, minute: 45 }),
		'45 7 * * 1-5',
	);
	assert.equal(cronForPresetKind('everyMinute', { kind: 'custom' }), '* * * * *');
});

test('subject actions are offered only for terminal-subject events', () => {
	assert.deepEqual(actionKindsFor({ kind: 'schedule', cron: '* * * * *' }), [
		'runCommand',
	]);
	assert.deepEqual(actionKindsFor({ kind: 'event', event: 'project.opened' }), [
		'runCommand',
	]);
	assert.deepEqual(actionKindsFor({ kind: 'event', event: 'terminal.idle' }), [
		'runCommand',
		'runMacro',
		'writeText',
	]);
	assert.equal(
		combinationProblem({ kind: 'schedule', cron: '* * * * *' }, 'writeText'),
		'Scheduled triggers have no subject terminal.',
	);
	assert.equal(
		combinationProblem({ kind: 'event', event: 'device.connected' }, 'runMacro'),
		'Device events have no subject terminal.',
	);
	assert.equal(
		combinationProblem({ kind: 'event', event: 'agent.finished' }, 'writeText'),
		undefined,
	);
});

test('run outcomes read as words with a tone', () => {
	assert.deepEqual(describeRunOutcome({ status: 'running' }), {
		label: 'Running',
		tone: 'running',
	});
	assert.deepEqual(
		describeRunOutcome({ status: 'finished', outcome: 'failed', exitCode: 2 }),
		{ label: 'Failed (exit 2)', tone: 'failure' },
	);
	assert.equal(
		describeRunOutcome({
			status: 'finished',
			outcome: 'skipped',
			skipReason: 'previousRunStillRunning',
		}).label,
		'Skipped: the previous run was still running',
	);
	assert.equal(overviewOutcome({ status: 'finished', outcome: 'succeeded' }), 'success');
	assert.equal(overviewOutcome({ status: 'finished', outcome: 'stopped' }), 'cancelled');
	assert.equal(overviewOutcome({ status: 'running' }), 'running');
});

function run(runId, automationId, startedAt, sessionId) {
	return {
		runId,
		automationId,
		triggerKind: 'schedule',
		firedAt: startedAt,
		startedBy: 'trigger',
		status: 'finished',
		outcome: 'succeeded',
		startedAt,
		suppressedEvents: 0,
		...(sessionId === undefined ? {} : { sessionId }),
	};
}

test('the latest run per automation is the most recently started', () => {
	const latest = latestRuns([
		run('r1', 'a', 10),
		run('r3', 'a', 30),
		run('r2', 'b', 20),
	]);
	assert.equal(latest.get('a')?.runId, 'r3');
	assert.equal(latest.get('b')?.runId, 'r2');
});

test('automation terminals group under their run, newest first, the rest together', () => {
	const terminals = [
		{ panelId: 'p1', sessionId: 's1', title: 'one', status: 'exited' },
		{ panelId: 'p2', sessionId: 's2', title: 'two', status: 'running' },
		{ panelId: 'p3', sessionId: 'mcp', title: 'agent', status: 'running' },
	];
	const groups = groupSpaceTerminals(terminals, [
		run('old', 'a', 10, 's1'),
		run('new', 'a', 20, 's2'),
	]);
	assert.deepEqual(
		groups.map((group) => group.run?.runId ?? 'other'),
		['new', 'old', 'other'],
	);
	assert.deepEqual(
		groups[2].terminals.map((terminal) => terminal.panelId),
		['p3'],
	);
});

test('terminals a run opened through MCP group under that run, even after its own terminal closed', () => {
	const terminals = [
		{ panelId: 'p-agent', sessionId: 'agent', title: 'agent', status: 'running' },
		{ panelId: 'p-sub', sessionId: 'sub', title: 'sub-agent', status: 'running' },
		{ panelId: 'p-kept', sessionId: 'kept', title: 'kept', status: 'exited' },
	];
	const groups = groupSpaceTerminals(terminals, [
		// The script's own terminal closed at exit; its opens remain.
		{ ...run('script', 'a', 10), openedSessions: ['agent', 'sub'] },
		run('other', 'b', 20, 'kept'),
	]);
	assert.deepEqual(
		groups.map((group) => [
			group.run?.runId ?? 'other',
			group.terminals.map((terminal) => terminal.sessionId),
		]),
		[
			['other', ['kept']],
			['script', ['agent', 'sub']],
		],
	);
});

test('next runs are computed in the server zone the server names', () => {
	const now = Date.UTC(2026, 0, 15, 12, 0);
	const automation = {
		enabled: true,
		trigger: { kind: 'schedule', cron: '0 9 * * *' },
	};
	// 09:00 in Tokyo (UTC+9) is 00:00 UTC; 09:00 UTC is nine hours later.
	assert.equal(nextRunAt(automation, now, 'Asia/Tokyo'), Date.UTC(2026, 0, 16, 0, 0));
	assert.equal(nextRunAt(automation, now, 'UTC'), Date.UTC(2026, 0, 16, 9, 0));
	const preview = previewSchedule('0 9 * * *', now, 'Asia/Tokyo');
	assert.equal(preview.ok, true);
	assert.equal(preview.next[0], Date.UTC(2026, 0, 16, 0, 0));
});

test('a saved automation becomes a form and back into the same draft', () => {
	const automation = {
		id: 'auto-1',
		name: 'Nightly',
		enabled: true,
		trigger: { kind: 'schedule', cron: '0 9 * * *' },
		action: {
			kind: 'runCommand',
			command: 'echo hi',
			cwd: '/tmp',
			maxDurationSeconds: 1800,
		},
		settings: { keepTerminalAfterRun: true, recordSession: false, cooldownSeconds: 60 },
		evaluatedThrough: 0,
	};
	const result = formToDraft(formFromAutomation(automation));
	assert.equal(result.ok, true);
	assert.deepEqual(result.draft, {
		id: 'auto-1',
		name: 'Nightly',
		enabled: true,
		trigger: { kind: 'schedule', cron: '0 9 * * *' },
		action: {
			kind: 'runCommand',
			command: 'echo hi',
			cwd: '/tmp',
			maxDurationSeconds: 1800,
		},
		settings: { keepTerminalAfterRun: true, recordSession: false, cooldownSeconds: 60 },
	});
	const copy = formFromAutomation(automation, true);
	assert.equal(copy.id, undefined);
	assert.equal(copy.name, 'Nightly copy');
});

test('the form refuses only what it cannot express; the server judges the rest', () => {
	const form = { ...emptyAutomationForm(), name: 'x', command: 'true' };
	assert.equal(formToDraft({ ...form, maxDurationMinutes: 'soon' }).ok, false);
	assert.equal(formToDraft({ ...form, cooldownSeconds: '-1' }).ok, false);
	// A scheduled text action is sent, so the server's refusal is what is read.
	const draft = formToDraft({ ...form, actionKind: 'writeText', text: 'continue' });
	assert.equal(draft.ok, true);
	assert.deepEqual(draft.draft.action, {
		kind: 'writeText',
		text: 'continue',
		submit: true,
	});
});

test('server refusals read as sentences', () => {
	assert.equal(
		refusalMessage(new Error('scheduled triggers have no subject terminal')),
		'Scheduled triggers have no subject terminal.',
	);
	assert.equal(
		refusalMessage(new Error('automation name must be 1-200 printable characters')),
		'Name must be 1-200 printable characters.',
	);
});
