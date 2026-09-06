import assert from 'node:assert/strict';
import type { TerminayExtension } from '@terminay/extension-api';
import {
	type ConformanceHarness,
	createConformanceHarness,
} from './harness.js';

/** Every capability the published matrix states a verdict for. */
export const CAPABILITIES = [
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
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * `Y` is read from an explicit provider record, `Y*` is derived from that
 * provider's journal by a named rule, `N` is unavailable with a stated reason.
 */
export type Verdict = 'Y' | 'Y*' | 'N';

export type MatrixRow = Readonly<Record<Capability, Verdict>>;

export interface ProviderDescriptor {
	readonly name: string;
	readonly extension: TerminayExtension;
	readonly providerId: string;
	/** Environment variable that opts this provider's conformance run in. */
	readonly enableEnvironmentVariable: string;
	/** Executable that must resolve for the run to be possible at all. */
	readonly executable: string;
	readonly row: MatrixRow;
	/** Extra environment for the PTY, e.g. a disposable provider home. */
	environment?(cwd: string): Record<string, string>;
	/** Launches the CLI. Prefer passing the first turn as an argument. */
	launch(harness: ConformanceHarness): Promise<void> | void;
	/** Prompt that starts several subagents with staggered completions. */
	startSubagents(harness: ConformanceHarness): Promise<void> | void;
	/** Leaves a real input request outstanding. */
	requestInput(harness: ConformanceHarness): Promise<void> | void;
	/** Answers the outstanding input request. */
	answerInput(harness: ConformanceHarness): Promise<void> | void;
	/** Provokes a real halting fault. */
	provokeFault?(harness: ConformanceHarness): Promise<void> | void;
	/** Quits the CLI. */
	quit(harness: ConformanceHarness): Promise<void> | void;
	/** Resumes the same provider session in a new process. */
	resume(harness: ConformanceHarness): Promise<void> | void;
}

/** A row must state a verdict for every capability, with no gaps. */
export function assertRowIsComplete(descriptor: ProviderDescriptor): void {
	for (const capability of CAPABILITIES) {
		const verdict = descriptor.row[capability];
		assert.ok(
			verdict === 'Y' || verdict === 'Y*' || verdict === 'N',
			`${descriptor.name} states no verdict for ${capability}`,
		);
	}
	const declared = Object.keys(descriptor.row).sort();
	assert.deepEqual(
		declared,
		[...CAPABILITIES].sort(),
		`${descriptor.name} declares a row that does not match the matrix columns`,
	);
}

export interface SkipReason {
	readonly skip: true;
	readonly reason: string;
}

/** A provider runs only when explicitly opted in and its CLI is provisioned. */
export async function conformanceGate(
	descriptor: ProviderDescriptor,
): Promise<SkipReason | undefined> {
	if (process.env[descriptor.enableEnvironmentVariable] !== '1') {
		return {
			skip: true,
			reason: `set ${descriptor.enableEnvironmentVariable}=1 with an authenticated ${descriptor.name} CLI to run this`,
		};
	}
	const { spawnSync } = await import('node:child_process');
	const found = spawnSync('command', ['-v', descriptor.executable], {
		shell: '/bin/bash',
		encoding: 'utf8',
	});
	if (found.status !== 0) {
		return {
			skip: true,
			reason: `${descriptor.executable} is not on PATH`,
		};
	}
	return undefined;
}

/**
 * The whole matrix, asserted once and run for every provider. A capability
 * cannot be verified for one provider and quietly skipped for another: each
 * assertion is either exercised or explicitly asserted as unsupported.
 */
export async function runConformance(
	descriptor: ProviderDescriptor,
): Promise<void> {
	assertRowIsComplete(descriptor);
	const harness = await createConformanceHarness({
		extension: descriptor.extension,
		providerId: descriptor.providerId,
		...(descriptor.environment
			? { environment: descriptor.environment(process.cwd()) }
			: {}),
	});
	try {
		// Detect: launching the CLI normally binds a root to this exact PTY.
		await descriptor.launch(harness);
		await harness.await('the CLI to bind', (projection) => projection.bound);
		assert.equal(
			descriptor.row.detect,
			'Y',
			`${descriptor.name} bound but does not claim detection`,
		);

		// Title: a label exists before the provider has chosen one.
		await harness.await(
			'a label before the provider chose one',
			(projection) => projection.title !== undefined,
		);
		const initialTitle = harness.projection.title;

		// Working and subagents: several children, completing at different times.
		await descriptor.startSubagents(harness);
		await harness.awaitState('working');
		if (descriptor.row.subEnumerate !== 'N') {
			await harness.await(
				'subagents to be enumerated',
				(projection) => projection.children.size >= 2,
			);
			for (const child of harness.projection.children.values()) {
				assert.ok(
					child.title,
					`child ${child.id} was enumerated without a label`,
				);
			}
		} else {
			assert.equal(
				harness.projection.children.size,
				0,
				`${descriptor.name} declares Sub:Enumerate N but enumerated children`,
			);
		}
		if (descriptor.row.subStatus !== 'N') {
			await harness.await(
				'one child to complete while another still works',
				(projection) => {
					const states = [...projection.children.values()];
					return (
						states.some((child) => child.state === 'done') &&
						projection.state === 'working'
					);
				},
			);
		}

		// Done, then Idle again before the next turn.
		await harness.awaitState('done');
		assert.equal(descriptor.row.done, 'Y');

		// Title again: the provider's own title replaces the initial label.
		if (descriptor.row.title === 'Y') {
			await harness.await(
				'the provider to choose a title',
				(projection) =>
					projection.title !== undefined && projection.title !== initialTitle,
			);
		}

		// Waiting: a real outstanding input request, then its answer.
		await descriptor.requestInput(harness);
		await harness.awaitState('waiting');
		assert.equal(
			harness.projection.inferred,
			descriptor.row.waiting === 'Y*',
			`${descriptor.name} claims waiting ${descriptor.row.waiting} but reported inferred=${harness.projection.inferred}`,
		);
		await descriptor.answerInput(harness);
		await harness.awaitState('working');

		// Blocked: a real halting fault, where the provider can report one.
		if (descriptor.row.blocked !== 'N') {
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
		}

		// Resume: quitting makes the root inactive, resuming rebinds the same one.
		const rootId = harness.projection.providerSessionId;
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
		const beforeResume = harness.projection.events.length;
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
		const replayed = harness.projection.events
			.slice(0, beforeResume)
			.filter((event) => event.kind === 'session.started').length;
		assert.equal(
			harness.projection.events.filter(
				(event) => event.kind === 'session.started',
			).length,
			replayed,
			'a resume must not replay earlier transitions as new activity',
		);
	} finally {
		await harness.close();
	}
}
