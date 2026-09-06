import test from 'node:test';
import { conformanceGate, runConformance } from '@terminay/agent-conformance';
import extension from '../dist/index.js';

const descriptor = {
	name: 'OpenCode',
	extension,
	providerId: 'com.terminay.agent.opencode/cli',
	enableEnvironmentVariable: 'TERMINAY_CONFORMANCE_OPENCODE',
	executable: 'opencode',
	row: {
		detect: 'Y',
		title: 'Y',
		idle: 'Y',
		working: 'Y',
		// A tool part is recorded pending while it waits for approval.
		waiting: 'Y',
		// OpenCode records no explicitly blocking condition, so a halting fault
		// is derived from an assistant error with no completion following.
		blocked: 'Y*',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		resume: 'Y',
	},
	launch(harness) {
		harness.pty.send('opencode "Reply with the single word ready."');
	},
	startSubagents(harness) {
		harness.pty.send(
			'Start three subagents concurrently with the task tool. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Each must wait a different number of seconds (5, 15, 30) before replying. Do not read, create or modify files.',
		);
	},
	requestInput(harness) {
		harness.pty.send('Run the shell command `id` with the bash tool.');
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	provokeFault(harness) {
		harness.pty.send('/exit');
		harness.pty.send(
			'OPENAI_API_KEY=invalid ANTHROPIC_API_KEY=invalid opencode "say hello"',
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
}, async () => {
	await runConformance(descriptor);
});
