import test from 'node:test';
import { conformanceGate, runConformance } from '../../../tests/agent-conformance/index.mjs';
import extension from '../dist/index.js';

const descriptor = {
	name: 'OpenCode',
	extension,
	providerId: 'com.terminay.agent.opencode/cli',
	enableEnvironmentVariable: 'TERMINAY_CONFORMANCE_OPENCODE',
	executable: 'opencode',
	// Approval prompting is forced through OpenCode's own environment override
	// so the run does not depend on, or change, the developer's config file.
	// `sleep` and spawning tasks are allowed so the subagent step needs no
	// approval; every other shell command still asks.
	environment: () => ({
		OPENCODE_CONFIG_CONTENT: JSON.stringify({
			// OpenCode evaluates bash rules in order and the last match wins (its
			// log shows `sleep 5` resolved by `*`), so the catch-all comes first.
			permission: { bash: { '*': 'ask', 'sleep *': 'allow' }, task: 'allow' },
		}),
	}),
	row: {
		detect: 'Y',
		title: 'Y',
		idle: 'Y',
		working: 'Y',
		// OpenCode persists no record of a permission request: its `permission`
		// table is empty, no permission event type exists, and every tool part is
		// first written `pending` whether or not a prompt is shown. Verified on a
		// real store (6,901 pending parts across every tool). Nothing in the
		// store can distinguish a prompt from ordinary streaming.
		waiting: 'N',
		// OpenCode records no explicitly blocking condition, so a halting fault
		// is derived from an assistant error with no completion following.
		blocked: 'Y*',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		resume: 'Y',
	},
	launch(harness) {
		harness.pty.send('opencode --prompt "Reply with the single word ready."');
	},
	startSubagents(harness) {
		harness.pty.send(
			'Start three subagents concurrently with the task tool. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Each must wait by running exactly one shell command, `sleep 5`, `sleep 15` and `sleep 30` respectively, then reply with its answer. Use no other tools. Do not read, create or modify files.',
		);
	},
	requestInput(harness) {
		harness.pty.send(
			'Create an empty file named needs-approval.txt in the current directory with the bash tool (touch). Do nothing else.',
		);
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	async provokeFault(harness) {
		harness.pty.send('/exit');
		// The CLI must have exited before the next command is typed.
		await harness.await('the CLI to exit before the fault', (projection) => !projection.active);
		harness.pty.send(
			// A bare argument is a directory to OpenCode, so the prompt goes through
			// `run`, which is non-interactive and exits after the failed turn.
			'OPENAI_API_KEY=invalid ANTHROPIC_API_KEY=invalid opencode run "say hello"',
		);
	},
	quit(harness) {
		harness.pty.send('/exit');
	},
	resume(harness) {
		harness.pty.send('opencode --continue');
	},
};

const gate = await conformanceGate(descriptor);

test('OpenCode satisfies its conformance matrix row', {
	skip: gate?.reason,
	// A full matrix run drives several real model turns and subagent waits.
	timeout: 30 * 60 * 1000,
}, async () => {
	await runConformance(descriptor);
});
