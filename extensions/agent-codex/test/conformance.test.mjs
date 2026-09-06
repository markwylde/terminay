import test from 'node:test';
import { conformanceGate, runConformance } from '@terminay/agent-conformance';
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
		waiting: 'Y',
		blocked: 'Y',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		resume: 'Y',
	},
	launch(harness) {
		harness.pty.send('codex "Reply with the single word ready."');
	},
	startSubagents(harness) {
		harness.pty.send(
			'Use collaboration tools to spawn exactly three subagents concurrently. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Each subagent must wait a different number of seconds (5, 15, 30) before replying. Do not read, create or modify files, and do not access the network.',
		);
	},
	requestInput(harness) {
		harness.pty.send('Run the shell command `id`.');
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	provokeFault(harness) {
		harness.pty.send('/quit');
		harness.pty.send('OPENAI_API_KEY=invalid codex "say hello"');
	},
	quit(harness) {
		harness.pty.send('/quit');
	},
	resume(harness) {
		harness.pty.send('codex resume --last');
	},
};

const gate = await conformanceGate(descriptor);

test('Codex satisfies its conformance matrix row', {
	skip: gate?.reason,
}, async () => {
	await runConformance(descriptor);
});
