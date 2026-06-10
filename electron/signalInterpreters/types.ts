import type { ProtocolSignal, SemanticActivity } from '../../src/types/terminalSignals'

/**
 * Mutable per-session state shared by every interpreter. Interpreters react to
 * signals by mutating these fields; {@link deriveActivity} turns the full state
 * into the emitted {@link SemanticActivity}. Keeping derivation holistic (it
 * reads every field) is what lets one interpreter handle a signal another
 * interpreter "owns" without producing inconsistent snapshots.
 */
export type InterpreterSessionState = {
  /** OSC 9;4 progress is active (state !== 0). */
  progressBusy: boolean
  /** An OSC 133/633 command is executing (C seen, no D/A yet). */
  commandExecuting: boolean
  /** The tty foreground process differs from the spawned shell. */
  foregroundBusy: boolean
  /** Name of the current tty foreground process, from polling. */
  foregroundProcess: string | null
  /** Name of the shell this session spawned. */
  shellProcess: string
  /** Agent working between notification turn-boundaries (codex-style). */
  agentBusy: boolean
  /** Latch: a progress or command lifecycle sequence has ever been seen. */
  sawExplicit: boolean
  /** The session has asked for the user (notification/bell). */
  attention: boolean
  /** Exit code captured from the last finished shell command. */
  lastExitCode?: number
  /** Id of the interpreter that has claimed this session, if any. */
  claimedBy: string | null
  /** Interpreter id + signal kind that produced the latest mutation. */
  lastSource: string
  /** Schedule a one-shot deadline (e.g. progress staleness). Replaces any pending one. */
  scheduleDeadline: (ms: number) => void
  /** Cancel any pending deadline. */
  clearDeadline: () => void
}

/** Read-only context used by interpreters to decide whether they apply. */
export type SessionContext = {
  foregroundProcess: string | null
  shellProcess: string
  sawExplicit: boolean
}

export interface SignalInterpreter {
  readonly id: string
  /** Does this profile apply to the session right now? */
  matches(context: SessionContext): boolean
  /**
   * React to a signal by mutating `session` and returning the new activity, or
   * return `null` to fall through to the next interpreter in the chain.
   */
  interpret(signal: ProtocolSignal, session: InterpreterSessionState): SemanticActivity | null
  /** Fires when a scheduled deadline elapses (progress staleness timeout). */
  onDeadline?(session: InterpreterSessionState): SemanticActivity | null
}

/**
 * The single source of truth mapping session state to an emitted snapshot.
 * Every interpreter returns the result of this function.
 */
export function deriveActivity(session: InterpreterSessionState): SemanticActivity {
  let working: boolean
  if (session.claimedBy === 'codex') {
    // Codex emits no progress; its working state is the turn boundary tracked
    // in agentBusy (set on foreground/input, cleared on notification).
    working = session.agentBusy
  } else {
    working =
      session.progressBusy ||
      session.commandExecuting ||
      // Foreground process is a fallback only until an explicit signal latches.
      (session.foregroundBusy && !session.sawExplicit)
  }

  return {
    status: working ? 'working' : 'idle',
    attention: session.attention,
    claimed: session.claimedBy !== null || session.sawExplicit,
    exitCode: session.lastExitCode,
    source: session.lastSource,
  }
}
