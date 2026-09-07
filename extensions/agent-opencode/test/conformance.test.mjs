import test from 'node:test';
import {
	conformanceGate,
	runConformance,
} from '../../../tests/agent-conformance/index.mjs';
import extension from '../dist/index.js';

const ESCAPE = '\u001b';
const CTRL_C = '\u0003';
const CTRL_U = '\u0015';

const pause = (ms) =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});

/**
 * The cheapest model OpenCode offers on the credential this run has.
 *
 * `opencode --help` gives `-m, --model provider/model`, but the flag only
 * covers the process it is passed to; the run also drives `--session` and the
 * task tool's own child agents, so the choice is made in
 * `OPENCODE_CONFIG_CONTENT` instead, where it reaches every process and every
 * subagent.
 *
 * OpenCode's own OpenAI catalogue (`opencode models openai`, 1.18.29) is a
 * curated subset that excludes the older nano models, and of what it does
 * offer `gpt-5.6-luna` is the cheapest tool-calling model at $0.20/$1.20 per
 * million tokens (models.dev), against $0.75/$4.50 for `gpt-5.4-mini` and
 * $1/$5 for `claude-haiku-4-5`, the cheapest on the Anthropic key. `small_model`
 * is set to the same model so OpenCode's title generation — which the matrix's
 * title step depends on — does not silently reach for a larger one.
 */
const MODEL = 'openai/gpt-5.6-luna';

/** Every live `opencode` process below the harness shell. */
const cliRunning = (harness) =>
	harness.pty.descendants().some((entry) => entry.name === 'opencode');

/**
 * Closes the TUI.
 *
 * `/exit` is a slash command typed into the composer, so it only takes when the
 * composer is empty and no popup owns the keyboard: Escape dismisses whatever
 * is open and Ctrl+U clears anything half-typed before the command is sent. If
 * the CLI is still up afterwards it is interrupted the way a user would, with
 * Ctrl+C, rather than left running into the next gesture.
 */
async function exitCli(harness) {
	harness.pty.write(ESCAPE);
	await pause(400);
	harness.pty.write(CTRL_U);
	await pause(400);
	harness.pty.send('/exit');
	for (let waited = 0; waited < 20_000; waited += 500) {
		await pause(500);
		if (!cliRunning(harness)) return;
	}
	harness.pty.write(CTRL_C);
	await pause(1_500);
	if (!cliRunning(harness)) return;
	harness.pty.write(CTRL_C);
	await pause(1_500);
}

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
			model: MODEL,
			small_model: MODEL,
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
	/**
	 * A second, independent OpenCode session in the same working directory.
	 * Nothing is passed that would join the first: a plain launch with its own
	 * prompt is exactly how a developer opens a second terminal in one
	 * repository, and OpenCode makes a new root session for it.
	 */
	secondLaunch(harness) {
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
		await exitCli(harness);
		// The CLI must have exited before the next command is typed.
		await harness.await(
			'the CLI to exit before the fault',
			(projection) => !projection.active,
		);
		harness.pty.send(
			// `--prompt` runs the turn inside the TUI, which stays up after the
			// turn fails. `opencode run` would exit within a second or two of the
			// rejected key and could be gone before the observation loop's next
			// poll, leaving nothing to read the fault from.
			'OPENAI_API_KEY=invalid ANTHROPIC_API_KEY=invalid opencode --prompt "say hello"',
		);
	},
	async quit(harness) {
		await exitCli(harness);
	},
	resume(harness) {
		// Not `--continue`: that reopens the most recently updated session in the
		// directory, which after the two-concurrent-sessions step is the *second*
		// terminal's session, not this one's. `--session` names the root this
		// terminal actually had.
		harness.pty.send(
			`opencode --session ${harness.projection.providerSessionId}`,
		);
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
