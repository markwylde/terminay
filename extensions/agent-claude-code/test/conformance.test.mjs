import test from 'node:test';
import { conformanceGate, runConformance } from '../../../tests/agent-conformance/index.mjs';
import extension from '../dist/index.js';

const ESCAPE = '';

/**
 * Claude Code's conformance descriptor. Only provider-specific gestures live
 * here; every capability assertion comes from the shared harness, so a
 * capability cannot be checked for one provider and skipped for another.
 */
const descriptor = {
	name: 'Claude Code',
	extension,
	providerId: 'com.terminay.agent.claude-code/cli',
	enableEnvironmentVariable: 'TERMINAY_CONFORMANCE_CLAUDE_CODE',
	executable: 'claude',
	row: {
		detect: 'Y',
		title: 'Y',
		idle: 'Y',
		working: 'Y',
		// Claude Code writes nothing while a permission prompt is open, so
		// waiting is derived from silence inside an open turn.
		waiting: 'Y*',
		blocked: 'Y*',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		resume: 'Y',
	},
	async launch(harness) {
		// The first turn is passed as an argument: typing a long line after the
		// CLI switches screen modes can race its own input handling.
		// `sleep` is pre-allowed so the subagent step needs no approval, while
		// every other command still prompts for the waiting step. Both are launch
		// flags of this one process, not configuration changes. `--allowedTools`
		// is variadic, so the prompt must come before it.
		harness.pty.send(
			'claude --permission-mode default "Reply with the single word ready." --allowedTools "Bash(sleep:*)"',
		);
		// A directory Claude Code has not seen before asks for trust first; the
		// harness working directory is always new. Choose "Yes, I trust this
		// folder" (the second option) if the prompt appears.
		try {
			await harness.pty.waitForOutput(/I trust this folder/u, 30_000);
		} catch {
			// No trust prompt: the CLI went straight to the conversation.
			return;
		}
		// The prompt is a keypress-driven menu: give it the arrow before Enter.
		const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		await pause(500);
		harness.pty.write('\x1b[B');
		await pause(500);
		harness.pty.write('\r');
		await pause(1_000);
	},
	startSubagents(harness) {
		harness.pty.send(
			'Start three subagents concurrently with the Agent tool. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Each must wait by running exactly one shell command, `sleep 5`, `sleep 15` and `sleep 30` respectively, then reply with its answer. Use no other tools. Do not read, create or modify files.',
		);
	},
	requestInput(harness) {
		// Read-only commands such as `id` are auto-approved by the CLI, so the
		// request must be a write: creating a file in the working directory needs
		// approval in the default permission mode.
		harness.pty.send(
			'Create an empty file named needs-approval.txt in the current directory using the Bash tool (touch). Do nothing else.',
		);
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	async provokeFault(harness) {
		// A deliberately unusable request in this disposable session makes the
		// next turn fail without touching the developer's real account. The CLI
		// must have actually exited before the next command is typed, or Claude
		// reads both lines as one prompt.
		harness.pty.write(ESCAPE);
		harness.pty.send('/exit');
		await harness.await('the CLI to exit before the fault', (projection) => !projection.active);
		// An API key in the environment makes Claude ask whether to use it before
		// any journal exists, so the fault is a model the API rejects instead:
		// the 404 is recorded as an assistant record with isApiErrorMessage.
		harness.pty.send('claude --model not-a-real-model "say hello"');
	},
	quit(harness) {
		harness.pty.write(ESCAPE);
		harness.pty.send('/exit');
	},
	async resume(harness) {
		harness.pty.send('claude --resume');
		const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		await pause(800);
		harness.pty.write('\r');
	},
};

const gate = await conformanceGate(descriptor);

test('Claude Code satisfies its conformance matrix row', {
	skip: gate?.reason,
	// A full matrix run drives several real model turns and subagent waits.
	timeout: 30 * 60 * 1000,
}, async () => {
	await runConformance(descriptor);
});
