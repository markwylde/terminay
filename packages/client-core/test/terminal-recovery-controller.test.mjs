import test from "node:test";
import assert from "node:assert/strict";
import { TerminalRecoveryController } from "../dist/index.js";

const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
const skip = (reason = "congestion", fromPosition = 10, toPosition = 20) => ({
	...identity,
	type: "skip",
	fromPosition,
	toPosition,
	reason,
});
const output = (position = 0, nextPosition = 8) => ({
	...identity,
	type: "output",
	position,
	nextPosition,
	bytes: new Uint8Array(nextPosition - position),
	replay: false,
});

/** A controllable clock, so recovery is driven by the test rather than by
 * real timers whose ordering under load is what produced the original bug. */
function harness(overrides = {}) {
	const scheduled = [];
	const attempts = [];
	let outcome = "attaching";
	const controller = new TerminalRecoveryController({
		retryDelayMs: 100,
		schedule: (run) => {
			const entry = { run, cancelled: false };
			scheduled.push(entry);
			return () => {
				entry.cancelled = true;
			};
		},
		reattach: (attempt) => {
			attempts.push(attempt);
			return outcome;
		},
		...overrides,
	});
	return {
		controller,
		attempts,
		setOutcome: (value) => {
			outcome = value;
		},
		/** Fire every timer that has not been cancelled, as a wake from sleep
		 * would: coalesced, and after other work has already run. */
		fire: () => {
			for (const entry of scheduled.splice(0)) if (!entry.cancelled) entry.run();
		},
		pending: () => scheduled.filter((entry) => !entry.cancelled).length,
	};
}

test("a recoverable skip schedules exactly one re-attach", () => {
	const { controller, attempts, fire } = harness();
	assert.equal(controller.state, "streaming");
	assert.equal(controller.noteEvent(skip()), true);
	assert.equal(controller.state, "recovering");
	fire();
	assert.deepEqual(attempts, [1]);
});

test("output and hydration skips never start a recovery", () => {
	const { controller, attempts, fire } = harness();
	assert.equal(controller.noteEvent(output()), false);
	assert.equal(controller.noteEvent(skip("hydration")), false);
	fire();
	assert.deepEqual(attempts, []);
	assert.equal(controller.state, "streaming");
});

test("a skip arriving while a re-attach is pending does not queue a second one", () => {
	const { controller, attempts, fire } = harness();
	controller.noteEvent(skip());
	assert.equal(controller.noteEvent(skip("congestion", 20, 30)), false);
	fire();
	assert.deepEqual(attempts, [1], "the pending attach already starts from a fresh checkpoint");
});

test("a completed re-attach returns the controller to streaming and resets the count", () => {
	const { controller, attempts, fire } = harness();
	controller.noteEvent(skip());
	fire();
	controller.noteAttached();
	assert.equal(controller.state, "streaming");
	assert.equal(controller.attempt, 0);
	controller.noteEvent(skip());
	fire();
	assert.deepEqual(attempts, [1, 1]);
});

/**
 * The regression.
 *
 * The panel's retry timer used to read
 *
 *     if (disposed || !resyncing || panelAttachment !== null) return;
 *     resyncing = false;
 *
 * so an attach that landed between the skip and the timer made the timer
 * return with the flag still set. The entry point then dropped every later
 * skip, and the terminal was frozen for the life of the component: connected,
 * accepting keystrokes, reporting no error, fixable only by a reload.
 *
 * Declining an attempt must therefore re-arm recovery, never end it.
 */
test("declining a re-attach re-arms recovery instead of latching the terminal shut", () => {
	const { controller, attempts, setOutcome, fire } = harness();
	setOutcome("declined");
	controller.noteEvent(skip());
	fire();
	assert.deepEqual(attempts, [1], "the caller was asked");
	assert.equal(controller.state, "streaming", "a declined attempt must not leave the controller latched");

	setOutcome("attaching");
	assert.equal(controller.noteEvent(skip("congestion", 30, 40)), true, "the next skip is still honoured");
	fire();
	assert.deepEqual(attempts, [1, 2]);
});

test("a re-attach that throws still leaves recovery armed", () => {
	const { controller, fire } = harness({
		reattach: () => {
			throw new Error("attach exploded");
		},
	});
	controller.noteEvent(skip());
	fire();
	assert.equal(controller.state, "streaming");
	assert.equal(controller.noteEvent(skip()), true);
});

test("a failed attach re-arms recovery", () => {
	const { controller, attempts, fire } = harness();
	controller.noteEvent(skip());
	fire();
	controller.noteAttachFailed();
	assert.equal(controller.state, "streaming");
	assert.equal(controller.noteEvent(skip()), true);
	fire();
	assert.deepEqual(attempts, [1, 2], "the attempt count carries across a failed recovery");
});

test("repeated congestion keeps recovering rather than giving up", () => {
	const { controller, attempts, fire } = harness();
	for (let round = 0; round < 25; round += 1) {
		assert.equal(
			controller.noteEvent(skip("congestion", round * 10, round * 10 + 5)),
			true,
			`round ${round} must still be able to recover`,
		);
		fire();
		controller.noteAttached();
	}
	assert.equal(attempts.length, 25);
});

test("a disposed controller stops scheduling work", () => {
	const { controller, attempts, fire } = harness();
	controller.dispose();
	assert.equal(controller.noteEvent(skip()), false);
	fire();
	assert.deepEqual(attempts, []);
});

test("reset abandons an in-flight recovery so a transport rebind can take over", () => {
	const { controller, attempts, fire } = harness();
	controller.noteEvent(skip());
	controller.reset();
	fire();
	assert.deepEqual(attempts, [], "the superseded retry must not fire");
	assert.equal(controller.state, "streaming");
	assert.equal(controller.attempt, 0);
	assert.equal(controller.noteEvent(skip()), true, "recovery is available again");
});

test('a hydration gap followed by silence refreshes only after hydration completes', () => {
 const h = harness();
 h.controller.noteStreamProgress(skip('hydration', 100, 300));
 assert.equal(h.pending(), 0);
 h.controller.noteAttached(); assert.equal(h.pending(), 1);
 h.fire(); assert.equal(h.controller.state, 'recovering'); assert.deepEqual(h.attempts, []);
 h.fire(); assert.deepEqual(h.attempts, [1]);
 // The refreshed checkpoint contains the final screen; no new gap.
 h.controller.noteAttached(); h.fire(); assert.deepEqual(h.attempts, [1]); assert.equal(h.pending(), 0);
});

test('continued output defers hydration convergence instead of creating an attach loop', () => {
 const callbacks = []; let refreshes = 0;
 const controller = new TerminalRecoveryController({ retryDelayMs: 100, schedule: (run, delay) => { const timer = { run, delay, cancelled: false }; callbacks.push(timer); return () => { timer.cancelled = true; }; }, reattach: () => { refreshes++; return 'attaching'; } });
 controller.noteStreamProgress(skip('hydration')); controller.noteAttached();
 for (let i = 0; i < 20; i++) {
  const previous = callbacks.at(-1); controller.noteStreamProgress(output(i * 8, (i + 1) * 8));
  assert.equal(previous.cancelled, true); assert.equal(refreshes, 0);
 }
 assert.equal(callbacks.filter(timer => !timer.cancelled).length, 1);
 assert.equal(callbacks.at(-1).delay, 500);
 controller.dispose(); assert.equal(callbacks.at(-1).cancelled, true);
});

test('repeated incomplete quiet refreshes stop with a visible failure callback', () => {
 let failures = 0;
 const h = harness({ onHydrationConvergenceExhausted: () => { failures++; } });
 h.controller.noteStreamProgress(skip('hydration')); h.controller.noteAttached();
 for (let i = 0; i < 3; i++) {
  h.fire(); h.fire();
  h.controller.noteStreamProgress(skip('hydration')); h.controller.noteAttached();
 }
 h.fire(); h.fire();
 assert.equal(h.attempts.length, 3); assert.equal(failures, 1); assert.equal(h.pending(), 0);
});

for (const action of ['reset', 'dispose']) test(`${action} cancels the pending hydration convergence timer`, () => {
 const h = harness(); h.controller.noteStreamProgress(skip('hydration')); h.controller.noteAttached();
 h.controller[action](); h.fire(); assert.deepEqual(h.attempts, []); assert.equal(h.pending(), 0);
});

test('a clean hydration resets the convergence budget for a later independent gap', () => {
 let failures = 0; const h = harness({ onHydrationConvergenceExhausted: () => { failures++; } });
 for (let i = 0; i < 5; i++) {
  h.controller.noteStreamProgress(skip('hydration')); h.controller.noteAttached(); h.fire(); h.fire();
  h.controller.noteAttached(); h.fire();
 }
 assert.equal(h.attempts.length, 5); assert.equal(failures, 0); assert.equal(h.pending(), 0);
});

test('exit after a hydration gap cancels convergence without reattaching the ended session', () => {
 const h = harness(); h.controller.noteStreamProgress(skip('hydration')); h.controller.noteAttached();
 h.controller.noteStreamProgress({ ...identity, type: 'exit', exitCode: 0 }); h.fire();
 assert.deepEqual(h.attempts, []); assert.equal(h.pending(), 0);
});

test('a reconnect resume retains unresolved hydration debt', () => {
 const h = harness(); h.controller.noteStreamProgress(skip('hydration')); h.controller.noteAttached();
 h.controller.reset(); h.fire(); assert.deepEqual(h.attempts, []);
 h.controller.noteAttached({ freshPresentation: false }); h.fire(); h.fire();
 assert.equal(h.attempts.length, 1);
});

test('a hydration skip arriving after noteAttached cannot reset the convergence budget', () => {
 let failures = 0; const h = harness({ onHydrationConvergenceExhausted: () => { failures++; } });
 h.controller.noteAttached(); h.controller.noteStreamProgress(skip('hydration'));
 for (let i = 0; i < 3; i++) {
  h.fire(); h.fire(); h.controller.noteAttached(); h.controller.noteStreamProgress(skip('hydration'));
 }
 h.fire(); assert.equal(h.attempts.length, 3); assert.equal(failures, 1);
});

test('an explicit retry after convergence exhaustion receives a full new budget', () => {
 let failures = 0; const h = harness({ onHydrationConvergenceExhausted: () => { failures++; } });
 h.controller.noteStreamProgress(skip('hydration')); h.controller.noteAttached();
 for (let i = 0; i < 3; i++) { h.fire(); h.fire(); h.controller.noteStreamProgress(skip('hydration')); h.controller.noteAttached(); }
 h.fire(); assert.equal(failures, 1);
 h.controller.reset({ renewConvergenceBudget: true });
 h.controller.noteStreamProgress(skip('hydration')); h.controller.noteAttached(); h.fire(); h.fire();
 assert.equal(h.attempts.length, 4); assert.equal(failures, 1);
});
