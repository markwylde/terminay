/**
 * Terminal activity signals shared between the pty host (parser + interpreters),
 * the Electron IPC layer, and the renderer display store.
 *
 * `ProtocolSignal` is the low-level "what sequence arrived" produced by the
 * parser. `SemanticActivity` is the interpreted "what it means for this tab"
 * produced by the interpreter runtime and consumed by the renderer.
 *
 * See specs/TERMINAL_ACTIVITY_SIGNALS.md for the full design.
 */

/** Progress states from the ConEmu / Windows Terminal OSC 9;4 protocol. */
export type ProgressState = 0 | 1 | 2 | 3 | 4;

/** Command lifecycle phases from the FinalTerm / VS Code OSC 133/633 protocol. */
export type CommandPhase =
	| 'prompt'
	| 'input'
	| 'executing'
	| 'finished'
	| 'aborted';

export type ProtocolSignal =
	| { kind: 'progress'; state: ProgressState; progress?: number }
	| { kind: 'command'; phase: CommandPhase; exitCode?: number }
	| { kind: 'notification'; title?: string; body?: string }
	| { kind: 'bell' }
	| { kind: 'foreground'; busy: boolean; processName: string }
	| { kind: 'userInput' };

export type SemanticActivity = {
	/** Whether the session is actively working. */
	status: 'working' | 'idle';
	/** The session asked for the user (notification/bell). Sticky in the renderer. */
	attention: boolean;
	/**
	 * True when a trusted interpreter owns this session; the renderer must then
	 * ignore the raw-output fallback heuristic for it.
	 */
	claimed: boolean;
	/** Exit code captured from the last finished shell command, if any. */
	exitCode?: number;
	/** Interpreter id + signal kind that produced this snapshot, for debugging. */
	source: string;
};

/** IPC payload delivered to the renderer for each session activity change. */
export type TerminalActivityMessage = {
	id: string;
	activity: SemanticActivity;
};
