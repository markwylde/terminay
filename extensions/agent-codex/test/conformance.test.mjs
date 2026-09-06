import test from 'node:test';
import { conformanceGate, runConformance } from '../../../tests/agent-conformance/index.mjs';
import extension from '../dist/index.js';

const descriptor = {
	name: 'Codex',
	extension,
	providerId: 'com.terminay.agent.codex/cli',
	enableEnvironmentVariable: 'TERMINAY_CONFORMANCE_CODEX',
	executable: 'codex',
	row: {
		detect: 'Y',
		title: 'Y',
		idle: 'Y',
		working: 'Y',
		// Codex records execution, patch and permission approval requests, and is
		// the only matrix provider recording an explicitly blocking condition.
		// Neither appears in any rollout on this machine, because every local
		// session ran with approvals bypassed: this run is what confirms them.
		// Codex shows an approval prompt on screen but persists nothing for it:
		// no rollout on record carries exec_approval_request, request_permissions
		// or request_user_input, even while the prompt was open (verified live,
		// rollout 01a0774e-f9e4-71c2-9e19-bbdb97103a09). Nothing in the journal
		// can distinguish an outstanding prompt from ordinary work.
		waiting: 'N',
		blocked: 'Y',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		resume: 'N',
	},
	async launch(harness) {
		// Approval prompting is forced on the command line so the run does not
		// depend on, or change, the developer's own `approval_policy`.
		harness.pty.send(
			'codex -a on-request -s read-only "Reply with the single word ready."',
		);
		// A directory Codex has not seen before asks for trust first; the harness
		// working directory is always new. "Yes, continue" is the default choice.
		try {
			await harness.pty.waitForOutput(/Press enter to continue/u, 30_000);
			await new Promise((resolve) => setTimeout(resolve, 500));
			harness.pty.write('\r');
		} catch {
			// No trust prompt: the CLI went straight to the conversation.
		}
	},
	startSubagents(harness) {
		harness.pty.send(
			'Use collaboration tools to spawn exactly three subagents concurrently. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Each subagent must wait a different number of seconds (5, 15, 30) before replying. Do not read, create or modify files, and do not access the network.',
		);
	},
	requestInput(harness) {
		// The sandbox is read-only, so a write inside the workspace must be
		// approved rather than run silently.
		harness.pty.send(
			'Create an empty file named needs-approval.txt in the current directory using the shell (touch). Do nothing else.',
		);
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	async provokeFault(harness) {
		harness.pty.send('/quit');
		// The CLI must have exited before the next command is typed, or the TUI
		// reads both lines as one prompt.
		await harness.await('the CLI to exit before the fault', (projection) => !projection.active);
		harness.pty.send('OPENAI_API_KEY=invalid codex "say hello"');
	},
	quit(harness) {
		harness.pty.send('/quit');
	},
	async resume(harness) {
		harness.pty.send('codex -a on-request -s read-only resume --last');
		try {
			await harness.pty.waitForOutput(/Update available|Press enter to continue/u, 15_000);
			await new Promise((resolve) => setTimeout(resolve, 400));
			harness.pty.write('2');
			await new Promise((resolve) => setTimeout(resolve, 200));
			harness.pty.write('\r');
		} catch {
			// No update interstitial.
		}
	},
};

const gate = await conformanceGate(descriptor);

test('Codex satisfies its conformance matrix row', {
	skip: gate?.reason,
	// A full matrix run drives several real model turns and subagent waits.
	timeout: 30 * 60 * 1000,
}, async () => {
	await runConformance(descriptor);
});
