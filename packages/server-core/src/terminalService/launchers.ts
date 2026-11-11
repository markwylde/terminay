import type {
	ExtensionPlatform,
	TerminalLauncherContribution,
	TerminalLauncherResolution,
} from '@terminay/extension-api';
import {
	isExecutablePath,
	isTerminalCommandDefaultArgs,
} from '@terminay/extension-api';

/**
 * The terminal launchers this server offers (ADR-0073). Extensions contribute
 * launchers and say where each program is installed; this registry decides
 * which are offered: only while the contributing extension runs, the platform
 * is supported, the launcher's harness is switched on, and its last
 * resolution named an absolute executable. A client sees ids, names, and
 * icons, never a path.
 */

/** Stable protocol names for terminal launchers. */
export const TERMINAL_LAUNCHER_OPERATIONS = Object.freeze({
	list: 'terminal.launchers',
} as const);

export const TERMINAL_LAUNCHER_EVENTS = Object.freeze({
	/** Carries nothing; clients fetch the list again. */
	changed: 'terminal.launchers.changed',
} as const);

/** What a client is shown for one launcher. */
export interface TerminalLauncherListing {
	readonly id: string;
	readonly displayName: string;
	readonly icon: string;
	/** Present when the launcher's program takes an initial prompt (ADR-0105). */
	readonly initialPrompt?: 'positional';
}

/** What a launch needs: the program to type, and the name to show until it sets a title. */
export interface TerminalLauncherTarget {
	readonly id: string;
	readonly displayName: string;
	readonly executable: string;
	readonly initialPrompt?: 'positional';
}

/** The part of the extension host manager the registry reads. */
export interface TerminalLauncherSource {
	terminalLauncherContributions(): readonly {
		readonly extensionId: string;
		readonly contribution: TerminalLauncherContribution;
	}[];
	resolveTerminalLauncher(
		launcherId: string,
		signal?: AbortSignal,
	): Promise<TerminalLauncherResolution>;
	onContributionsChanged(listener: () => void | Promise<void>): () => void;
}

/** Per-harness switches keyed `<sourceId>/<harnessId>`; a missing key means on. */
export type TerminalLauncherHarnessSwitches = Readonly<Record<string, boolean>>;

export interface TerminalLauncherRegistryOptions {
	/** Extensions whose launchers are listed first, in this order. */
	readonly builtInExtensionIds?: readonly string[];
	readonly harnessSwitches?: TerminalLauncherHarnessSwitches;
	readonly platform?: ExtensionPlatform;
	/** A resolution older than this is asked again before it is listed or used. */
	readonly maxResolutionAgeMs?: number;
	readonly now?: () => number;
}

interface Resolved {
	readonly executable: string | undefined;
	readonly at: number;
}

const DEFAULT_MAX_RESOLUTION_AGE_MS = 60_000;

export class TerminalLauncherRegistry {
	private source: TerminalLauncherSource | undefined;
	private switches: TerminalLauncherHarnessSwitches;
	private readonly builtIns: readonly string[];
	private readonly platform: ExtensionPlatform;
	private readonly maxAgeMs: number;
	private readonly now: () => number;
	private readonly listeners = new Set<() => void>();
	private readonly resolutions = new Map<string, Resolved>();
	private readonly inFlight = new Map<string, Promise<Resolved>>();
	private lastListed = '';
	private refreshing: Promise<void> = Promise.resolve();
	private unsubscribe: (() => void) | undefined;

	constructor(options: TerminalLauncherRegistryOptions = {}) {
		this.switches = { ...(options.harnessSwitches ?? {}) };
		this.builtIns = [...(options.builtInExtensionIds ?? [])];
		this.platform = options.platform ?? currentPlatform();
		this.maxAgeMs = options.maxResolutionAgeMs ?? DEFAULT_MAX_RESOLUTION_AGE_MS;
		this.now = options.now ?? Date.now;
	}

	/** Called whenever the offered list changes; listeners fetch it again. */
	observe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Bind the extension host manager once the extension composition exists. */
	attach(source: TerminalLauncherSource): void {
		this.unsubscribe?.();
		this.source = source;
		this.unsubscribe = source.onContributionsChanged(() => {
			// A restarted or updated extension may name a different program.
			this.resolutions.clear();
			return this.refresh();
		});
		void this.refresh();
	}

	setHarnessSwitches(switches: TerminalLauncherHarnessSwitches): void {
		this.switches = { ...switches };
		void this.refresh();
	}

	/** The launchers offered now, resolving any whose answer is stale. */
	async list(): Promise<readonly TerminalLauncherListing[]> {
		const offered = await this.offered();
		this.noteListed(offered);
		return offered.map(({ id, displayName, icon, initialPrompt }) =>
			Object.freeze({
				id,
				displayName,
				icon,
				...(initialPrompt === undefined ? {} : { initialPrompt }),
			}),
		);
	}

	/** The launcher to start, or `undefined` when it is unknown or not offered. */
	async target(
		launcherId: string,
	): Promise<TerminalLauncherTarget | undefined> {
		const offered = await this.offered();
		const found = offered.find((launcher) => launcher.id === launcherId);
		return found === undefined
			? undefined
			: Object.freeze({
					id: found.id,
					displayName: found.displayName,
					executable: found.executable,
					...(found.initialPrompt === undefined
						? {}
						: { initialPrompt: found.initialPrompt }),
				});
	}

	/** Resolve again and publish a change if what is offered moved. */
	refresh(): Promise<void> {
		this.refreshing = this.refreshing
			.catch(() => undefined)
			.then(async () => {
				this.noteListed(await this.offered());
			});
		return this.refreshing;
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.source = undefined;
	}

	private async offered(): Promise<
		readonly (TerminalLauncherListing & { readonly executable: string })[]
	> {
		const source = this.source;
		if (source === undefined) return [];
		const candidates = source
			.terminalLauncherContributions()
			.filter(({ contribution }) => this.eligible(contribution));
		const live = new Set(candidates.map(({ contribution }) => contribution.id));
		for (const id of [...this.resolutions.keys()])
			if (!live.has(id)) this.resolutions.delete(id);
		const resolved = await Promise.all(
			candidates.map(async (entry) => ({
				entry,
				resolved: await this.resolution(source, entry.contribution.id),
			})),
		);
		return resolved
			.filter(({ resolved }) => resolved.executable !== undefined)
			.sort((left, right) => this.compare(left.entry, right.entry))
			.map(({ entry, resolved }) => ({
				id: entry.contribution.id,
				displayName: entry.contribution.displayName,
				icon: entry.contribution.icon,
				executable: resolved.executable as string,
				...(entry.contribution.initialPrompt === 'positional'
					? { initialPrompt: 'positional' as const }
					: {}),
			}));
	}

	private eligible(contribution: TerminalLauncherContribution): boolean {
		if (
			contribution.platforms !== undefined &&
			!contribution.platforms.includes(this.platform)
		)
			return false;
		const harness = contribution.harness;
		if (harness === undefined) return true;
		return this.switches[`${harness.source}/${harness.harness}`] !== false;
	}

	private async resolution(
		source: TerminalLauncherSource,
		launcherId: string,
	): Promise<Resolved> {
		const known = this.resolutions.get(launcherId);
		if (known !== undefined && this.now() - known.at < this.maxAgeMs)
			return known;
		const pending = this.inFlight.get(launcherId);
		if (pending !== undefined) return pending;
		const asked = source
			.resolveTerminalLauncher(launcherId)
			.then(
				(result): Resolved => ({
					executable:
						result.available && isExecutablePath(result.executable)
							? result.executable
							: undefined,
					at: this.now(),
				}),
				// A launcher that fails or times out is not offered until it answers.
				(): Resolved => ({ executable: undefined, at: this.now() }),
			)
			.then((value) => {
				this.resolutions.set(launcherId, value);
				return value;
			})
			.finally(() => this.inFlight.delete(launcherId));
		this.inFlight.set(launcherId, asked);
		return asked;
	}

	/** Built-ins first in their given order, then by extension id; declaration order within one. */
	private compare(
		left: { readonly extensionId: string },
		right: { readonly extensionId: string },
	): number {
		const rank = (extensionId: string) => {
			const index = this.builtIns.indexOf(extensionId);
			return index === -1 ? this.builtIns.length : index;
		};
		const byRank = rank(left.extensionId) - rank(right.extensionId);
		if (byRank !== 0) return byRank;
		return left.extensionId < right.extensionId
			? -1
			: left.extensionId > right.extensionId
				? 1
				: 0;
	}

	private noteListed(offered: readonly TerminalLauncherListing[]): void {
		const key = JSON.stringify(
			offered.map(({ id, displayName, icon, initialPrompt }) => [
				id,
				displayName,
				icon,
				initialPrompt ?? null,
			]),
		);
		if (key === this.lastListed) return;
		this.lastListed = key;
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				/* a listener cannot stop the others hearing of the change */
			}
		}
	}
}

function currentPlatform(): ExtensionPlatform {
	return process.platform === 'win32'
		? 'win32'
		: process.platform === 'darwin'
			? 'darwin'
			: 'linux';
}

/** The longest initial prompt a launcher is started with (ADR-0105). */
export const LAUNCHER_PROMPT_MAX_LENGTH = 4_000;

const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'yash']);

function shellName(shellPath: string): string | undefined {
	return shellPath
		.replace(/\\/gu, '/')
		.split('/')
		.at(-1)
		?.replace(/\.exe$/iu, '')
		.toLocaleLowerCase('en-US');
}

/** Why a prompt cannot go to a launcher in this shell, or undefined when it can. */
export function launcherPromptShellProblem(shellPath: string): string | undefined {
	const shell = shellName(shellPath);
	if (shell === 'cmd')
		return 'cmd cannot quote a prompt safely; choose a POSIX shell, fish, or PowerShell profile';
	if (
		shell === undefined ||
		!(POSIX_SHELLS.has(shell) || shell === 'fish' || shell === 'pwsh' || shell === 'powershell')
	)
		return `prompts are not supported in ${shell ?? 'this shell'}`;
	return undefined;
}

/**
 * Check and normalise an initial prompt: not empty, bounded, no control
 * characters except newlines (folded to spaces), and never something that
 * reads as a flag. Returns the prompt to send, or a reason it was refused.
 */
export function normaliseLauncherPrompt(
	value: unknown,
): { readonly prompt: string } | { readonly problem: string } {
	if (typeof value !== 'string') return { problem: 'prompt must be text' };
	if (value.length > LAUNCHER_PROMPT_MAX_LENGTH)
		return { problem: `prompt is longer than ${LAUNCHER_PROMPT_MAX_LENGTH} characters` };
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
	if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value))
		return { problem: 'prompt contains control characters' };
	const prompt = value.replace(/\r\n|\r|\n/gu, ' ').trim();
	if (prompt.length === 0) return { problem: 'prompt is empty' };
	if (prompt.startsWith('-')) return { problem: 'prompt cannot start with "-"' };
	return { prompt };
}

/**
 * The line typed into a new terminal's shell to start a launcher's program:
 * its absolute path, then a matching command default's flags (ADR-0081), then
 * an initial prompt as one argument (ADR-0105), each quoted for that shell,
 * and nothing else. Callers check the prompt and shell first; a prompt this
 * cannot quote safely is dropped rather than sent.
 */
export function launcherCommandLine(
	executable: string,
	shellPath: string,
	defaultArgs: readonly string[] = [],
	prompt?: string,
): string {
	const shell = shellName(shellPath);
	// Flags are refused unless they pass the registry's rules, so a launcher
	// line is never more than its path when something unexpected arrives.
	const flags = isTerminalCommandDefaultArgs(defaultArgs) ? defaultArgs : [];
	const checked =
		prompt === undefined || launcherPromptShellProblem(shellPath) !== undefined
			? undefined
			: normaliseLauncherPrompt(prompt);
	const args =
		checked !== undefined && 'prompt' in checked
			? [...flags, checked.prompt]
			: flags;
	if (shell === 'cmd') {
		// cmd has no quoting that stops %VAR% expansion, so only plain flags go.
		const plain = args.every((arg) => /^[-\w=.,:/+@]+$/u.test(arg));
		return `${[executable, ...(plain ? args : [])].map((part) => `"${part.replace(/"/gu, '')}"`).join(' ')}\r`;
	}
	if (shell === 'pwsh' || shell === 'powershell')
		// PowerShell also ends a single-quoted string at typographic single quotes.
		return `& ${[executable, ...args].map((part) => `'${part.replace(/['\u2018\u2019\u201a\u201b]/gu, '$&$&')}'`).join(' ')}\r`;
	// fish reads \\ and \' inside single quotes; POSIX shells read neither.
	if (shell === 'fish')
		return `${[executable, ...args].map((part) => `'${part.replace(/[\\']/gu, '\\$&')}'`).join(' ')}\r`;
	return `${[executable, ...args].map((part) => `'${part.replace(/'/gu, `'\\''`)}'`).join(' ')}\r`;
}
