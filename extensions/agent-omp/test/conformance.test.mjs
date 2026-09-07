import test from 'node:test';
import { conformanceGate, runConformance } from '../../../tests/agent-conformance/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import extension from '../dist/index.js';

/**
 * The profile omp is told to use. `--profile` is a command-line flag, but the
 * extension resolves omp's data root from the *process environment* alone
 * (`OMP_PROFILE`, then `PI_PROFILE`, then `PI_CODING_AGENT_DIR`), so the
 * profile has to be selected the way the extension can see it. omp honours
 * `OMP_PROFILE` identically: verified live, where the whole agent tree —
 * sessions, terminal-sessions, caches and auth — relocated under
 * `~/.omp/profiles/conformance/agent`.
 */
const PROFILE = 'conformance';

/**
 * The seeded profile. Everything here exists to make the run reproducible in a
 * container; none of it is a credential, and a developer's own login is never
 * copied in. omp authenticates from OPENAI_API_KEY alone.
 *
 * `setupVersion` — a fresh omp profile opens an interactive onboarding wizard,
 * a provider picker that swallows every keystroke, before it will accept a
 * prompt, and an empty container home is always fresh. `setupVersion` is what
 * omp checks to decide onboarding is done. `last-changelog-version` keeps the
 * release-notes interstitial shut for the same reason.
 *
 * `modelRoles` — every prompt in this matrix is trivial: a one-word reply, one
 * empty file, three subagents doing school arithmetic. `gpt-5.4-nano` is the
 * cheapest model this key reaches and takes the `slow` and `plan` roles. The
 * conversation model and the `smol` role subagents run on are one step up,
 * `gpt-5.4-mini`, because they have
 * to spawn subagents and drive a tool call onto an approval prompt, and a
 * failure there is a failed matrix step rather than a saving. `--model`,
 * `--smol`, `--slow` and `--plan` set the same four roles from the command
 * line; the config form is used because it is what the passing run used, and
 * because it survives the `--continue` in the resume gesture without repeating
 * four flags. Both are named with an explicit `openai/` prefix rather than by
 * fuzzy match, because the container is also handed ANTHROPIC_API_KEY and
 * XAI_API_KEY and a bare model name could resolve onto another credential.
 *
 * `tools.approval` — a per-tool override that omp honours in every approval
 * mode, and the reason this suite can hold a prompting mode and still finish.
 * With `always-ask` and no overrides, the parent's own `task` call sits on an
 * approval prompt that no gesture answers: measured, the subagent turn then
 * never completed in 200 seconds, and the three children were never spawned at
 * all. `task` is the spawn and `hub` is how the parent collects the children's
 * results, so those two are pre-approved and nothing else is. `write` — the
 * tool the waiting step needs to block on — still prompts, and the children's
 * own `bash` and `yield` calls need no rule because a subagent session runs
 * auto-approved regardless of its parent's mode.
 */
function isolatedOmpProfile() {
	if (!process.env.OPENAI_API_KEY?.trim())
		throw new Error(
			'OPENAI_API_KEY is required: omp conformance authenticates by API key, never by a copied login session',
		);
	const agent = join(
		process.env.HOME?.trim() || homedir(),
		'.omp',
		'profiles',
		PROFILE,
		'agent',
	);
	mkdirSync(agent, { recursive: true });
	writeFileSync(
		join(agent, 'config.yml'),
		[
			'setupVersion: 2',
			'modelRoles:',
			'  default: openai/gpt-5.4-mini',
			// Subagents run on the smol role. `gpt-5.4-nano` drove this turn fine
			// locally but hung in CI: instead of running `sleep 2` it went off
			// defining a sleep tool, and sat there — the PTY read `running define
			// sleep tool` until the step timed out. A step that fails because the
			// model wandered is not evidence about the provider, so subagents get
			// the same model as the conversation. `slow` and `plan` stay cheap.
			'  smol: openai/gpt-5.4-mini',
			'  slow: openai/gpt-5.4-nano',
			'  plan: openai/gpt-5.4-nano',
			'tools:',
			'  approval:',
			'    task: allow',
			'    hub: allow',
			'dev:',
			'  autoqaConsent: denied',
			'  autoqa: false',
			'web_search:',
			'  enabled: false',
			'',
		].join('\n'),
	);
	writeFileSync(join(agent, 'last-changelog-version'), '99999.0.0');
	return { OMP_PROFILE: PROFILE };
}

/**
 * Approval prompting is forced on the command line so the run does not depend
 * on, or change, the developer's own `tools.approvalMode`. The waiting step
 * needs a prompt that really blocks, and `always-ask` is the mode that
 * guarantees one for an ordinary file write.
 */
const OMP = 'omp --approval-mode always-ask';

const descriptor = {
	name: 'omp',
	extension,
	providerId: 'com.terminay.agent.omp/cli',
	enableEnvironmentVariable: 'TERMINAY_CONFORMANCE_OMP',
	// omp is a Bun script, and on Linux it renames itself with `prctl` at
	// startup, so the process below the PTY is `omp` rather than `bun`. On
	// macOS it cannot: `process.title` does not reach `ps -o comm` there and the
	// descendant really is `bun`, which is one more reason these runs are
	// container-only.
	executable: 'omp',
	environment: () => isolatedOmpProfile(),
	row: {
		// omp writes a terminal breadcrumb at
		// `<agent>/terminal-sessions/<tty>` naming its session file, and derives
		// that name from its own TTY exactly as Terminay does. Measured in the
		// container: the shell's TTY is `/dev/pts/0`, Terminay's device id is
		// `pts-0`, omp's breadcrumb file is named `pts-0`, and it names a real
		// 3.8 KB journal. Every input the rule needs is present and correct.
		//
		// The rule still cannot complete, and this is a host defect rather than
		// an omp one. Turning the breadcrumb's recorded session-file path into a
		// handle goes through `filesystem.resolve-path-under-home`, and that one
		// operation checks containment against the adapter-level
		// `this.homeDirectory` instead of the per-terminal `state.homeDirectory`
		// every other home-scoped operation uses. The extension child never
		// configures an adapter home, so it is always undefined, and
		// `matchesFileConstraint` returns false for any `beneath.homeRelative`.
		// The breadcrumb resolves, reads and parses; only the journal handle
		// comes back missing, on every poll.
		//
		// This cell states the capability omp implements, which is exact. What
		// binding survives today is the open-writable-journal fallback, and that
		// is a race: omp keeps no persistent handle on its journal — zero
		// `.jsonl` descriptors when the live process was measured — so a run
		// binds only if a poll happens to land while a handle is open.
		detect: 'Y',
		// omp does choose its own title, but the extension can only publish it
		// once. The label comes from the fixed 256-byte title slot read when the
		// journal is first opened. Every later retitle is appended as a
		// `title_change` record, which the (omp, 0.1) mapping ignores, and the
		// slot itself is rewritten in place at a fixed width, so the file never
		// changes length and an append-following watcher never re-reads it.
		// Nothing therefore replaces the initial label.
		title: 'N',
		// The logical first record is `type: "session"`, ahead of the first user
		// message, so the session exists before any turn opens.
		idle: 'Y',
		working: 'Y',
		// omp persists no approval or elicitation record. With `always-ask`, an
		// open approval prompt leaves the journal completely silent between
		// `tool_execution_start` and the `toolResult` that follows the answer —
		// 18 seconds of silence on record for the `write` this suite provokes,
		// indistinguishable from a slow tool. The entry stays `working`, which is
		// what the omp spec requires.
		waiting: 'N',
		// The mapping publishes no wait at all, so it has no blocking state
		// either: a failed turn is an assistant `stopReason` of `error`, which is
		// a completion outcome and not a halting condition.
		blocked: 'N',
		// Assistant `stopReason: "stop"` produces `done` with a success outcome.
		done: 'Y',
		// Subagents do get their own live `<parent-stem>/<agentId>.jsonl`
		// journals, written from the moment they spawn — measured: spawn at
		// t+1.6s, first child record at t+2.6s, all three complete by t+21s. The
		// extension still cannot see them, for two independent reasons.
		//
		// `findOmpChildSources` runs exactly once, inside the bind, and the
		// extension supplies no `childSourceDiscovery` stream, so a child created
		// after the terminal bound is never looked for. And the collection rule
		// is an open writable handle held by a descendant, which omp never
		// provides for any journal — the same measurement that forces the root
		// onto its breadcrumb. No child can be admitted at any moment.
		//
		// A child would also arrive unlabelled: `subagentStarted` carries no
		// title, and a child journal's own title slot is empty on record.
		subEnumerate: 'N',
		subStatus: 'N',
		// `omp --continue` reopens the same session file and appends to it, so
		// the header id is unchanged and the unchanged breadcrumb rebinds the
		// same terminal to the same provider session.
		resume: 'Y',
	},
	launch(harness) {
		harness.pty.send(`${OMP} "Reply with the single word ready."`);
	},
	startSubagents(harness) {
		// One unchained `sleep <n>` per child, staggered, and nothing else: the
		// children work the arithmetic out without a tool and use their single
		// shell command only to complete at different times. On record this whole
		// turn took 27 seconds, with the children finishing 2 seconds apart.
		harness.pty.send(
			'Spawn three subagents concurrently. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Tell each one to work the arithmetic out in its head, then to wait before replying by running exactly one shell command: `sleep 2` for the first, `sleep 5` for the second, `sleep 9` for the third. Run that command directly with the shell tool you already have. Do not define, write or register a tool, and do not read, create or modify files. Report only the three numbers.',
		);
	},
	requestInput(harness) {
		// A file write through omp's `write` tool is the gesture `always-ask`
		// reliably stops on, and it stops exactly once: on record this raised a
		// single prompt that a single Enter cleared, after which the file
		// appeared and the turn completed.
		harness.pty.send(
			'Create an empty file named needs-approval.txt in the current directory. Do nothing else.',
		);
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	quit(harness) {
		// `/exit` records `custom/session_exit` with `kind: "normal"`, which the
		// mapping turns into `session.stopped`.
		harness.pty.send('/exit');
	},
	resume(harness) {
		harness.pty.send(`${OMP} --continue`);
	},
	secondLaunch(harness) {
		// A second omp in the same working directory. omp keys its breadcrumb on
		// the TTY, not the directory, so this is the case that proves two
		// terminals in one repository do not collapse onto one session.
		harness.pty.send(`${OMP} "Reply with the single word other."`);
	},
};

const gate = await conformanceGate(descriptor);

test('omp satisfies its conformance matrix row', {
	skip: gate?.reason,
	// A full matrix run drives several real model turns and subagent waits.
	timeout: 30 * 60 * 1000,
}, async () => {
	await runConformance(descriptor);
});
