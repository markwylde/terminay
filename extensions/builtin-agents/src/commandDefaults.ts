import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { delimiter, dirname } from 'node:path';
import type { TerminalCommandDefaultRuntime } from '@terminay/extension-api';
import { defineTerminalCommandDefault } from '@terminay/extension-api';
import type { AgentLocator } from './chat/locate.js';

/**
 * The Codex command default (ADR-0081). Codex 0.166 runs every conversation in
 * one shared background server unless it is started with `--no-daemon`, and
 * nothing maps a conversation in that server back to the terminal driving it.
 * In Terminay terminals, `codex` therefore runs with `--no-daemon`, so each
 * conversation lives in its own terminal's process and its status shows on
 * that terminal.
 *
 * Whether the installed Codex has the option is learned only from its own
 * `--help`, never from its configuration or files. The answer is kept until
 * the executable changes path, size, or modification time.
 */
export const COMMAND_DEFAULT_LOCAL_IDS = Object.freeze({
	claude: 'claude-no-agent-view',
	codex: 'codex-no-daemon',
} as const);

export const CODEX_NO_DAEMON_ARGS: readonly string[] = Object.freeze([
	'--no-daemon',
]);

const HELP_TIMEOUT_MS = 5_000;
const HELP_OUTPUT_LIMIT = 256 * 1024;
const NO_DAEMON_OPTION = /^\s*--no-daemon\b/mu;

/** Runs `<executable> --help` and returns its output, or undefined when it fails. */
export type HelpProbe = (
	executable: string,
	signal: AbortSignal,
) => Promise<string | undefined>;

export type CodexCommandDefaultOptions = {
	/** Replaces running the executable, for tests. */
	probe?: HelpProbe;
};

export function createCodexCommandDefault(
	locator: AgentLocator,
	options: CodexCommandDefaultOptions = {},
): TerminalCommandDefaultRuntime {
	const probe = options.probe ?? readHelp;
	let cached: { identity: string; supported: boolean } | undefined;
	return defineTerminalCommandDefault({
		async resolve(signal) {
			const executable = await locator.locate('codex');
			if (executable === undefined)
				return {
					applies: false,
					reason: 'not_installed',
					detail: 'No codex executable was found on this server account.',
				};
			const identity = await fileIdentity(executable);
			if (identity === undefined)
				return {
					applies: false,
					reason: 'not_installed',
					detail: 'The codex executable could not be read.',
				};
			if (cached?.identity !== identity) {
				const help = await probe(executable, signal);
				// A failed check is not remembered, so the next one tries again.
				if (help === undefined)
					return {
						applies: false,
						reason: 'unavailable',
						detail: 'codex --help did not finish successfully.',
					};
				cached = { identity, supported: NO_DAEMON_OPTION.test(help) };
			}
			return cached.supported
				? { applies: true, args: [...CODEX_NO_DAEMON_ARGS] }
				: {
						applies: false,
						reason: 'unsupported',
						detail: 'This Codex does not list --no-daemon in its help.',
					};
		},
	});
}

/**
 * The Claude Code command default (ADR-0124). Claude Code's agent view runs
 * conversations in an on-demand background daemon with its own pseudo
 * terminals, so a conversation started from a Terminay terminal is not on that
 * terminal and shows as external. Claude Code has no flag to turn this off;
 * its documented switch is `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, equivalent to
 * the `disableAgentView` setting. Terminay sets that variable on its own
 * integrated shells and never touches Claude Code's settings.
 *
 * Whether the installed Claude Code honours the variable is learned by asking
 * it: `claude agents --json` with the variable set refuses and names the
 * variable. The answer is kept until the executable changes.
 */
export const CLAUDE_DISABLE_AGENT_VIEW_ENVIRONMENT: Readonly<
	Record<string, string>
> = Object.freeze({ CLAUDE_CODE_DISABLE_AGENT_VIEW: '1' });

const AGENT_VIEW_REFUSAL = /disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW/u;

/** Runs the agent-view probe and returns its combined output, or undefined when it cannot run. */
export type AgentViewProbe = (
	executable: string,
	signal: AbortSignal,
) => Promise<string | undefined>;

export type ClaudeCommandDefaultOptions = {
	/** Replaces running the executable, for tests. */
	probe?: AgentViewProbe;
};

export function createClaudeCommandDefault(
	locator: AgentLocator,
	options: ClaudeCommandDefaultOptions = {},
): TerminalCommandDefaultRuntime {
	const probe = options.probe ?? readAgentViewRefusal;
	let cached: { identity: string; supported: boolean } | undefined;
	return defineTerminalCommandDefault({
		async resolve(signal) {
			const executable = await locator.locate('claude');
			if (executable === undefined)
				return {
					applies: false,
					reason: 'not_installed',
					detail: 'No claude executable was found on this server account.',
				};
			const identity = await fileIdentity(executable);
			if (identity === undefined)
				return {
					applies: false,
					reason: 'not_installed',
					detail: 'The claude executable could not be read.',
				};
			if (cached?.identity !== identity) {
				const output = await probe(executable, signal);
				// A failed check is not remembered, so the next one tries again.
				if (output === undefined)
					return {
						applies: false,
						reason: 'unavailable',
						detail: 'claude agents --json did not finish.',
					};
				cached = { identity, supported: AGENT_VIEW_REFUSAL.test(output) };
			}
			return cached.supported
				? {
						applies: true,
						environment: { ...CLAUDE_DISABLE_AGENT_VIEW_ENVIRONMENT },
					}
				: {
						applies: false,
						reason: 'unsupported',
						detail:
							'This Claude Code does not honour CLAUDE_CODE_DISABLE_AGENT_VIEW.',
					};
		},
	});
}

/**
 * Runs `claude agents --json` with agent view switched off, which a supporting
 * Claude Code refuses before doing anything. Its exit status is not the
 * answer: the refusal text is.
 */
export function readAgentViewRefusal(
	executable: string,
	signal: AbortSignal,
): Promise<string | undefined> {
	return runBounded(
		executable,
		['agents', '--json'],
		signal,
		CLAUDE_DISABLE_AGENT_VIEW_ENVIRONMENT,
		{ anyExit: true, stderr: true },
	);
}

/** The real path, size, and modification time: a different build reads differently. */
async function fileIdentity(executable: string): Promise<string | undefined> {
	try {
		const real = await realpath(executable);
		const info = await stat(real);
		return JSON.stringify([real, info.size, info.mtimeMs]);
	} catch {
		return undefined;
	}
}

/** Runs the user's own Codex with `--help` only, bounded in time and output. */
export function readHelp(
	executable: string,
	signal: AbortSignal,
): Promise<string | undefined> {
	return runBounded(executable, ['--help'], signal);
}

/**
 * Runs the user's own executable with fixed arguments, bounded in time and
 * output. Its directory goes first on PATH so an npm-installed CLI finds the
 * Node it was installed with even when the server started with a minimal PATH.
 * Output is returned only for a zero exit, unless `anyExit` is set.
 */
function runBounded(
	executable: string,
	args: readonly string[],
	signal: AbortSignal,
	environment: Readonly<Record<string, string>> = {},
	mode: { anyExit?: boolean; stderr?: boolean } = {},
): Promise<string | undefined> {
	return new Promise((resolve) => {
		let output = '';
		let settled = false;
		const finish = (value: string | undefined): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener('abort', abort);
			resolve(value);
		};
		const child = spawn(executable, [...args], {
			env: {
				...process.env,
				...environment,
				PATH: [dirname(executable), process.env.PATH ?? '']
					.filter((entry) => entry.length > 0)
					.join(delimiter),
			},
			stdio: ['ignore', 'pipe', mode.stderr === true ? 'pipe' : 'ignore'],
			// Its own process group, so a wrapper script's children stop with it.
			detached: process.platform !== 'win32',
		});
		const stop = (): void => {
			try {
				if (child.pid !== undefined && process.platform !== 'win32')
					process.kill(-child.pid, 'SIGKILL');
				else child.kill('SIGKILL');
			} catch {
				child.kill('SIGKILL');
			}
			child.stdout?.destroy();
			child.stderr?.destroy();
			finish(undefined);
		};
		const abort = (): void => stop();
		const timer = setTimeout(stop, HELP_TIMEOUT_MS);
		signal.addEventListener('abort', abort, { once: true });
		const collect = (chunk: string): void => {
			output += chunk;
			if (output.length > HELP_OUTPUT_LIMIT) stop();
		};
		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', collect);
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', collect);
		child.on('error', () => finish(undefined));
		child.on('close', (code) =>
			finish(
				code === 0 || (mode.anyExit === true && code !== null)
					? output
					: undefined,
			),
		);
	});
}
