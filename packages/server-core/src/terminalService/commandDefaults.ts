import type {
	TerminalCommandDefaultContribution,
	TerminalCommandDefaultResolution,
} from '@terminay/extension-api';
import {
	isTerminalCommandDefaultArgs,
	isTerminalCommandDefaultEnvironment,
	isTerminalCommandName,
} from '@terminay/extension-api';

/**
 * The terminal command defaults this server applies (ADR-0081). Extensions
 * contribute a command name in their manifest and say, when asked, whether the
 * default applies and which flags it adds. This registry decides what new
 * terminals receive: only defaults whose extension runs, whose harness is
 * switched on, whose last answer was valid flags, and whose command no other
 * contribution also claims. A launch reads the registry as it stands and never
 * waits for an extension.
 */

/**
 * One command, the flags placed before the user's arguments, and the
 * environment set on the integrated shell (ADR-0124). Either may be empty, but
 * not both.
 */
export interface TerminalCommandDefault {
	readonly command: string;
	readonly args: readonly string[];
	readonly environment: Readonly<Record<string, string>>;
}

/** Two or more contributions claimed one command, so none of them applies. */
export interface TerminalCommandDefaultConflict {
	readonly command: string;
	readonly contributionIds: readonly string[];
	readonly extensionIds: readonly string[];
}

/** The part of the extension host manager the registry reads. */
export interface TerminalCommandDefaultSource {
	terminalCommandDefaultContributions(): readonly {
		readonly extensionId: string;
		readonly contribution: TerminalCommandDefaultContribution;
	}[];
	resolveTerminalCommandDefault(
		commandDefaultId: string,
		signal?: AbortSignal,
	): Promise<TerminalCommandDefaultResolution>;
	onContributionsChanged(listener: () => void | Promise<void>): () => void;
}

/** Per-harness switches keyed `<sourceId>/<harnessId>`; a missing key means on. */
export type TerminalCommandDefaultHarnessSwitches = Readonly<
	Record<string, boolean>
>;

export interface TerminalCommandDefaultRegistryOptions {
	readonly harnessSwitches?: TerminalCommandDefaultHarnessSwitches;
	/** An answer older than this is asked again, in the background, at the next launch. */
	readonly maxResolutionAgeMs?: number;
	readonly now?: () => number;
	/** Called once each time the set of conflicting commands changes. */
	readonly onConflicts?: (
		conflicts: readonly TerminalCommandDefaultConflict[],
	) => void;
}

interface Resolved {
	/** `undefined` when the default does not apply. */
	readonly applied:
		| {
				readonly args: readonly string[];
				readonly environment: Readonly<Record<string, string>>;
		  }
		| undefined;
	readonly at: number;
}

const DEFAULT_MAX_RESOLUTION_AGE_MS = 60_000;

export class TerminalCommandDefaultRegistry {
	private source: TerminalCommandDefaultSource | undefined;
	private switches: TerminalCommandDefaultHarnessSwitches;
	private readonly maxAgeMs: number;
	private readonly now: () => number;
	private readonly resolutions = new Map<string, Resolved>();
	private readonly inFlight = new Map<string, Promise<void>>();
	private lastConflictsKey = '[]';
	private lastConflicts: readonly TerminalCommandDefaultConflict[] = [];
	private unsubscribe: (() => void) | undefined;

	constructor(
		private readonly options: TerminalCommandDefaultRegistryOptions = {},
	) {
		this.switches = { ...(options.harnessSwitches ?? {}) };
		this.maxAgeMs = options.maxResolutionAgeMs ?? DEFAULT_MAX_RESOLUTION_AGE_MS;
		this.now = options.now ?? Date.now;
	}

	/** Bind the extension host manager once the extension composition exists. */
	attach(source: TerminalCommandDefaultSource): void {
		this.unsubscribe?.();
		this.source = source;
		this.unsubscribe = source.onContributionsChanged(() => {
			// A restarted or updated extension may answer differently.
			this.resolutions.clear();
			return this.refresh();
		});
		void this.refresh();
	}

	/**
	 * Switching a harness on asks its defaults again; switching it off drops
	 * them, and they are not asked anything while it stays off.
	 */
	setHarnessSwitches(switches: TerminalCommandDefaultHarnessSwitches): void {
		// An answer is forgotten while its harness is off, so switching it on
		// asks again.
		this.switches = { ...switches };
		void this.refresh();
	}

	/**
	 * The defaults a terminal created now receives. Never waits: an answer that
	 * is missing or stale is asked again in the background for later terminals.
	 */
	current(): readonly TerminalCommandDefault[] {
		const candidates = this.candidates();
		this.resolveStale(candidates.map(({ contribution }) => contribution.id));
		const byCommand = new Map<
			string,
			{
				extensionId: string;
				contribution: TerminalCommandDefaultContribution;
			}[]
		>();
		for (const entry of candidates) {
			const claims = byCommand.get(entry.contribution.command) ?? [];
			claims.push(entry);
			byCommand.set(entry.contribution.command, claims);
		}
		const applied: TerminalCommandDefault[] = [];
		const conflicts: TerminalCommandDefaultConflict[] = [];
		for (const [command, claims] of byCommand) {
			if (claims.length > 1) {
				conflicts.push(
					Object.freeze({
						command,
						contributionIds: Object.freeze(
							claims.map(({ contribution }) => contribution.id).sort(),
						),
						extensionIds: Object.freeze(
							[...new Set(claims.map(({ extensionId }) => extensionId))].sort(),
						),
					}),
				);
				continue;
			}
			const resolved = this.resolutions.get(
				claims[0]?.contribution.id ?? '',
			)?.applied;
			if (resolved !== undefined)
				applied.push(
					Object.freeze({
						command,
						args: Object.freeze([...resolved.args]),
						environment: Object.freeze({ ...resolved.environment }),
					}),
				);
		}
		this.noteConflicts(conflicts);
		return Object.freeze(
			applied.sort((left, right) =>
				left.command < right.command
					? -1
					: left.command > right.command
						? 1
						: 0,
			),
		);
	}

	/** Commands that two or more contributions claim, and so none applies. */
	conflicts(): readonly TerminalCommandDefaultConflict[] {
		return this.lastConflicts;
	}

	/** The flags a launcher types after this executable, when a default matches its file name. */
	argsForExecutable(executable: string): readonly string[] {
		const name = executable.replace(/\\/gu, '/').split('/').at(-1) ?? '';
		return this.current().find((entry) => entry.command === name)?.args ?? [];
	}

	/** Ask every eligible default whose answer is missing or stale, and wait for the answers. */
	async refresh(): Promise<void> {
		const ids = this.candidates().map(({ contribution }) => contribution.id);
		await Promise.all(ids.map((id) => this.resolve(id)));
		this.current();
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.source = undefined;
	}

	private candidates(): {
		extensionId: string;
		contribution: TerminalCommandDefaultContribution;
	}[] {
		const source = this.source;
		if (source === undefined) return [];
		const candidates = source
			.terminalCommandDefaultContributions()
			// The manifest was validated at install; this is the second gate.
			.filter(
				({ contribution }) =>
					isTerminalCommandName(contribution.command) &&
					this.eligible(contribution),
			);
		const live = new Set(candidates.map(({ contribution }) => contribution.id));
		for (const id of [...this.resolutions.keys()])
			if (!live.has(id)) this.resolutions.delete(id);
		return candidates;
	}

	private eligible(contribution: TerminalCommandDefaultContribution): boolean {
		const key = harnessKey(contribution);
		return key === undefined || this.switches[key] !== false;
	}

	private resolveStale(ids: readonly string[]): void {
		for (const id of ids) {
			const known = this.resolutions.get(id);
			if (known === undefined || this.now() - known.at >= this.maxAgeMs)
				void this.resolve(id);
		}
	}

	private resolve(commandDefaultId: string): Promise<void> {
		const known = this.resolutions.get(commandDefaultId);
		if (known !== undefined && this.now() - known.at < this.maxAgeMs)
			return Promise.resolve();
		const pending = this.inFlight.get(commandDefaultId);
		if (pending !== undefined) return pending;
		const source = this.source;
		if (source === undefined) return Promise.resolve();
		const asked = source
			.resolveTerminalCommandDefault(commandDefaultId)
			.then(
				(result): Resolved => ({
					applied: result.applies ? appliedParts(result) : undefined,
					at: this.now(),
				}),
				// A default that fails or times out does not apply until it answers.
				(): Resolved => ({ applied: undefined, at: this.now() }),
			)
			.then((value) => {
				// An answer for a default that left meanwhile is not kept.
				if (this.source === source)
					this.resolutions.set(commandDefaultId, value);
			})
			.finally(() => this.inFlight.delete(commandDefaultId));
		this.inFlight.set(commandDefaultId, asked);
		return asked;
	}

	private noteConflicts(
		conflicts: readonly TerminalCommandDefaultConflict[],
	): void {
		const key = JSON.stringify(conflicts);
		if (key === this.lastConflictsKey) return;
		this.lastConflictsKey = key;
		this.lastConflicts = Object.freeze([...conflicts]);
		try {
			this.options.onConflicts?.(conflicts);
		} catch {
			/* a diagnostic sink cannot stop terminals being created */
		}
	}
}

/**
 * The flags and environment of an applying answer, or `undefined` when either
 * part breaks the rules or both are missing.
 */
function appliedParts(
	result: Readonly<{ args?: unknown; environment?: unknown }>,
): Resolved['applied'] {
	const { args, environment } = result;
	if (args !== undefined && !isTerminalCommandDefaultArgs(args))
		return undefined;
	if (
		environment !== undefined &&
		!isTerminalCommandDefaultEnvironment(environment)
	)
		return undefined;
	if (args === undefined && environment === undefined) return undefined;
	return Object.freeze({
		args: Object.freeze([...(args ?? [])]),
		environment: Object.freeze({ ...(environment ?? {}) }),
	});
}

/**
 * The environment every applying default sets on an integrated shell, in
 * command order. A name two defaults both set is left out: neither decides it.
 */
export function commandDefaultEnvironment(
	defaults: readonly TerminalCommandDefault[],
): Readonly<Record<string, string>> {
	const values = new Map<string, string>();
	const contested = new Set<string>();
	for (const entry of defaults) {
		if (
			!isTerminalCommandName(entry.command) ||
			!isTerminalCommandDefaultEnvironment(entry.environment)
		)
			continue;
		for (const [name, value] of Object.entries(entry.environment)) {
			if (values.has(name)) contested.add(name);
			else values.set(name, value);
		}
	}
	for (const name of contested) values.delete(name);
	return Object.freeze(Object.fromEntries(values));
}

function harnessKey(
	contribution: TerminalCommandDefaultContribution,
): string | undefined {
	const harness = contribution.harness;
	return harness === undefined
		? undefined
		: `${harness.source}/${harness.harness}`;
}

/** Separates one command default from the next in the environment encoding. */
export const COMMAND_DEFAULT_RECORD_SEPARATOR = '\u001e';
/** Separates a command from its flags, and each flag from the next. */
export const COMMAND_DEFAULT_UNIT_SEPARATOR = '\u001f';

/**
 * The value of `TERMINAY_COMMAND_DEFAULTS`: records of `command`, then each
 * flag, joined by ASCII unit separators, and records joined by ASCII record
 * separators. Names and flags never hold control characters, so the encoding
 * cannot be confused, and no part of it is shell syntax. Entries that break
 * the registry's rules are left out, never escaped.
 */
export function encodeCommandDefaults(
	defaults: readonly TerminalCommandDefault[],
): string {
	return defaults
		// A default that only sets environment defines no shell function.
		.filter(
			(entry) =>
				isTerminalCommandName(entry.command) &&
				isTerminalCommandDefaultArgs(entry.args),
		)
		.map((entry) =>
			[entry.command, ...entry.args].join(COMMAND_DEFAULT_UNIT_SEPARATOR),
		)
		.join(COMMAND_DEFAULT_RECORD_SEPARATOR);
}

/** The reverse of {@link encodeCommandDefaults}, keeping only valid entries. */
export function decodeCommandDefaults(
	value: string,
): readonly TerminalCommandDefault[] {
	if (value.length === 0) return [];
	return value
		.split(COMMAND_DEFAULT_RECORD_SEPARATOR)
		.map((record) => record.split(COMMAND_DEFAULT_UNIT_SEPARATOR))
		.filter(
			([command, ...args]) =>
				isTerminalCommandName(command) && isTerminalCommandDefaultArgs(args),
		)
		.map(([command, ...args]) =>
			Object.freeze({
				command: command as string,
				args: Object.freeze(args),
				environment: Object.freeze({}),
			}),
		);
}
