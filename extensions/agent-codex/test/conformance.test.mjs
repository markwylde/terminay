import test from 'node:test';
import { conformanceGate, runConformance } from '../../../tests/agent-conformance/index.mjs';
import extension from '../dist/index.js';

/**
 * The prompts in this matrix are trivial — arithmetic, one word back, one
 * `touch` — so the run buys nothing from a larger model or deeper reasoning.
 *
 * `gpt-5.6-luna` is the cheapest tier Codex will still start: it is the
 * "fast and affordable agentic coding model" in the CLI's own model list, and
 * it drives the collaboration tools the subagent step needs. The cheaper
 * `gpt-5.4-mini` was tried first and is unusable — the CLI answers `-m
 * gpt-5.4-mini` with a blocking "GPT-5.4 Mini is no longer available, Codex
 * now uses GPT-5.6 Luna in place of it" migration dialog before the TUI ever
 * accepts a prompt. `model_reasoning_effort=low` is the lowest effort Luna
 * publishes (its own `supported_reasoning_levels` start at `low`; there is no
 * `minimal` tier), and it still follows the subagent instructions.
 *
 * The feature flags the collaboration tools live behind (`multi_agent`,
 * `unified_exec`) are already on by default in a home with no config, so
 * nothing here turns them on: `codex features list` under an empty CODEX_HOME
 * reports both `stable true`.
 */
const MODEL = '-m gpt-5.6-luna -c model_reasoning_effort="low"';

/**
 * Approval prompting and the sandbox are forced on the command line so the run
 * does not depend on, or change, the developer's own `approval_policy`.
 */
const FLAGS = `-a on-request -s read-only ${MODEL}`;

/**
 * A directory Codex has not seen before asks for trust first, and the harness
 * working directory is always new. "Yes, continue" is the default choice.
 */
async function acceptTrustPrompt(harness) {
	try {
		await harness.pty.waitForOutput(/Press enter to continue/u, 30_000);
		await new Promise((resolve) => setTimeout(resolve, 500));
		harness.pty.write('\r');
	} catch {
		// No trust prompt: the CLI went straight to the conversation.
	}
}

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
		// Codex shows an approval prompt on screen but persists nothing for it:
		// no rollout on record carries exec_approval_request, request_permissions
		// or request_user_input, even while the prompt was open (verified live,
		// rollout 01a0774e-f9e4-71c2-9e19-bbdb97103a09). Nothing in the journal
		// can distinguish an outstanding prompt from ordinary work.
		waiting: 'N',
		// Codex records a halting fault as the *completion* of the turn it
		// halted, not as a state the session sits in. A request the API rejects
		// is written as `event_msg task_complete` carrying an `error` object —
		// `{"type":"task_complete","last_agent_message":null,"error":{"message":
		// "unexpected status 404 Not Found: The model `not-a-real-model` does not
		// exist…"}}` (rollout 01a07a81-44eb-75b1-91b0-297986d8d972, codex-cli
		// 0.153.4). The turn ends, the CLI returns to its prompt, and the mapping
		// publishes done/error, which is what happened. No rollout record on file
		// says the session is waiting for a human, so nothing can honestly raise
		// a blocked wait, and this extension has never published one.
		blocked: 'N',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		// `codex resume <id>` re-opens the *same* rollout file and holds it open
		// read-write for the life of the process, so the ordinary
		// writable-file-below-this-terminal rule rebinds the same root. Measured
		// on codex-cli 0.153.4: after `/quit`, `codex resume <id>` reopened
		// rollout 01a07a75-5ce6-7121-a21c-94ccbf372339 (unchanged session id,
		// unchanged path, `lsof` access `u`) and appended the next turn to it.
		// The earlier `N` reason — that a restored CLI holds no writable rollout
		// — no longer describes the CLI.
		resume: 'Y',
	},
	async launch(harness) {
		harness.pty.send(`codex ${FLAGS} "Reply with the single word ready."`);
		await acceptTrustPrompt(harness);
	},
	/**
	 * A second, independent Codex in the same working directory. It carries its
	 * own first prompt so the session has a rollout to bind to without waiting
	 * on the harness to speak first.
	 */
	async secondLaunch(harness) {
		harness.pty.send(`codex ${FLAGS} "Reply with the single word two."`);
		await acceptTrustPrompt(harness);
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
		// Retained for the day Codex persists a blocking record; with `blocked:
		// 'N'` the harness does not call it. Note that this exact gesture no
		// longer reaches the API at all in the conformance image: the container
		// authenticates with `codex login --with-api-key`, and a stored
		// `auth.json` takes precedence over `OPENAI_API_KEY`, so the invalid key
		// is ignored and the turn succeeds (measured on codex-cli 0.153.4). The
		// gesture that does provoke a recorded fault is a model the API rejects,
		// `codex -m not-a-real-model "say hello"`.
		harness.pty.send('OPENAI_API_KEY=invalid codex "say hello"');
	},
	quit(harness) {
		harness.pty.send('/quit');
	},
	async resume(harness) {
		// Resume this terminal's own session by id rather than `--last`: by this
		// point a second session has run in the same directory and is the most
		// recent one, so `--last` would restore the wrong conversation.
		const seen = harness.pty.plainOutput().length;
		harness.pty.send(`codex ${FLAGS} resume ${harness.projection.providerSessionId}`);
		// Only output this command produces may be answered. Matching the whole
		// buffer would find the launch's own trust prompt, still in scrollback,
		// and type the answer into the restored conversation as a message.
		const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		for (let waited = 0; waited < 30_000; waited += 500) {
			await pause(500);
			const fresh = harness.pty.plainOutput().slice(seen);
			if (/Update available/u.test(fresh)) {
				// "Skip", so the run keeps the CLI the image installed.
				harness.pty.write('2');
				await pause(200);
				harness.pty.write('\r');
				return;
			}
			if (/Ask Codex to do anything/u.test(fresh)) return;
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
