/** The always-on startup phase timeline.
 *
 * This is deliberately not a diagnostic collector. It never reaches the
 * diagnostics writer, the Diagnostics folder, or any file: it holds one
 * monotonic offset per phase boundary in memory for the life of the process,
 * so it costs nothing a launch can feel and adds nothing to the always-on
 * collector's event and burst budget.
 *
 * Phase ids are a closed union with a product-authored label each. That is
 * what makes the label safe to paint on the pre-server loading document: the
 * string shown is chosen from this table, never interpolated from a path,
 * identifier, host, or error. */

/** Top-level startup phases, in the order Desktop main runs them. */
export const STARTUP_PHASE_IDS = [
	'electron-ready',
	'startup-window',
	'first-paint',
	'workspace-restore',
	'server-compose',
	'workspace-init',
	'mcp-endpoint',
	'bundle-hosts',
	'remote-exposure',
	'vault-unlock',
	'native-menu',
	'agent-integration',
	'ui-handoff',
] as const;

export type StartupPhaseId = (typeof STARTUP_PHASE_IDS)[number];

/** Sub-phases are one level deep only. A sub-phase is attributed to the
 * top-level phase that was running when it began. */
export const STARTUP_SUB_PHASE_IDS = [
	'vault-open',
	'project-environments-load',
	'shell-profiles-load',
	'extension-host-start',
	'built-in-extensions-stage',
] as const;

export type StartupSubPhaseId = (typeof STARTUP_SUB_PHASE_IDS)[number];

export type StartupPhaseOutcome = 'running' | 'completed' | 'failed';

/** The user-visible name for each phase. Total over both unions by
 * construction, so there is no fallback string to leak an id. */
const STARTUP_PHASE_LABELS: Readonly<
	Record<StartupPhaseId | StartupSubPhaseId, string>
> = Object.freeze({
	'electron-ready': 'Starting Terminay',
	'startup-window': 'Creating the window',
	'first-paint': 'Opening the window',
	'workspace-restore': 'Restoring your workspace',
	'server-compose': 'Starting the local server',
	'workspace-init': 'Preparing projects',
	'mcp-endpoint': 'Starting agent control',
	'bundle-hosts': 'Preparing the workspace UI',
	'remote-exposure': 'Preparing remote access',
	'vault-unlock': 'Unlocking secure storage',
	'native-menu': 'Building menus',
	'agent-integration': 'Applying agent settings',
	'ui-handoff': 'Loading the workspace',
	'vault-open': 'Opening secure storage',
	'project-environments-load': 'Loading project environments',
	'shell-profiles-load': 'Loading shell profiles',
	'extension-host-start': 'Starting extensions',
	'built-in-extensions-stage': 'Preparing built-in extensions',
});

export function startupPhaseLabel(
	id: StartupPhaseId | StartupSubPhaseId,
): string {
	return STARTUP_PHASE_LABELS[id];
}

export interface StartupPhaseRecord {
	readonly id: StartupPhaseId | StartupSubPhaseId;
	readonly label: string;
	/** Milliseconds from the timeline's origin, which is process start. */
	readonly startOffsetMs: number;
	/** Absent while the phase is still running. */
	readonly durationMs?: number;
	readonly outcome: StartupPhaseOutcome;
	/** Present only on a failed phase; a bounded product-authored reason. */
	readonly failureReason?: string;
	/** Present on sub-phases: the top-level phase running when it began. */
	readonly parentId?: StartupPhaseId;
}

export interface StartupTimelineSnapshot {
	readonly phases: readonly StartupPhaseRecord[];
	/** True once `ui-handoff` has completed. */
	readonly complete: boolean;
	/** Total elapsed milliseconds to the last closed phase. */
	readonly totalMs: number;
}

interface MutablePhase {
	id: StartupPhaseId | StartupSubPhaseId;
	startOffsetMs: number;
	durationMs?: number;
	outcome: StartupPhaseOutcome;
	failureReason?: string;
	parentId?: StartupPhaseId;
}

function isTopLevel(
	id: StartupPhaseId | StartupSubPhaseId,
): id is StartupPhaseId {
	return (STARTUP_PHASE_IDS as readonly string[]).includes(id);
}

export interface StartupTimelineOptions {
	/** Monotonic clock. Defaults to `performance.now()`. */
	readonly now?: () => number;
}

/** Records when each named startup phase began and ended. */
export class StartupTimeline {
	private readonly now: () => number;
	private readonly origin: number;
	private readonly phases: MutablePhase[] = [];
	private currentTopLevel: StartupPhaseId | undefined;

	constructor(options: StartupTimelineOptions = {}) {
		this.now = options.now ?? (() => performance.now());
		this.origin = this.now();
	}

	/** Open a phase. Re-opening a phase that is already running is ignored so
	 * a retried startup step cannot corrupt an earlier measurement. */
	begin(id: StartupPhaseId | StartupSubPhaseId): void {
		if (this.findRunning(id) !== undefined) return;
		const phase: MutablePhase = {
			id,
			startOffsetMs: this.now() - this.origin,
			outcome: 'running',
		};
		if (isTopLevel(id)) this.currentTopLevel = id;
		else if (this.currentTopLevel !== undefined)
			phase.parentId = this.currentTopLevel;
		this.phases.push(phase);
	}

	/** Close a running phase. Closing one that is not running is ignored. */
	end(id: StartupPhaseId | StartupSubPhaseId): void {
		const phase = this.findRunning(id);
		if (phase === undefined) return;
		phase.durationMs = this.now() - this.origin - phase.startOffsetMs;
		phase.outcome = 'completed';
	}

	/** Close every still-running phase as failed. Called when startup fails, so
	 * the phase that was running is identifiable and the phases that completed
	 * before it keep their recorded durations. */
	fail(reason: string): void {
		for (const phase of this.phases) {
			if (phase.outcome !== 'running') continue;
			phase.durationMs = this.now() - this.origin - phase.startOffsetMs;
			phase.outcome = 'failed';
			phase.failureReason = reason;
		}
	}

	/** The phase whose label the loading document should currently show. */
	currentLabel(): string | undefined {
		for (let index = this.phases.length - 1; index >= 0; index -= 1) {
			const phase = this.phases[index];
			if (phase !== undefined && phase.outcome === 'running')
				return startupPhaseLabel(phase.id);
		}
		return undefined;
	}

	snapshot(): StartupTimelineSnapshot {
		const phases = this.phases.map((phase) =>
			Object.freeze({
				id: phase.id,
				label: startupPhaseLabel(phase.id),
				startOffsetMs: phase.startOffsetMs,
				outcome: phase.outcome,
				...(phase.durationMs === undefined
					? {}
					: { durationMs: phase.durationMs }),
				...(phase.failureReason === undefined
					? {}
					: { failureReason: phase.failureReason }),
				...(phase.parentId === undefined ? {} : { parentId: phase.parentId }),
			}),
		);
		const handoff = this.phases.find((phase) => phase.id === 'ui-handoff');
		let totalMs = 0;
		for (const phase of this.phases) {
			if (phase.durationMs === undefined) continue;
			totalMs = Math.max(totalMs, phase.startOffsetMs + phase.durationMs);
		}
		return Object.freeze({
			phases: Object.freeze(phases),
			complete: handoff?.outcome === 'completed',
			totalMs,
		});
	}

	private findRunning(
		id: StartupPhaseId | StartupSubPhaseId,
	): MutablePhase | undefined {
		return this.phases.find(
			(phase) => phase.id === id && phase.outcome === 'running',
		);
	}
}
