import test from 'node:test';
import { conformanceGate, runConformance } from '@terminay/agent-conformance';
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
	launch(harness) {
		// The first turn is passed as an argument: typing a long line after the
		// CLI switches screen modes can race its own input handling.
		harness.pty.send(
			'claude --permission-mode default "Reply with the single word ready."',
		);
	},
	startSubagents(harness) {
		harness.pty.send(
			'Start three subagents concurrently with the Agent tool. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Each must wait a different number of seconds (5, 15, 30) before replying. Do not read, create or modify files.',
		);
	},
	requestInput(harness) {
		// A tool this session must ask permission for, in a mode that prompts.
		harness.pty.send('Run the shell command `id` using the Bash tool.');
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	provokeFault(harness) {
		// A deliberately invalid credential in this disposable session makes the
		// next turn fail without touching the developer's real account.
		harness.pty.send('/exit');
		harness.pty.send('ANTHROPIC_API_KEY=invalid claude "say hello"');
	},
	quit(harness) {
		harness.pty.write(ESCAPE);
		harness.pty.send('/exit');
	},
	resume(harness) {
		harness.pty.send('claude --continue');
	},
};

const gate = await conformanceGate(descriptor);

test('Claude Code satisfies its conformance matrix row', {
	skip: gate?.reason,
}, async () => {
	await runConformance(descriptor);
});
