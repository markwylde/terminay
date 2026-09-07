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
 * profile has to be selected the way the extension can see it. omp itself
 * honours `OMP_PROFILE` identically: verified live, where the whole agent tree
 * — sessions, terminal-sessions, caches and auth — relocated under
 * `~/.omp/profiles/conformance/agent`.
 */
const PROFILE = 'conformance';

/**
 * The models. Every prompt in this matrix is trivial — a one-word reply, one
 * empty file, three subagents doing school arithmetic — so the run buys
 * nothing from a large model and pays for it three times over. `gpt-5.4-nano`
 * is the cheapest model the OPENAI_API_KEY reaches, and it takes all three
 * role slots (`--smol`, `--slow`, `--plan`). The conversation model itself is
 * one step up, `gpt-5.4-mini`: nano is cheap enough to be worth the risk on
 * the auxiliary roles, but the main model has to spawn subagents and drive a
 * tool call through an approval prompt, and a failure there is a failed matrix
 * step rather than a saving.
 *
 * Both are named with their explicit `openai/` provider prefix rather than by
 * fuzzy match, because the container is also handed ANTHROPIC_API_KEY and
 * XAI_API_KEY and a bare model name could resolve onto another provider's
 * credential.
 */
const MODELS = '--model openai/gpt-5.4-mini --smol openai/gpt-5.4-nano --slow openai/gpt-5.4-nano --plan openai/gpt-5.4-nano';

/**
 * Approval prompting is forced on the command line so the run does not depend
 * on, or change, the developer's own `tools.approvalMode`. The waiting step
 * needs a prompt that really blocks, and `always-ask` is the only mode that
 * guarantees one for an ordinary file write.
 */
const OMP = `omp ${MODELS} --approval-mode always-ask`;

/**
 * A fresh omp profile runs an interactive onboarding wizard — a provider
 * picker that swallows every keystroke — before it will accept a prompt, and
 * an empty container home is always fresh. `setupVersion` is what omp checks
 * to decide onboarding is done, so the profile is seeded with a config that
 * declares it, plus a changelog marker so the release-notes interstitial does
 * not open either. Nothing here is a credential: omp authenticates from
 * OPENAI_API_KEY, and a developer's own login is never copied in.
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
		// that name from its own TTY exactly as Terminay does — `/dev/pts/3`
		// becomes `pts-3` on both sides — so the rule itself is exact.
		//
		// It does not currently reach that rule. `bindFromBreadcrumb` needs
		// `AgentTerminalContext.tty`, and the extension-child bridge that builds
		// every real terminal context never sets that field: only the fake
		// context in `@terminay/extension-api/testing` supplies it. omp
		// therefore falls through to open-writable-journal evidence, and its CLI
		// keeps no handle on its own JSONL — measured with `lsof` against the
		// live process, zero `.jsonl` descriptors — so nothing binds. This cell
		// states the capability omp implements; the run is what proves whether
		// the host lets it run.
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
		// 29 seconds of silence on record, indistinguishable from a slow tool.
		// The entry stays `working`, which is what the omp spec requires.
		waiting: 'N',
		// The mapping publishes no wait at all, so it has no blocking state
		// either: a failed turn is an assistant `stopReason` of `error`, which is
		// a completion outcome and not a halting condition.
		blocked: 'N',
		done: 'Y',
		// Subagents get their own `<parent-stem>/<agentId>.jsonl` journals, but
		// the extension collects child sources exactly once, inside the bind, and
		// supplies no `childSourceDiscovery` stream. A subagent is always started
		// long after its terminal bound — measured live: bound at 2.5s, the three
		// child journals first appeared on disk at 286.8s — so no child is ever
		// admitted. `subagentStarted` also carries no title, so even an admitted
		// child would arrive unlabelled.
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
		// The waits are short on purpose. The harness allows one turn 120s to
		// reach `done`, and a spawn round trip on record took 178s with waits of
		// 5, 15 and 30 seconds; the completions still stagger, which is what the
		// gesture is for, but within the budget the step actually has.
		harness.pty.send(
			'Spawn three subagents concurrently. Give one each of: compute 17*19, compute the sum 1..100, compute 2^12. Tell each one to work the arithmetic out in its head, then to wait before replying by running exactly one shell command: `sleep 2` for the first, `sleep 5` for the second, `sleep 9` for the third. Do not read, create or modify files. Report only the three numbers.',
		);
	},
	requestInput(harness) {
		// A file write is the one gesture `always-ask` reliably stops on, and it
		// stops exactly once: on record this raised a single prompt that a single
		// Enter cleared.
		harness.pty.send(
			'Create an empty file named needs-approval.txt in the current directory. Do nothing else.',
		);
	},
	answerInput(harness) {
		harness.pty.write('\r');
	},
	quit(harness) {
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
