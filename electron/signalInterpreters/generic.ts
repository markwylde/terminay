import type { ProtocolSignal } from '../../src/types/terminalSignals'
import { type InterpreterSessionState, type SignalInterpreter, deriveActivity } from './types'

/** Default staleness window for OSC 9;4 progress, overridable per runtime. */
export const DEFAULT_PROGRESS_STALE_MS = 15_000

/**
 * The catch-all interpreter. Implements the standard priority/arbitration rules
 * (progress > shell command > foreground process) and is sufficient for any app
 * emitting standard sequences. Always matches, always handles every signal kind
 * except bare user input.
 */
export function createGenericInterpreter(staleMs = DEFAULT_PROGRESS_STALE_MS): SignalInterpreter {
  return {
    id: 'generic',
    matches() {
      return true
    },
    interpret(signal: ProtocolSignal, session: InterpreterSessionState) {
      switch (signal.kind) {
        case 'progress':
          session.lastSource = 'generic:progress'
          if (signal.state === 0) {
            session.progressBusy = false
            session.clearDeadline()
          } else {
            session.progressBusy = true
            session.sawExplicit = true
            session.scheduleDeadline(staleMs)
          }
          return deriveActivity(session)
        case 'command':
          session.lastSource = 'generic:command'
          session.sawExplicit = true
          if (signal.phase === 'executing') {
            session.commandExecuting = true
          } else if (signal.phase === 'finished') {
            // A finish with no preceding `executing` is an aborted command line
            // (D right after B); ignore its exit code per the FinalTerm spec.
            if (session.commandExecuting) {
              session.lastExitCode = signal.exitCode
            }
            session.commandExecuting = false
          } else {
            // prompt / input / aborted all mean "not running a command".
            session.commandExecuting = false
          }
          return deriveActivity(session)
        case 'notification':
        case 'bell':
          session.lastSource = `generic:${signal.kind}`
          session.attention = true
          return deriveActivity(session)
        case 'foreground':
          session.lastSource = 'generic:foreground'
          session.foregroundBusy = signal.busy
          session.foregroundProcess = signal.processName
          return deriveActivity(session)
        case 'userInput':
          return null
      }
    },
    onDeadline(session: InterpreterSessionState) {
      // Progress went stale (the emitter died mid-turn); drop the busy state.
      session.progressBusy = false
      session.lastSource = 'generic:stale'
      return deriveActivity(session)
    },
  }
}
