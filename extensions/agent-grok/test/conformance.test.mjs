import test from 'node:test';
import { conformanceGate, runConformance } from '../../../tests/agent-conformance/index.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../dist/index.js';

/**
 * The model every gesture runs on.
 *
 * The CLI only accepts a model the API offers, and `grok models` advertises
 * just `grok-4.6` (default) and `grok-4.5`. Both are xAI's top tier at
 * $0.20/$0.60 per million tokens; `grok-4.20-*` and `grok-4.3` are the cheaper
 * generally-available tier at $0.125/$0.25, and `grok-code-fast-1` — cheaper
 * still — is rejected by the CLI with "unknown model id".
 *
 * `grok-4.3` is therefore the cheapest model this CLI will actually run, at a
 * bit over a third of the default's output price. It was checked against the
 * one prompt in this suite that needs real instruction-following, the subagent
 * fan-out: it spawned all three subagents concurrently, gave each the
 * arithmetic it was told to, and ran exactly one unchained `sleep` in each.
 * The suite's other prompts are trivial ("reply with the word ready").
 *
 * No `--reasoning-effort`: this model does not take one. Passing it makes the
 * CLI print "--effort/--reasoning-effort: current model does not support
 * reasoning effort" on every launch and changes nothing. grok-4.3 deliberates
 * for a fraction of a second on these prompts as it is ("Thought for 0.2s"),
 * so there is no reasoning spend left to cut.
 */
const MODEL = '--model grok-4.3';

/**
 * Grok honours `permission_mode` from its config file over the command-line
 * flag: with `always-approve` configured, a write was resolved `allow` in 1ms
 * on record. The run therefore gets its own GROK_HOME with prompting
 * configured, so nothing in the developer's home is read or changed.
 *
 * The home carries no credential. Grok resolves a credential in the order
 * per-model key, then a `grok login` session token, then `XAI_API_KEY` — so an
 * empty home falls through to the key, which is the only way these runs
 * authenticate. A developer's session token is never copied in and never used:
 * a run must be reproducible in a container, and must not spend a real login.
 *
 * The `[permission]` rules are what make the run reproducible away from a
 * developer's machine. Grok reads Claude Code's `~/.claude/settings.json` as a
 * permission source, and a developer whose settings say
 * `"defaultMode": "bypassPermissions"` never sees a prompt for anything —
 * which is why every rollout on this machine showed `spawn_subagent` resolved
 * in 1ms. In a container's empty home nothing is pre-approved, and
 * `spawn_subagent` prompts: recorded as
 * `permission_requested spawn_subagent` followed by
 * `permission_resolved decision=cancelled`, turn outcome
 * `permission_cancelled`. So:
 *
 * - `allow = ["*"]` pre-approves the tools the run has no gesture to answer
 *   for — `spawn_subagent` above all. Grok's rule grammar recognises only
 *   `Bash`, `Read`, `Edit`/`Write`, `Grep`/`Glob`, `MCPTool`, `WebFetch`,
 *   `WebSearch` and a bare `*` in the tool-name position, so there is no
 *   narrower rule that can name `spawn_subagent`; a rule that named it would
 *   be skipped with a warning.
 * - `ask = ["Bash(echo needs-approval)"]` puts the one prompt this suite must
 *   observe back. Rules are evaluated by severity, `deny` > `ask` > `allow`, so
 *   this beats the catch-all allow, and an `ask` rule prompts even for a shell
 *   command Grok would otherwise treat as read-only. The rule names one exact
 *   command because the waiting step has a single answering gesture: anything
 *   broader risks a second prompt with nobody left to answer it.
 *
 * The home is shared by every session in a run. Two concurrent Grok CLIs in
 * one developer's repository share one `~/.grok`: one leader socket, one
 * `active_sessions.json` registry, one session store. Giving each harness its
 * own home would leave the concurrency step asserting nothing, because the two
 * sessions could not be confused in the first place.
 */
let sharedHome;
function isolatedGrokHome() {
	if (!process.env.XAI_API_KEY?.trim())
		throw new Error(
			'XAI_API_KEY is required: Grok conformance authenticates by API key, never by a copied login session',
		);
	if (sharedHome) return sharedHome;
	sharedHome = mkdtempSync(join(tmpdir(), 'terminay-conformance-grok-home-'));
	writeFileSync(
		join(sharedHome, 'config.toml'),
		[
			'[ui]',
			'permission_mode = "default"',
			'',
			'[privacy]',
			'privacy_banner_acked = "2026-08-29T12:33:17Z"',
			'',
			'[permission]',
			'allow = ["*"]',
			'ask = ["Bash(echo needs-approval)"]',
			'',
		].join('\n'),
	);
	return sharedHome;
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
		// depend on, or change, the developer's own `permission_mode`. The
		// permission rules that make this reproducible live in the config file
		// this run writes; see `isolatedGrokHome`.
		harness.pty.send(
			`grok ${MODEL} --permission-mode default "Reply with the single word ready."`,
		);
	},
	// A second, independent Grok in the same directory and the same GROK_HOME:
	// one leader, one active-session registry, two PTYs. No `--continue` and no
	// `--session-id`, so Grok mints a fresh session the way a second terminal
	// would.
	secondLaunch(harness) {
		harness.pty.send(
			`grok ${MODEL} --permission-mode default "Reply with the single word ready."`,
		);
	},
	startSubagents(harness) {
		// The wait is one unchained `sleep <n>` and nothing else. Grok's allow
		// rules are conjunctive across the segments of a chained command, so a
		// narrower rule than the catch-all would not match `sleep 5 && echo …`;
		// keeping the command simple also keeps the recorded shape readable, and
		// the arithmetic is done without a tool.
		harness.pty.send(
			'Spawn three subagents concurrently. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Tell each one to work the arithmetic out in its head and to wait before replying by running exactly one shell command: `sleep 5` for the first, `sleep 15` for the second, `sleep 30` for the third. That single sleep must be the whole command — no other command, no `&&`, `;` or pipe, no extra arguments. Do not read, create or modify files.',
		);
	},
	requestInput(harness) {
		// One tool call, so one prompt. The `ask` rule is what makes it a prompt;
		// nothing about the command itself has to be dangerous, which is why this
		// asks for a bare `echo` rather than the create-then-delete pair an
		// earlier revision used. That pair drove two shell calls, and a run that
		// raised a second prompt hung: the matrix answers exactly once and then
		// waits for `done`, and the recorded failure was
		// "timed out waiting for state done. state=waiting".
		harness.pty.send(
			'Run exactly the shell command `echo needs-approval` and nothing else, then reply with the single word approved.',
		);
	},
	// Enter is the wrong key here. Grok's permission prompt puts
	// "Yes, and don't ask again for anything (always-approve mode)" on the first
	// row and preselects it, so a bare `\r` answers the request by switching the
	// whole session to always-approve — the state this run exists to avoid, and
	// a mode change the rest of the run would inherit.
	//
	// The rows are numbered and a digit selects one, so the answer is read off
	// the screen rather than assumed: the numbers move, because the
	// "Always allow" and "Never allow" rows only appear when Grok has something
	// rememberable to offer. "Always allow: <command>" is preferred over
	// "Yes, proceed" — both approve this call, and remembering it means a model
	// that re-issues the same command does not raise a second prompt that
	// nothing is left to answer. With no prompt on screen (the resume step calls
	// this too) the gesture is a bare Enter, as before.
	answerInput(harness) {
		if (harness.projection.state !== 'waiting') {
			harness.pty.write('\r');
			return;
		}
		// The last match is this prompt's: an earlier one is further up the
		// scrollback. A spinner redraws between the options and the tail of the
		// buffer, so the whole output is searched rather than a fixed slice.
		const rowFor = (label) =>
			[...harness.pty.plainOutput().matchAll(label)].at(-1)?.[1];
		const row =
			rowFor(/(\d)\s*\([^)]*\)\s*Always allow:/gu) ??
			rowFor(/(\d)\s*\([^)]*\)\s*Yes, proceed/gu);
		harness.pty.write(row ?? '\r');
	},
	quit(harness) {
		harness.pty.send('/exit');
	},
	resume(harness) {
		// Not `--continue`: the second session was started in this same directory
		// and this same home, and `--continue` takes the most recent session for
		// the directory, which would rebind the wrong one. The session is named
		// explicitly so the resume is unambiguous.
		const sessionId = harness.projection.providerSessionId;
		harness.pty.send(
			`grok ${MODEL} --permission-mode default --resume ${sessionId}`,
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
