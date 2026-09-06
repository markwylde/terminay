import test from 'node:test';
import { conformanceGate, runConformance } from '../../../tests/agent-conformance/index.mjs';
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../dist/index.js';

/**
 * Grok honours `permission_mode` from its config file over the command-line
 * flag: with `always-approve` configured, a write was resolved `allow` in 1ms
 * on record. The run therefore gets its own GROK_HOME carrying only the
 * developer's credentials and trust decisions, with prompting configured,
 * so nothing in the developer's home is read for permissions or changed.
 */
function isolatedGrokHome() {
	const source = process.env.GROK_HOME?.trim() || join(homedir(), '.grok');
	const home = mkdtempSync(join(tmpdir(), 'terminay-conformance-grok-home-'));
	for (const name of ['auth.json', 'trusted_folders.toml', 'version.json', 'models_cache.json']) {
		if (existsSync(join(source, name))) copyFileSync(join(source, name), join(home, name));
	}
	writeFileSync(
		join(home, 'config.toml'),
		'[ui]\npermission_mode = "default"\n\n[privacy]\nprivacy_banner_acked = "2026-08-29T12:33:17Z"\n',
	);
	return home;
}

const descriptor = {
	name: 'Grok',
	extension,
	providerId: 'com.terminay.agent.grok/cli',
	enableEnvironmentVariable: 'TERMINAY_CONFORMANCE_GROK',
	executable: 'grok',
	environment: () => ({ GROK_HOME: isolatedGrokHome() }),
	row: {
		detect: 'Y',
		title: 'Y',
		idle: 'Y',
		working: 'Y',
		// Grok records permission_requested / permission_resolved explicitly.
		waiting: 'Y',
		// Grok records no fault distinct from a turn outcome: a failed turn is a
		// turn_ended carrying an error, which is a completion and not a blocking
		// condition. Verified against every rollout on this machine.
		blocked: 'N',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		resume: 'Y',
	},
	launch(harness) {
		// The prompting mode is forced on the command line so the run does not
		// depend on, or change, the developer's own `permission_mode`.
		//
		// `--allow 'Bash(sleep *)'` pre-approves only the shell command the
		// subagents use to wait. Without it the children's `run_terminal_command`
		// calls sit on a permission prompt nobody answers during the subagent
		// step, and the parent's own subagent-output poll queues behind them.
		// `spawn_subagent` needs no rule: it is resolved without prompting in
		// every rollout on record. Every other shell command — the `touch` the
		// waiting step asks for — still prompts, which is what that step needs.
		harness.pty.send(
			`grok --permission-mode default --allow 'Bash(sleep *)' "Reply with the single word ready."`,
		);
	},
	startSubagents(harness) {
		// The wait has to be one unchained `sleep <n>` and nothing else: Grok's
		// allow rules are conjunctive across the segments of a chained command,
		// so `sleep 5 && echo $((17 * 19))` would not match `Bash(sleep *)` and
		// would prompt. The arithmetic is therefore done without a tool.
		harness.pty.send(
			'Spawn three subagents concurrently. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Tell each one to work the arithmetic out in its head and to wait before replying by running exactly one shell command: `sleep 5` for the first, `sleep 15` for the second, `sleep 30` for the third. That single sleep must be the whole command — no other command, no `&&`, `;` or pipe, no extra arguments. Do not read, create or modify files.',
		);
	},
	requestInput(harness) {
		// A file write through Grok's own file tool asks for permission in the
		// default mode. A shell `touch` does not: Grok resolved it `allow` in 1ms
		// on record, so the shell is not a reliable prompt.
		// Creating a file inside the working directory was also resolved `allow`
		// without a prompt, so the gesture is a deletion, which Grok classifies
		// as destructive and asks about.
		harness.pty.send(
			'Create an empty file named needs-approval.txt, then delete it with the shell command `rm needs-approval.txt`. Do nothing else.',
		);
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	quit(harness) {
		harness.pty.send('/exit');
	},
	resume(harness) {
		harness.pty.send(
			`grok --permission-mode default --allow 'Bash(sleep *)' --continue`,
		);
	},
};

const gate = await conformanceGate(descriptor);

test('Grok satisfies its conformance matrix row', {
	skip: gate?.reason,
	// A full matrix run drives several real model turns and subagent waits.
	timeout: 30 * 60 * 1000,
}, async () => {
	await runConformance(descriptor);
});
