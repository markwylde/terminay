import {
	ProgramTitleCoalescer,
	type ProgramTitleCoalescerOptions,
	sanitiseProgramTitle,
} from './activity/programTitle.js';
import type { TerminalActivityService } from './activity/service.js';
import type { WorkspaceCommand, WorkspaceState } from './workspace.js';

export interface ProgramTitleBindingOptions {
	readonly activity: Pick<TerminalActivityService, 'setProgramTitleListener'>;
	readonly workspace: () => WorkspaceState;
	readonly apply: (commandId: string, command: WorkspaceCommand) => unknown;
	/** The `programSetTabTitles` server setting, read when it is needed. */
	readonly enabled: () => boolean;
	readonly windowMs?: ProgramTitleCoalescerOptions['windowMs'];
	readonly setTimeout?: ProgramTitleCoalescerOptions['setTimeout'];
	readonly clearTimeout?: ProgramTitleCoalescerOptions['clearTimeout'];
}

export interface ProgramTitleBinding {
	/** Bring stored titles in line with the setting: when it is off, no
	 * terminal holds a program title. Call when the setting may have changed. */
	readonly reconcile: () => void;
	readonly dispose: () => void;
}

/**
 * Carry the titles programs write to their terminals into workspace state.
 * This is the only path by which PTY output reaches a panel (ADR-0056): the
 * server reads it, sanitises it, stores it beneath any name a person gave, and
 * commits it at a bounded rate.
 */
export function bindProgramTitles(
	options: ProgramTitleBindingOptions,
): ProgramTitleBinding {
	let serial = 0;
	const commandId = (kind: string): string =>
		`program-title:${kind}:${Date.now().toString(36)}:${(serial++).toString(36)}`.slice(
			0,
			128,
		);
	const coalescer = new ProgramTitleCoalescer({
		commit: (sessionId, title) => {
			if (!options.enabled()) return;
			const panel = Object.values(options.workspace().panels).find(
				(candidate) =>
					candidate.type === 'terminal' && candidate.sessionId === sessionId,
			);
			if (panel === undefined || panel.type !== 'terminal') return;
			if (panel.programTitle === title) return;
			try {
				options.apply(commandId('set'), {
					type: 'panel.programTitle.set',
					panelId: panel.id,
					title: title ?? null,
				});
			} catch {
				// A title is presentation; failing to store one never reaches the PTY.
			}
		},
		...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
		...(options.setTimeout === undefined
			? {}
			: { setTimeout: options.setTimeout }),
		...(options.clearTimeout === undefined
			? {}
			: { clearTimeout: options.clearTimeout }),
	});
	options.activity.setProgramTitleListener((identity, raw) => {
		if (!options.enabled()) return;
		coalescer.push(identity.sessionId, sanitiseProgramTitle(raw));
	});
	return {
		reconcile: () => {
			if (options.enabled()) return;
			coalescer.dispose();
			const held = Object.values(options.workspace().panels).some(
				(panel) => panel.type === 'terminal' && panel.programTitle !== undefined,
			);
			if (!held) return;
			try {
				options.apply(commandId('clear'), {
					type: 'panel.programTitles.clear',
				});
			} catch {
				// As above.
			}
		},
		dispose: () => {
			options.activity.setProgramTitleListener(undefined);
			coalescer.dispose();
		},
	};
}
