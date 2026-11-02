import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AutomationRepository,
	AutomationTriggers,
	EventFanout,
	PROJECT_OPENED_EVENT,
} from '../dist/index.js';

function source() {
	const listeners = new Set();
	let subscriptions = 0;
	return {
		listeners,
		get subscriptions() {
			return subscriptions;
		},
		subscribe(listener) {
			subscriptions += 1;
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit(event) {
			for (const listener of listeners) listener(event);
		},
	};
}

const activityEvent = (sessionId, status, extra = {}) => ({
	type: 'activity.changed',
	sessionId,
	snapshot: { sessionId, status, attention: false, source: 'init', ...extra },
});

function setup(onError) {
	const agents = source();
	const activity = source();
	const eventJournal = source();
	const fanout = new EventFanout({
		serverId: 'server',
		agents,
		activity,
		eventJournal,
		describeTerminal: (sessionId) =>
			sessionId === 'unknown'
				? undefined
				: {
						projectId: 'project',
						title: sessionId,
						projectTitle: 'Project',
						sessionCreatedAt: 123,
					},
		now: () => 5_000,
		onError,
	});
	return { fanout, agents, activity, eventJournal };
}

function collect(fanout, id, accepts = () => true) {
	const events = [];
	const unregister = fanout.registerSource(id, {
		accepts,
		onEvent: (trigger, firedAt) => {
			events.push({ ...trigger, firedAt });
		},
	});
	return { events, unregister };
}

test('sources share one subscription to each canonical stream, with independent registration and teardown', () => {
	const { fanout, agents, activity, eventJournal } = setup();
	const first = collect(fanout, 'first');
	const second = collect(
		fanout,
		'second',
		(event) => event === 'terminal.idle',
	);
	assert.throws(() => collect(fanout, 'second'), /already registered/);
	fanout.start();
	fanout.start();
	for (const upstream of [agents, activity, eventJournal])
		assert.equal(upstream.subscriptions, 1);
	activity.emit(activityEvent('terminal', 'working'));
	activity.emit(
		activityEvent('terminal', 'idle', {
			source: 'structured:command',
			exitCode: 7,
			output: 'secret-output',
			token: 'secret-token',
		}),
	);
	activity.emit(activityEvent('terminal', 'idle'));
	assert.deepEqual(
		first.events.map(({ event }) => event),
		['terminal.commandFinished', 'terminal.idle'],
	);
	assert.deepEqual(second.events, [
		{
			event: 'terminal.idle',
			firedAt: 5_000,
			subject: {
				kind: 'terminal',
				serverId: 'server',
				projectId: 'project',
				sessionId: 'terminal',
				sessionCreatedAt: 123,
				title: 'terminal',
				projectTitle: 'Project',
			},
		},
	]);
	assert.deepEqual(first.events[0].context, { exitCode: 7 });
	first.unregister();
	first.unregister();
	activity.emit(activityEvent('terminal', 'working'));
	activity.emit(activityEvent('terminal', 'idle'));
	assert.equal(first.events.length, 2);
	assert.equal(second.events.length, 2);
	fanout.stop();
	for (const upstream of [agents, activity, eventJournal])
		assert.equal(upstream.listeners.size, 0);
	assert.throws(() => collect(fanout, 'late'), /stopped/);
});

test('automation execution and a second consumer receive the same event once; stopping automations leaves fan-out alive', async () => {
	const { fanout, activity } = setup();
	const repository = new AutomationRepository({
		async load() {},
		async commit() {},
		async backup() {},
	});
	await repository.load();
	await repository.upsert({
		id: 'idle',
		name: 'Idle',
		trigger: { kind: 'event', event: 'terminal.idle' },
		action: { kind: 'runCommand', command: 'true' },
	});
	const requests = [];
	const automation = new AutomationTriggers({
		serverId: 'server',
		repository,
		fanout,
		controller: () => ({
			async start(request) {
				requests.push(request);
				return {};
			},
		}),
	});
	await automation.start();
	const other = collect(fanout, 'other');
	activity.emit(activityEvent('terminal', 'working'));
	activity.emit(activityEvent('terminal', 'idle'));
	assert.equal(requests.length, 1);
	assert.equal(other.events.length, 1);
	assert.equal(requests[0].firedAt, other.events[0].firedAt);
	assert.deepEqual(requests[0].subject, other.events[0].subject);
	automation.stop();
	activity.emit(activityEvent('terminal', 'working'));
	activity.emit(activityEvent('terminal', 'idle'));
	assert.equal(requests.length, 1);
	assert.equal(other.events.length, 2);
	fanout.stop();
});

test('consumer predicates are evaluated at event time and run terminals are excluded before every consumer', () => {
	const { fanout, activity, agents } = setup();
	let enabled = false;
	const consumer = collect(fanout, 'consumer', () => enabled);
	fanout.start();
	activity.emit(activityEvent('terminal', 'working'));
	activity.emit(activityEvent('terminal', 'idle'));
	assert.equal(consumer.events.length, 0);
	enabled = true;
	fanout.markRunTerminal('terminal');
	activity.emit(activityEvent('terminal', 'working'));
	activity.emit(
		activityEvent('terminal', 'idle', {
			attention: true,
			source: 'structured:command',
			exitCode: 0,
		}),
	);
	const agent = (state) => ({
		entries: {
			a: {
				entryId: 'a',
				kind: 'root',
				terminalSessionId: 'terminal',
				activationTerminalSessionId: 'terminal',
				state,
				provider: 'provider',
				harness: 'agent',
			},
		},
	});
	agents.emit(agent('working'));
	agents.emit(agent('waiting'));
	assert.equal(consumer.events.length, 0);
	fanout.unmarkRunTerminal('terminal');
	agents.emit(agent('waiting'));
	assert.equal(consumer.events.length, 0);
	agents.emit(agent('working'));
	agents.emit(agent('waiting'));
	assert.deepEqual(
		consumer.events.map(({ event }) => event),
		['agent.needsInput'],
	);
	activity.emit({ type: 'activity.removed', sessionId: 'terminal' });
	activity.emit(activityEvent('terminal', 'idle', { attention: true }));
	assert.equal(consumer.events.length, 1); // first snapshot seeds state
	fanout.stop();
});

test('failure of a consumer or error reporter cannot prevent delivery to others', async () => {
	const { fanout, eventJournal } = setup(() => {
		throw new Error('reporter failed');
	});
	fanout.registerSource('bad predicate', {
		accepts() {
			throw new Error('predicate');
		},
		onEvent() {},
	});
	fanout.registerSource('bad sync', {
		accepts: () => true,
		onEvent() {
			throw new Error('sync');
		},
	});
	fanout.registerSource('bad async', {
		accepts: () => true,
		async onEvent() {
			throw new Error('async');
		},
	});
	const good = collect(fanout, 'good');
	fanout.start();
	eventJournal.emit({
		event: PROJECT_OPENED_EVENT,
		payload: { serverId: 'another-server', projectId: 'other' },
	});
	eventJournal.emit({
		event: PROJECT_OPENED_EVENT,
		payload: {
			serverId: 'server',
			projectId: 'project',
			name: 'Project',
			token: 'secret',
		},
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(good.events, [
		{
			event: 'project.opened',
			subject: { kind: 'project', projectId: 'project', title: 'Project' },
			firedAt: 5_000,
		},
	]);
	fanout.stop();
});
