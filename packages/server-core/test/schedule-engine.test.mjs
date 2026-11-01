import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AutomationRepository,
	AutomationRunLog,
	AutomationScheduler,
	MIN_SCHEDULE_INTERVAL_MS,
	ScheduleEngine,
} from '../dist/index.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = Date.parse;

function fakeClock(start) {
	let now = start;
	let sequence = 0;
	const timers = new Map();
	return {
		timers,
		get now() {
			return now;
		},
		clock: {
			now: () => now,
			setTimeout(handler, delay) {
				const id = ++sequence;
				timers.set(id, { handler, dueAt: now + delay });
				return id;
			},
			clearTimeout: (id) => timers.delete(id),
		},
		async advanceTo(target, engine) {
			for (;;) {
				const due = [...timers].sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
				if (!due || due[1].dueAt > target) break;
				timers.delete(due[0]);
				now = due[1].dueAt;
				due[1].handler();
				await engine.idle();
			}
			now = target;
		},
		async wakeAt(target, engine) {
			now = target;
			await engine.wake();
		},
	};
}

/** A fake durable source: definitions survive creating a new engine, but
 * subscription state and callbacks belong to the current server process. */
function source(initial) {
	let definitions = structuredClone(initial);
	const listeners = new Set();
	const due = [];
	const missed = [];
	const disabled = [];
	const emit = () => {
		for (const listener of listeners) listener();
	};
	const update = (id, patch) => {
		definitions = definitions.map((definition) =>
			definition.id === id ? { ...definition, ...patch } : definition,
		);
	};
	return {
		due,
		missed,
		disabled,
		listeners,
		schedules: () => definitions,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async markEvaluated(id, through) {
			update(id, { evaluatedThrough: through });
		},
		async recordMissed(id, count, latest) {
			missed.push({ id, count, latest });
		},
		async onDue(id, firedAt) {
			due.push({ id, firedAt });
		},
		async disableOnce(id) {
			disabled.push(id);
			update(id, { enabled: false });
			emit();
		},
		save(id, patch) {
			update(id, patch);
			emit();
		},
		remove(id) {
			definitions = definitions.filter((definition) => definition.id !== id);
			emit();
		},
	};
}

const definition = (schedule, evaluatedThrough, extra = {}) => ({
	id: 'same-id',
	enabled: true,
	schedule,
	evaluatedThrough,
	...extra,
});
const every = (anchor, intervalMs = HOUR) => ({
	kind: 'every',
	anchor,
	intervalMs,
});
const cron = (expression) => ({ kind: 'cron', cron: expression });

function setup(start, timeZone = 'UTC') {
	const time = fakeClock(start);
	const errors = [];
	const engine = new ScheduleEngine({
		clock: time.clock,
		timeZone,
		onError: (error) => errors.push(error),
	});
	return { time, engine, errors };
}

test('sources share one timer, keep ids independent, and unregister without stopping each other', async () => {
	const start = at('2026-01-05T08:00:00Z');
	const { time, engine } = setup(start);
	const first = source([definition(every(start), start)]);
	const second = source([definition(every(start, 30 * MINUTE), start)]);
	const unregister = await engine.registerSource('first', first);
	await engine.registerSource('second', second);
	assert.equal(time.timers.size, 1);
	assert.equal(engine.armedFor, start + 30 * MINUTE);
	await assert.rejects(
		engine.registerSource('second', second),
		/already registered/,
	);
	await time.advanceTo(start + HOUR, engine);
	assert.deepEqual(first.due, [{ id: 'same-id', firedAt: start + HOUR }]);
	assert.equal(second.due.length, 2);
	unregister();
	unregister();
	assert.equal(first.listeners.size, 0);
	await time.advanceTo(start + 2 * HOUR, engine);
	assert.equal(first.due.length, 1);
	assert.equal(second.due.length, 4);
	engine.stop();
	assert.equal(second.listeners.size, 0);
	assert.equal(time.timers.size, 0);
	await assert.rejects(engine.registerSource('late', first), /stopped/);
});

test('an automation and another source due in the same minute each fire once with the automation log intact', async () => {
	const start = at('2026-01-05T08:00:00Z');
	const { time, engine } = setup(start);
	const backend = () => ({
		async load() {},
		async commit() {},
		async backup() {},
	});
	const repository = new AutomationRepository(backend(), {
		now: () => time.now,
	});
	await repository.load();
	await repository.upsert({
		id: 'same-id',
		name: 'Hourly',
		trigger: { kind: 'schedule', cron: '0 * * * *' },
		action: { kind: 'runCommand', command: 'true' },
	});
	const runLog = new AutomationRunLog(backend());
	const automation = new AutomationScheduler({
		repository,
		runLog,
		engine,
		clock: time.clock,
		generateRunId: () => 'run-id',
		controller: () => undefined,
	});
	await automation.start();
	const other = source([definition(every(start), start)]);
	await engine.registerSource('other', other);
	await time.advanceTo(start + HOUR, engine);
	assert.deepEqual(other.due, [{ id: 'same-id', firedAt: start + HOUR }]);
	assert.equal(runLog.list('same-id').length, 1);
	assert.deepEqual(runLog.list('same-id')[0], {
		runId: 'run-id',
		automationId: 'same-id',
		triggerKind: 'schedule',
		firedAt: start + HOUR,
		startedBy: 'trigger',
		status: 'finished',
		outcome: 'skipped',
		skipReason: 'executorUnavailable',
		reason: 'no automation executor is available on this server',
		startedAt: start + HOUR,
		finishedAt: start + HOUR,
		durationMs: 0,
		suppressedEvents: 0,
	});
	automation.stop();
	await time.advanceTo(start + 2 * HOUR, engine);
	assert.equal(other.due.length, 2);
	engine.stop();
});

test('editing, disabling, enabling with a new anchor, and removing re-arm the shared deadline', async () => {
	const start = at('2026-01-05T08:00:00Z');
	const { time, engine } = setup(start);
	const store = source([definition(every(start), start)]);
	await engine.registerSource('source', store);
	await time.advanceTo(start + 10 * MINUTE, engine);
	store.save('same-id', { schedule: every(time.now, 5 * MINUTE) });
	assert.equal(engine.armedFor, start + 15 * MINUTE);
	await time.advanceTo(start + 15 * MINUTE, engine);
	assert.equal(store.due.length, 1);
	store.save('same-id', { enabled: false });
	assert.equal(time.timers.size, 0);
	await time.advanceTo(start + 22 * MINUTE, engine);
	store.save('same-id', {
		enabled: true,
		schedule: every(time.now, 5 * MINUTE),
	});
	assert.equal(engine.armedFor, start + 27 * MINUTE);
	store.remove('same-id');
	assert.equal(time.timers.size, 0);
	engine.stop();
});

test('restart recomputes every-6-hours from the saved 08:00 anchor, with no drift or catch-up', async () => {
	const anchor = at('2026-01-05T08:00:00Z');
	const store = source([definition(every(anchor, 6 * HOUR), anchor)]);
	const first = setup(anchor);
	await first.engine.registerSource('source', store);
	first.engine.stop();
	const restart = setup(anchor + 4 * HOUR);
	await restart.engine.registerSource('source', store);
	assert.equal(restart.engine.armedFor, anchor + 6 * HOUR);
	assert.equal(store.due.length, 0);
	restart.engine.stop();
	const later = setup(anchor + 19 * HOUR);
	await later.engine.registerSource('source', store);
	assert.deepEqual(store.missed, [
		{ id: 'same-id', count: 3, latest: anchor + 18 * HOUR },
	]);
	assert.equal(later.engine.armedFor, anchor + 24 * HOUR);
	assert.equal(store.due.length, 0);
	later.engine.stop();
});

for (const [name, startIso] of [
	['spring forward', '2026-03-29T00:30:00Z'],
	['fall back', '2026-10-25T00:30:00Z'],
]) {
	test(`intervals stay 60 elapsed minutes apart through ${name}, including restart`, async () => {
		const start = at(startIso);
		const { time, engine } = setup(start, 'Europe/London');
		const store = source([definition(every(start), start)]);
		await engine.registerSource('source', store);
		await time.advanceTo(start + 2 * HOUR, engine);
		assert.deepEqual(
			store.due.map(({ firedAt }) => firedAt),
			[start + HOUR, start + 2 * HOUR],
		);
		engine.stop();
		const restarted = setup(start + 2 * HOUR + 15 * MINUTE, 'Europe/London');
		await restarted.engine.registerSource('source', store);
		assert.equal(restarted.engine.armedFor, start + 3 * HOUR);
		await restarted.time.advanceTo(start + 3 * HOUR, restarted.engine);
		assert.equal(store.due[2].firedAt, start + 3 * HOUR);
		restarted.engine.stop();
	});
}

for (const [name, startIso, nextIso] of [
	['spring forward', '2026-03-28T09:00:00Z', '2026-03-29T08:00:00Z'],
	['fall back', '2026-10-24T08:00:00Z', '2026-10-25T09:00:00Z'],
]) {
	test(`cron preserves local 09:00 through ${name}`, async () => {
		const start = at(startIso);
		const { time, engine } = setup(start, 'Europe/London');
		const store = source([definition(cron('0 9 * * *'), start)]);
		await engine.registerSource('source', store);
		assert.equal(engine.armedFor, at(nextIso));
		await time.advanceTo(at(nextIso), engine);
		assert.deepEqual(store.due, [{ id: 'same-id', firedAt: at(nextIso) }]);
		engine.stop();
	});
}

test('a once schedule fires once, persists disabled, and never fires again after restart', async () => {
	const start = at('2026-01-05T08:00:00Z');
	const { time, engine } = setup(start);
	const store = source([
		definition({ kind: 'once', at: start + 30_000 }, start),
	]);
	await engine.registerSource('source', store);
	await time.advanceTo(start + 30_000, engine);
	assert.deepEqual(store.due, [{ id: 'same-id', firedAt: start + 30_000 }]);
	assert.deepEqual(store.disabled, ['same-id']);
	assert.equal(store.schedules()[0].enabled, false);
	assert.equal(time.timers.size, 0);
	engine.stop();
	const restarted = setup(start + HOUR);
	await restarted.engine.registerSource('source', store);
	assert.equal(store.due.length, 1);
	assert.deepEqual(store.missed, []);
	restarted.engine.stop();
});

test('a once missed while the server was off is recorded and disabled; another restart does not recount it', async () => {
	const start = at('2026-01-05T08:00:00Z');
	const store = source([definition({ kind: 'once', at: start + HOUR }, start)]);
	const { engine, time } = setup(start + 2 * HOUR);
	await engine.registerSource('source', store);
	assert.deepEqual(store.missed, [
		{ id: 'same-id', count: 1, latest: start + HOUR },
	]);
	assert.deepEqual(store.disabled, ['same-id']);
	assert.equal(store.due.length, 0);
	assert.equal(time.timers.size, 0);
	engine.stop();
	const restarted = setup(start + 3 * HOUR);
	await restarted.engine.registerSource('source', store);
	assert.equal(store.missed.length, 1);
	restarted.engine.stop();
});

test('late wake records missed intervals, runs only the latest on-time occurrence, and keeps the anchor', async () => {
	const start = at('2026-01-05T08:00:00Z');
	const { time, engine } = setup(start);
	const store = source([definition(every(start, 5 * MINUTE), start)]);
	await engine.registerSource('source', store);
	await time.wakeAt(start + 16 * MINUTE + 1, engine);
	assert.deepEqual(store.missed, [
		{ id: 'same-id', count: 3, latest: start + 15 * MINUTE },
	]);
	assert.equal(store.due.length, 0);
	await time.wakeAt(start + 30 * MINUTE + 30_000, engine);
	assert.deepEqual(store.due, [
		{ id: 'same-id', firedAt: start + 30 * MINUTE },
	]);
	assert.deepEqual(store.missed[1], {
		id: 'same-id',
		count: 2,
		latest: start + 25 * MINUTE,
	});
	assert.equal(engine.armedFor, start + 35 * MINUTE);
	engine.stop();
});

test('a once missed during sleep is disabled without running', async () => {
	const { time, engine } = setup(0);
	const store = source([definition({ kind: 'once', at: HOUR }, 0)]);
	await engine.registerSource('source', store);
	await time.wakeAt(2 * HOUR, engine);
	assert.equal(store.due.length, 0);
	assert.deepEqual(store.disabled, ['same-id']);
	assert.deepEqual(store.missed, [{ id: 'same-id', count: 1, latest: HOUR }]);
	assert.equal(time.timers.size, 0);
	engine.stop();
});

test('the 5-minute minimum accepts its boundary and reports invalid intervals and timestamps', async () => {
	const { time, engine, errors } = setup(0);
	const store = source([
		definition(every(0, MIN_SCHEDULE_INTERVAL_MS), 0, { id: 'minimum' }),
		...[2 * MINUTE, 0, -MINUTE, NaN, Infinity].map((intervalMs, index) =>
			definition(every(0, intervalMs), 0, { id: `invalid-${index}` }),
		),
		definition(every(NaN), 0, { id: 'bad-anchor' }),
		definition({ kind: 'once', at: Infinity }, 0, { id: 'bad-once' }),
	]);
	await engine.registerSource('source', store);
	for (const reason of [/5 minutes/, /anchor/, /date and time/])
		assert.ok(errors.some((error) => reason.test(error.message)));
	assert.equal(engine.nextDueAt('source', 'invalid-0'), undefined);
	await time.advanceTo(5 * MINUTE, engine);
	assert.deepEqual(store.due, [{ id: 'minimum', firedAt: 5 * MINUTE }]);
	engine.stop();
});

test('a failing source and failing error reporter do not stop another source', async () => {
	const time = fakeClock(0);
	const engine = new ScheduleEngine({
		clock: time.clock,
		onError() {
			throw new Error('reporter failed');
		},
	});
	const bad = source([definition(every(0), 0)]);
	const good = source([definition(every(0), 0)]);
	await engine.registerSource('bad', {
		...bad,
		async onDue() {
			throw new Error('source failed');
		},
	});
	await engine.registerSource('good', good);
	await time.advanceTo(HOUR, engine);
	assert.equal(good.due.length, 1);
	assert.equal(time.timers.size, 1);
	engine.stop();
});

test('far deadlines re-arm within the timeout limit and fire only at the requested time', async () => {
	const { time, engine } = setup(0);
	const deadline = 40 * 24 * HOUR;
	const store = source([definition({ kind: 'once', at: deadline }, 0)]);
	await engine.registerSource('source', store);
	assert.equal([...time.timers.values()][0].dueAt, 2_147_483_647);
	await time.advanceTo(2_147_483_647, engine);
	assert.equal(store.due.length, 0);
	assert.equal(time.timers.size, 1);
	await time.advanceTo(deadline, engine);
	assert.deepEqual(store.due, [{ id: 'same-id', firedAt: deadline }]);
	assert.equal(time.timers.size, 0);
	engine.stop();
});
