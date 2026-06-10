import type { ProtocolSignal, SemanticActivity } from '../../src/types/terminalSignals'
import { createClaudeCodeInterpreter } from './claudeCode'
import { createCodexInterpreter } from './codex'
import { DEFAULT_PROGRESS_STALE_MS, createGenericInterpreter } from './generic'
import { type InterpreterSessionState, type SignalInterpreter, deriveActivity } from './types'

export type InterpreterRuntimeOptions = {
  /** Name of the shell this session spawned, for foreground comparison. */
  shellProcess: string
  /** OSC 9;4 progress staleness window in ms. */
  staleMs?: number
  /** Called with a new snapshot whenever the emitted activity changes. */
  onActivity: (activity: SemanticActivity) => void
  /** Injectable timer hooks (tests pass fakes). Defaults to global timers. */
  setTimeout?: (handler: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export type InterpreterRuntime = {
  /** Feed a protocol signal through the interpreter chain. */
  push: (signal: ProtocolSignal) => void
  /** Tear down pending timers. */
  dispose: () => void
}

/**
 * Per-session interpreter runtime. Owns mutable session state and the deadline
 * timer; the interpreters themselves are pure logic. Profiles are tried in
 * order (most specific first); the first one whose `matches()` is true and whose
 * `interpret()` returns non-null wins, with the generic interpreter as the
 * always-matching terminus.
 */
export function createInterpreterRuntime(options: InterpreterRuntimeOptions): InterpreterRuntime {
  const staleMs = options.staleMs ?? DEFAULT_PROGRESS_STALE_MS
  const scheduleTimeout = options.setTimeout ?? ((handler, ms) => setTimeout(handler, ms))
  const cancelTimeout = options.clearTimeout ?? ((handle) => clearTimeout(handle as never))

  const interpreters: SignalInterpreter[] = [
    createClaudeCodeInterpreter(staleMs),
    createCodexInterpreter(),
    createGenericInterpreter(staleMs),
  ]
  const interpreterById = new Map(interpreters.map((interp) => [interp.id, interp]))

  let deadlineHandle: unknown = null
  let activeInterpreterId = 'generic'

  const session: InterpreterSessionState = {
    progressBusy: false,
    commandExecuting: false,
    foregroundBusy: false,
    foregroundProcess: null,
    shellProcess: options.shellProcess,
    agentBusy: false,
    sawExplicit: false,
    attention: false,
    claimedBy: null,
    lastSource: 'init',
    scheduleDeadline: (ms: number) => {
      if (deadlineHandle !== null) {
        cancelTimeout(deadlineHandle)
      }
      deadlineHandle = scheduleTimeout(onDeadlineFired, ms)
    },
    clearDeadline: () => {
      if (deadlineHandle !== null) {
        cancelTimeout(deadlineHandle)
        deadlineHandle = null
      }
    },
  }

  // Baseline; first real change emits. Matches the renderer's default
  // (unclaimed, idle) so nothing is sent until something actually happens.
  let lastEmitted: SemanticActivity = deriveActivity(session)

  function emitIfChanged(activity: SemanticActivity): void {
    if (
      activity.status === lastEmitted.status &&
      activity.attention === lastEmitted.attention &&
      activity.claimed === lastEmitted.claimed &&
      activity.exitCode === lastEmitted.exitCode
    ) {
      return
    }
    lastEmitted = activity
    options.onActivity(activity)
  }

  function onDeadlineFired(): void {
    deadlineHandle = null
    const result = interpreterById.get(activeInterpreterId)?.onDeadline?.(session)
    if (result) {
      emitIfChanged(result)
    }
  }

  function push(signal: ProtocolSignal): void {
    // Update the foreground identity up front so profile matching for a
    // foreground-change signal sees the new process this same tick.
    if (signal.kind === 'foreground') {
      session.foregroundProcess = signal.processName
      session.foregroundBusy = signal.busy
    }

    const context = {
      foregroundProcess: session.foregroundProcess,
      shellProcess: session.shellProcess,
      sawExplicit: session.sawExplicit,
    }

    for (const interpreter of interpreters) {
      if (!interpreter.matches(context)) {
        continue
      }
      const result = interpreter.interpret(signal, session)
      if (result !== null) {
        activeInterpreterId = interpreter.id
        emitIfChanged(result)
        return
      }
    }
  }

  return {
    push,
    dispose: () => {
      session.clearDeadline()
    },
  }
}
