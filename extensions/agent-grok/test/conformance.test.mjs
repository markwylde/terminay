import test from 'node:test';
import { conformanceGate, runConformance } from '@terminay/agent-conformance';
import extension from '../dist/index.js';

const descriptor = {
	name: 'Grok',
	extension,
	providerId: 'com.terminay.agent.grok/cli',
	enableEnvironmentVariable: 'TERMINAY_CONFORMANCE_GROK',
	executable: 'grok',
	row: {
		detect: 'Y',
		title: 'Y',
		idle: 'Y',
		working: 'Y',
		// Grok records permission_requested / permission_resolved explicitly.
		waiting: 'Y',
		// It records no explicitly blocking condition, so a halting fault is
		// derived from its own recorded fault with no turn_ended following.
		blocked: 'Y*',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		resume: 'Y',
	},
	launch(harness) {
		harness.pty.send('grok "Reply with the single word ready."');
	},
	startSubagents(harness) {
		harness.pty.send(
			'Spawn three subagents concurrently. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Each must wait a different number of seconds (5, 15, 30) before replying. Do not read, create or modify files.',
		);
	},
	requestInput(harness) {
		// run_terminal_command asks for permission unless it is pre-approved.
		harness.pty.send('Run the shell command `id`.');
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	provokeFault(harness) {
		harness.pty.send('/exit');
		harness.pty.send('GROK_API_KEY=invalid grok "say hello"');
	},
	quit(harness) {
		harness.pty.send('/exit');
	},
	resume(harness) {
		harness.pty.send('grok --continue');
	},
};

const gate = await conformanceGate(descriptor);

test('Grok satisfies its conformance matrix row', {
	skip: gate?.reason,
}, async () => {
	await runConformance(descriptor);
});
