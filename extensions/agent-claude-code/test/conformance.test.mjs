import test from 'node:test';
import {
	conformanceGate,
	runConformance,
} from '../../../tests/agent-conformance/index.mjs';
import extension from '../dist/index.js';

const ESCAPE = '';

/**
 * The cheapest model this CLI still supports. `claude --help` documents
 * `--model` as taking "an alias for the latest model", and the 2.1.x CLI's own
 * alias set is `sonnet | opus | haiku | fable | best | opusplan` plus the
 * `[1m]` variants; `haiku` resolves to Claude Haiku 4.5, the lowest-priced
 * model in the CLI's model table. Every prompt in this run is trivial — "reply
 * with the single word ready", "run sleep 5" — so nothing here needs more, and
 * every run spends real money.
 */
const MODEL = 'haiku';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts one ordinary interactive session and answers the folder-trust prompt.
 * The first session and the concurrent second one launch through exactly this,
 * because the case two terminals in one repository produce is two ordinary
 * sessions, not one session and a special mode.
 */
async function startSession(harness) {
	// The first turn is passed as an argument: typing a long line after the
	// CLI switches screen modes can race its own input handling.
	// `sleep` is pre-allowed so the subagent step needs no approval, while
	// every other command still prompts for the waiting step. Both are launch
	// flags of this one process, not configuration changes. `--allowedTools`
	// is variadic, so the prompt must come before it.
	harness.pty.send(
		`claude --model ${MODEL} --permission-mode default "Reply with the single word ready." --allowedTools "Bash(sleep:*)"`,
	);
	// A directory Claude Code has not seen before asks for trust first; the
	// harness working directory is always new. Choose "Yes, I trust this
	// folder" (the second option) if the prompt appears. The second session
	// works in a directory the first already trusted, so it usually sees no
	// prompt and falls straight through.
	try {
		await harness.pty.waitForOutput(/I trust this folder/u, 30_000);
	} catch {
		// No trust prompt: the CLI went straight to the conversation.
		return;
	}
	// The prompt is a keypress-driven menu: give it the arrow before Enter.
	await pause(500);
	harness.pty.write('\x1b[B');
	await pause(500);
	harness.pty.write('\r');
	await pause(1_000);
}

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
		// A halting fault is not derived: the CLI writes it into the journal as
		// an assistant record carrying `isApiErrorMessage` with the HTTP status
		// and error code, and the provider publishes the block straight from
		// that record. Verified against the real CLI, whose journal recorded
		// `"error":"model_not_found","isApiErrorMessage":true,"apiErrorStatus":404`
		// for the fault this row's gesture provokes. It was previously stated as
		// `Y*`, which the run disproved: nothing about the block is inferred.
		blocked: 'Y',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		resume: 'Y',
	},
	launch(harness) {
		return startSession(harness);
	},
	/**
	 * A second, independent `claude` in the same working directory: the
	 * ordinary case of one repository open in two terminals. Nothing about it
	 * is special-cased — it is the same gesture as `launch`, so each session
	 * must be told apart by what the provider can observe rather than by how it
	 * was started.
	 */
	secondLaunch(harness) {
		return startSession(harness);
	},
	startSubagents(harness) {
		// The children only have to start together, finish at different times and
		// carry distinguishable labels; the staggered sleeps are what produce
		// that, so they are the whole task. An earlier version also gave each
		// child a sum to compute, and a real run showed why that is a trap: a
		// child reached for `python3 -c ...` to do the arithmetic, which is not
		// covered by the `Bash(sleep:*)` allowance, so it stopped on a permission
		// prompt nobody was going to answer and the root never completed. Asking
		// for nothing but the sleep leaves no arithmetic to reach for a tool
		// over, and the allowance still covers every command the step needs.
		harness.pty.send(
			'Start three subagents concurrently with the Agent tool. Name them short-wait, medium-wait and long-wait. Each must run exactly one shell command — `sleep 5`, `sleep 15` and `sleep 30` respectively — and then reply with its own name. Run no other command: no python, no arithmetic, no echo. Use no other tools. Do not read, create or modify files.',
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
		await harness.await(
			'the CLI to exit before the fault',
			(projection) => !projection.active,
		);
		// The fault is a model the API rejects. The 404 lands inside a started
		// turn and the CLI records it as an assistant record carrying
		// `"isApiErrorMessage":true,"apiErrorStatus":404,"error":"model_not_found"`
		// — a halting fault, read from an explicit record rather than derived.
		//
		// It has to be provoked in print mode. Verified against this CLI: an
		// interactive session writes a `turn_duration` record 3ms after that
		// error (measured: error at 06:06:04.044Z, turn_duration at
		// 06:06:04.047Z), which completes the turn and supersedes the block, so
		// the blocked state exists on disk for three milliseconds and no
		// observer polling a live session can ever see it. Print mode records
		// the same fault and then exits, writing no `turn_duration` at all, so
		// the block is the session's last word and stays visible.
		//
		// One print-mode process lives under two seconds, and its journal only
		// becomes bindable about a second in, so the gesture is repeated: each
		// run is an independent session that ends blocked, and the observer gets
		// several chances to see one rather than one chance to miss it.
		harness.pty.send(
			'for attempt in 1 2 3; do claude --model not-a-real-model -p "say hello"; done',
		);
	},
	quit(harness) {
		harness.pty.write(ESCAPE);
		harness.pty.send('/exit');
	},
	/**
	 * Resume by native session id rather than through the picker. A second
	 * session has run in this directory by now, and the picker's first entry is
	 * the most recent conversation there — which is the other session's, not
	 * this root's. Naming the id resumes the session the step is about, and is
	 * the gesture a user takes from `/resume <id>` or a session list.
	 *
	 * The id defaults to this harness's own session, and is passed explicitly by
	 * the resume-while-another-runs step, which drives a third terminal that has
	 * no binding of its own yet.
	 */
	resume(harness, providerSessionId = harness.projection.providerSessionId) {
		harness.pty.send(`claude --model ${MODEL} --resume ${providerSessionId}`);
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
