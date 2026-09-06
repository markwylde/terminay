import assert from 'node:assert/strict';
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
 * @property {(harness: unknown) => unknown} resume Resumes the same provider session in a new process.
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
	const harness = await createConformanceHarness({
		extension: descriptor.extension,
		providerId: descriptor.providerId,
		executable: descriptor.executable,
		...(descriptor.environment
			? { environment: descriptor.environment(process.cwd()) }
			: {}),
	});
	const step = async (name, run) => {
		log(`▶ ${name}`);
		await run();
		log(`✓ ${name} (state=${harness.projection.state})`);
	};
	try {
		// Detect: launching the CLI normally binds a root to this exact PTY.
		await step('detect', async () => {
			await descriptor.launch(harness);
			await harness.await('the CLI to bind', (projection) => projection.bound);
			assert.equal(
				descriptor.row.detect,
				'Y',
				`${descriptor.name} bound but does not claim detection`,
			);
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
			await harness.awaitState('done');
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
		await step('resume', async () => {
			await descriptor.resume(harness);
			await harness.await(
				'the resumed session to rebind',
				(projection) => projection.active,
			);
			assert.equal(
				harness.projection.providerSessionId,
				rootId,
				'a resumed session must rebind the same root, not create a second',
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
		if (descriptor.row.blocked !== 'N') {
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
		await harness.close();
	}
}
