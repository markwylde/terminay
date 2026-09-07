import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConformanceHarness } from './harness.mjs';

const sleep = (ms) =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});

/** Every capability the published matrix states a verdict for. */
export const CAPABILITIES = Object.freeze([
	'detect',
	'title',
	'idle',
	'working',
	'waiting',
	'blocked',
	'done',
	'subEnumerate',
	'subStatus',
	'resume',
]);

/**
 * `Y` is read from an explicit provider record, `Y*` is derived from that
 * provider's journal by a named rule, `N` is unavailable with a stated reason.
 *
 * @typedef {'Y' | 'Y*' | 'N'} Verdict
 *
 * @typedef {object} ProviderDescriptor
 * @property {string} name
 * @property {{ activate(context: unknown): Promise<void> | void }} extension
 * @property {string} providerId
 * @property {string} enableEnvironmentVariable Opts this provider's run in.
 * @property {string} executable Must resolve on PATH for the run to be possible.
 * @property {Record<string, Verdict>} row
 * @property {(cwd: string) => Record<string, string>} [environment]
 * @property {(harness: import('./harness.mjs').ConformanceHarness) => unknown} launch
 * @property {(harness: unknown) => unknown} startSubagents Prompt that starts several subagents with staggered completions.
 * @property {(harness: unknown) => unknown} requestInput Leaves a real input request outstanding.
 * @property {(harness: unknown) => unknown} answerInput Answers it.
 * @property {(harness: unknown) => unknown} [provokeFault] Provokes a real halting fault.
 * @property {(harness: unknown) => unknown} quit
 * @property {(harness: unknown, providerSessionId?: string) => unknown} resume
 *   Resumes a provider session in a new process. The second argument names the
 *   session to resume; a descriptor that is passed none resumes the session its
 *   own harness is bound to, which is what the plain quit-then-resume step
 *   wants. The argument exists because the resume-while-another-runs step
 *   resumes one terminal's session from a *different* harness, whose own
 *   projection knows nothing about it.
 * @property {(harness: import('./harness.mjs').ConformanceHarness) => unknown} secondLaunch Starts a second, independent session of this provider.
 */

/** A row must state a verdict for every capability, with no gaps or extras. */
export function assertRowIsComplete(descriptor) {
	for (const capability of CAPABILITIES) {
		const verdict = descriptor.row[capability];
		assert.ok(
			verdict === 'Y' || verdict === 'Y*' || verdict === 'N',
			`${descriptor.name} states no verdict for ${capability}`,
		);
	}
	assert.deepEqual(
		Object.keys(descriptor.row).sort(),
		[...CAPABILITIES].sort(),
		`${descriptor.name} declares a row that does not match the matrix columns`,
	);
	assert.equal(
		typeof descriptor.secondLaunch,
		'function',
		`${descriptor.name} must supply secondLaunch so two concurrent sessions can be proven`,
	);
	// The resume gesture is driven from a harness other than the one that owns
	// the session, so it cannot be optional and cannot be a bare `--continue`
	// with no way to name what it resumes.
	assert.equal(
		typeof descriptor.resume,
		'function',
		`${descriptor.name} must supply resume so a session can be reopened by id`,
	);
}

/** A provider runs only when explicitly opted in and its CLI is provisioned. */
export async function conformanceGate(descriptor) {
	if (process.env[descriptor.enableEnvironmentVariable] !== '1') {
		return {
			skip: true,
			reason: `set ${descriptor.enableEnvironmentVariable}=1 with an authenticated ${descriptor.name} CLI to run this`,
		};
	}
	const { spawnSync } = await import('node:child_process');
	const found = spawnSync('/bin/bash', ['-lc', 'command -v "$1"', '--', descriptor.executable], {
		encoding: 'utf8',
	});
	if (found.status !== 0) {
		return { skip: true, reason: `${descriptor.executable} is not on PATH` };
	}
	return undefined;
}

/**
 * The whole matrix, asserted once and run for every provider. A capability
 * cannot be verified for one provider and quietly skipped for another: each
 * assertion is either exercised or explicitly asserted as unsupported.
 */
export async function runConformance(descriptor, options = {}) {
	assertRowIsComplete(descriptor);
	const log =
		options.log ??
		(process.env.TERMINAY_CONFORMANCE_LOG === '1'
			? (line) => process.stderr.write(`${line}\n`)
			: () => {});
	// One disposable directory for the whole run, owned here rather than by any
	// one PTY: the seeded session, the session under test, the concurrent second
	// session and the resuming third all work in it, and it must outlive the
	// first of them closing.
	const workingDirectory = realpathSync(
		mkdtempSync(join(tmpdir(), 'terminay-conformance-')),
	);
	const openHarness = () =>
		createConformanceHarness({
			extension: descriptor.extension,
			providerId: descriptor.providerId,
			executable: descriptor.executable,
			cwd: workingDirectory,
			...(descriptor.environment
				? { environment: descriptor.environment(process.cwd()) }
				: {}),
			log,
		});
	/** @type {Awaited<ReturnType<typeof createConformanceHarness>> | undefined} */
	let harness;
	const step = async (name, run) => {
		log(`▶ ${name}`);
		await run();
		log(`✓ ${name} (state=${harness ? harness.projection.state : 'not yet launched'})`);
	};
	/** @type {Awaited<ReturnType<typeof createConformanceHarness>> | undefined} */
	let second;
	/** @type {Awaited<ReturnType<typeof createConformanceHarness>> | undefined} */
	let third;
	/** @type {string | undefined} */
	let seededSessionId;
	try {
		// The working directory must already hold somebody else's session before
		// anything under test starts. Every process the matrix launches then sees
		// a journal it did not write, older than itself — the ordinary state of a
		// repository a developer has worked in, and the state an empty container
		// directory hid. A provider that picks its session by file time binds this
		// one and fails `detect`.
		await step('seed an earlier session', async () => {
			const seed = await openHarness();
			try {
				await descriptor.launch(seed);
				await seed.await(
					'the seeded session to bind',
					(projection) => projection.bound,
				);
				// One whole turn, so the seeded journal holds real work rather than
				// an empty header: the launch gesture carries the first prompt.
				await seed.awaitState('done');
				seededSessionId = seed.projection.providerSessionId;
				assert.ok(
					seededSessionId,
					`${descriptor.name} could not seed the working directory: the earlier session bound no provider session id, so nothing under test would start beside a session it did not write`,
				);
				await descriptor.quit(seed);
				await seed.await(
					'the seeded session to go inactive',
					(projection) => !projection.active,
				);
			} finally {
				await seed.close();
			}
		});

		harness = await openHarness();
		// Detect: launching the CLI normally binds a root to this exact PTY.
		await step('detect', async () => {
			await descriptor.launch(harness);
			await harness.await('the CLI to bind', (projection) => projection.bound);
			assert.equal(
				descriptor.row.detect,
				'Y',
				`${descriptor.name} bound but does not claim detection`,
			);
			// The directory holds an earlier session. Binding it would mean the
			// provider chose by what the directory contains rather than by what
			// this process is.
			assert.notEqual(
				harness.projection.providerSessionId,
				seededSessionId,
				`${descriptor.name} bound the session under test to the earlier session already in the directory (${seededSessionId}) instead of its own`,
			);
		});

		// Idle: a bound session with no work yet. The launch gesture carries the
		// first prompt, so polling for `idle` would race the turn that prompt
		// opens. The recorded order is the evidence instead: the session started
		// — which is the idle state — before anything opened a turn.
		await step('idle before any work', async () => {
			const kinds = harness.projection.events.map((event) => event.kind);
			const started = kinds.indexOf('session.started');
			assert.notEqual(started, -1, `${descriptor.name} never started a session`);
			const firstWork = kinds.findIndex(
				(kind) => kind === 'turn.started' || kind === 'tool.started',
			);
			assert.ok(
				firstWork === -1 || started < firstWork,
				`${descriptor.name} opened a turn before its session started, so it was never idle`,
			);
			assert.equal(descriptor.row.idle, 'Y');
		});

		// Title: a label exists before the provider has chosen one. The pump can
		// outrun this poll, so the evidence is the sequence of distinct labels the
		// provider emitted, not whichever one happened to be current.
		const distinctTitles = (projection) => {
			const seen = [];
			for (const event of projection.events) {
				if (event.title && seen.at(-1) !== event.title) seen.push(event.title);
			}
			return seen;
		};
		await step('title before the provider chose one', async () => {
			await harness.await(
				'a label before the provider chose one',
				(projection) => distinctTitles(projection).length >= 1,
			);
		});

		// The first turn completes: Working, then Done, then Idle is implied by
		// the next turn opening from that state.
		await step('first turn done', async () => {
			await harness.awaitState('done');
			assert.equal(descriptor.row.done, 'Y');
			// `done` must carry its outcome so a failed or cancelled run is
			// distinguishable from a successful one.
			assert.ok(
				harness.projection.outcome,
				`${descriptor.name} completed a turn without recording an outcome`,
			);
		});

		// Working and subagents: several children, completing at different times.
		await step('subagents', async () => {
			await descriptor.startSubagents(harness);
			await harness.awaitState('working');
			if (descriptor.row.subEnumerate !== 'N') {
				await harness.await(
					'subagents to be enumerated',
					(projection) => projection.children.size >= 2,
				);
				// A child may appear a moment before its label is recorded, for
				// instance while a tool call's input is still streaming; every child
				// must carry a label soon after.
				await harness.await(
					'every enumerated subagent to carry a label',
					(projection) =>
						[...projection.children.values()].every((child) => child.title),
					30_000,
				);
			}
			if (descriptor.row.subStatus !== 'N') {
				await harness.await(
					'one child to complete while another still works',
					(projection) => {
						const states = [...projection.children.values()];
						return (
							states.some((child) => child.state === 'done') &&
							states.some((child) => child.state === 'working') &&
							projection.state === 'working'
						);
					},
				);
			}
			// The root must not complete before its children do: while any child
			// is working the root is held in `working`.
			if (descriptor.row.subStatus !== 'N') {
				assert.equal(
					harness.projection.state,
					'working',
					`${descriptor.name} left its root out of working while a child was still working`,
				);
			}
			await harness.awaitState('done');
			if (descriptor.row.subStatus !== 'N') {
				assert.ok(
					[...harness.projection.children.values()].every(
						(child) => child.state === 'done',
					),
					`${descriptor.name} completed its root while a child was still working`,
				);
			}
			if (descriptor.row.subEnumerate === 'N') {
				assert.equal(
					harness.projection.children.size,
					0,
					`${descriptor.name} declares Sub:Enumerate N but enumerated children`,
				);
			}
		});

		// Title again: the provider's own title replaces the initial label.
		if (descriptor.row.title === 'Y') {
			await step('provider title', async () => {
				await harness.await(
					'the provider to choose a title replacing the initial label',
					(projection) => distinctTitles(projection).length >= 2,
				);
			});
		}

		// Waiting: a real outstanding input request, then its answer. A provider
		// that declares waiting unavailable is held to the opposite: the request
		// is still made, and no wait may be reported for it or anything earlier.
		await step('waiting', async () => {
			await descriptor.requestInput(harness);
			if (descriptor.row.waiting === 'N') {
				await sleep(20_000);
				assert.equal(
					harness.projection.events.filter((e) => e.kind === 'wait.started')
						.length,
					0,
					`${descriptor.name} declares waiting N but reported a wait`,
				);
			} else {
				await harness.awaitState('waiting', 240_000);
				assert.equal(
					harness.projection.inferred,
					descriptor.row.waiting === 'Y*',
					`${descriptor.name} claims waiting ${descriptor.row.waiting} but reported inferred=${harness.projection.inferred}`,
				);
			}
			await descriptor.answerInput(harness);
			await harness.await(
				'the wait to end',
				(projection) => projection.state !== 'waiting',
			);
			await harness.awaitState('done');
		});

		const firstSessionId = harness.projection.providerSessionId;
		// Two concurrent sessions of one provider, in one working directory. This
		// is the ordinary case on a developer's machine — one repository, several
		// terminals — and the case every other step is blind to, because each
		// drives a single PTY.
		assert.notEqual(
			firstSessionId,
			seededSessionId,
			`${descriptor.name} left the first terminal on the seeded session`,
		);
		await step('two concurrent sessions', async () => {
			// The same directory as the first session: providers key their session
			// stores on the working directory, so a separate one would not exercise
			// the case at all.
			second = await openHarness();
			await descriptor.secondLaunch(second);
			await second.await(
				'the second session to bind',
				(projection) => projection.bound,
			);
			assert.notEqual(
				second.projection.providerSessionId,
				harness.projection.providerSessionId,
				`${descriptor.name} bound both terminals to one provider session`,
			);
			assert.notEqual(
				second.projection.providerSessionId,
				seededSessionId,
				`${descriptor.name} bound the second terminal to the earlier session already in the directory (${seededSessionId})`,
			);
			// The first session must be untouched by the second's arrival.
			await harness.observe();
			assert.equal(
				harness.projection.providerSessionId,
				firstSessionId,
				`${descriptor.name} moved the first terminal's binding when a second started`,
			);
			assert.ok(harness.projection.active, 'the first session must stay bound');

			// Work in the second session moves only the second session.
			second.pty.send('Reply with the single word second.');
			await second.awaitState('working');
			await second.awaitState('done');
			await harness.observe();
			assert.equal(
				harness.projection.providerSessionId,
				firstSessionId,
				'work in one session must not rebind the other',
			);

		});

		// Resume while another session runs. This is the reported defect in its
		// exact shape: a third terminal reopens the first terminal's session by
		// id while the second terminal's session is live and is the most recently
		// written thing in the directory. A provider that picks the newest
		// journal, or the one that was appended to last, binds the second
		// session's id here and fails.
		await step('resume while another session runs', async () => {
			const secondSessionId = second.projection.providerSessionId;
			assert.ok(
				second.projection.active,
				'the second session must still be running for this step to mean anything',
			);
			third = await openHarness();
			// The resuming harness has no binding of its own yet, so the session to
			// reopen is named explicitly rather than read from its projection.
			await descriptor.resume(third, firstSessionId);
			if (descriptor.row.resume === 'N') {
				// Held to the opposite, the way the plain resume step is: the gesture
				// is still made and the session must not come back.
				await sleep(30_000);
				await third.observe();
				assert.notEqual(
					third.projection.providerSessionId,
					firstSessionId,
					`${descriptor.name} declares resume N but a resuming process bound the first session`,
				);
			} else {
				await third.await(
					'the resumed session to bind while another session runs',
					(projection) => projection.bound && projection.active,
				);
				assert.equal(
					third.projection.providerSessionId,
					firstSessionId,
					`${descriptor.name} resumed session ${firstSessionId} but bound ${third.projection.providerSessionId}${
						third.projection.providerSessionId === secondSessionId
							? ' — the live session of the other terminal'
							: third.projection.providerSessionId === seededSessionId
								? ' — the earlier seeded session'
								: ''
					}`,
				);
			}
			// The live terminal must not have moved while its neighbour resumed.
			await second.observe();
			assert.equal(
				second.projection.providerSessionId,
				secondSessionId,
				`${descriptor.name} moved the second terminal's binding when the first session was resumed beside it`,
			);
			assert.ok(
				second.projection.active,
				`${descriptor.name} retired the second session when the first was resumed beside it`,
			);
			await descriptor.quit(third);
			await third.await(
				'the resuming session to go inactive',
				(projection) => !projection.active,
			);
			await third.close();
			third = undefined;
		});

		// Quitting one leaves the other bound.
		await step('quitting one session leaves the other bound', async () => {
			await descriptor.quit(second);
			await second.await(
				'the second session to go inactive',
				(projection) => !projection.active,
			);
			await harness.observe();
			assert.ok(
				harness.projection.active,
				`${descriptor.name} retired the first session when the second quit`,
			);
		});

		// Resume: quitting makes the root inactive, resuming rebinds the same one.
		await step('quit', async () => {
			await descriptor.quit(harness);
			await harness.await(
				'the root to go inactive on quit',
				(projection) => !projection.active,
			);
			assert.notEqual(
				harness.projection.state,
				'working',
				'a quit CLI must not be left reporting working',
			);
		});
		const rootId = harness.projection.providerSessionId;
		const eventsBeforeResume = harness.projection.events.length;
		await step('resume', async () => {
			await descriptor.resume(harness);
			// A provider that declares resume unavailable is held to the opposite:
			// the gesture is still made, and the session must not come back. Without
			// this the step ran unconditionally and a provider declaring N could
			// never pass its own matrix row.
			if (descriptor.row.resume === 'N') {
				await sleep(30_000);
				await harness.observe();
				assert.equal(
					harness.projection.active,
					false,
					`${descriptor.name} declares resume N but the session rebound`,
				);
				return;
			}
			await harness.await(
				'the resumed session to rebind',
				(projection) => projection.active,
			);
			assert.equal(
				harness.projection.providerSessionId,
				rootId,
				'a resumed session must rebind the same root, not create a second',
			);
			// Rebinding must not replay the session's earlier transitions as new
			// activity: a resume publishes a binding, not the whole history again.
			const replayed = harness.projection.events
				.slice(eventsBeforeResume)
				.filter((event) => event.kind === 'turn.started').length;
			assert.ok(
				replayed <= 1,
				`${descriptor.name} replayed ${replayed} earlier turns on resume`,
			);
			// A resumed session that had completed reports done, not working.
			await harness.await(
				'the resumed session to report its completed state',
				(projection) => projection.state === 'done',
			);
			// Further work moves through working and done again.
			await descriptor.answerInput(harness);
			harness.pty.send('Reply with the single word resumed.');
			await harness.awaitState('working');
			await harness.awaitState('done');
		});

		// Blocked: a real halting fault, where the provider can report one. This
		// runs last because a faulted CLI may not survive to be resumed.
		if (descriptor.row.blocked === 'N') {
			// Held to the opposite, the same way waiting N is: nothing in the whole
			// run may have reported a blocked state.
			await step('blocked declared unsupported', async () => {
				assert.equal(
					harness.projection.events.filter(
						(event) => event.kind === 'wait.started' && event.state === 'blocked',
					).length,
					0,
					`${descriptor.name} declares blocked N but reported a block`,
				);
			});
		} else {
			await step('blocked', async () => {
				assert.ok(
					descriptor.provokeFault,
					`${descriptor.name} claims blocked ${descriptor.row.blocked} but supplies no fault gesture`,
				);
				await descriptor.provokeFault(harness);
				await harness.awaitState('blocked');
				assert.equal(
					harness.projection.inferred,
					descriptor.row.blocked === 'Y*',
				);
			});
		}
	} finally {
		if (third) await third.close();
		if (second) await second.close();
		if (harness) await harness.close();
		// No PTY owns this directory, so it is removed here — after every CLI
		// below every PTY has been terminated, so nothing is left writing into it.
		rmSync(workingDirectory, { recursive: true, force: true });
	}
}
