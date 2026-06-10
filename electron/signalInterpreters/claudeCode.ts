import type { ProtocolSignal } from '../../src/types/terminalSignals'
import {
  type InterpreterSessionState,
  type SessionContext,
  type SignalInterpreter,
  deriveActivity,
} from './types'
import { DEFAULT_PROGRESS_STALE_MS } from './generic'

const CLAUDE_PROCESS = /claude/i

/**
 * Claude Code holds an OSC 9;4 progress sequence for the whole agent turn
 * (state 3 while working, state 0 when the turn ends) and emits a notification
 * when it finishes or needs permission. Progress is therefore the turn boundary;
 * a notification means "needs you". The profile claims the session so the
 * renderer ignores raw output (the rotating tips/spinner repaints).
 *
 * If process-name matching misses (Claude may report as `node`), the generic
 * interpreter still handles the identical progress sequences correctly — this
 * profile only adds the notification→attention semantics and pre-progress claim.
 */
export function createClaudeCodeInterpreter(staleMs = DEFAULT_PROGRESS_STALE_MS): SignalInterpreter {
  return {
    id: 'claude-code',
    matches(context: SessionContext) {
      return context.foregroundProcess !== null && CLAUDE_PROCESS.test(context.foregroundProcess)
    },
    interpret(signal: ProtocolSignal, session: InterpreterSessionState) {
      switch (signal.kind) {
        case 'foreground':
          session.foregroundBusy = signal.busy
          session.foregroundProcess = signal.processName
          session.claimedBy = 'claude-code'
          session.lastSource = 'claude-code:foreground'
          return deriveActivity(session)
        case 'progress':
          session.claimedBy = 'claude-code'
          session.lastSource = 'claude-code:progress'
          if (signal.state === 0) {
            session.progressBusy = false
            session.clearDeadline()
          } else {
            session.progressBusy = true
            session.sawExplicit = true
            session.scheduleDeadline(staleMs)
          }
          return deriveActivity(session)
        case 'notification':
        case 'bell':
          session.claimedBy = 'claude-code'
          session.lastSource = `claude-code:${signal.kind}`
          session.attention = true
          return deriveActivity(session)
        default:
          // command / userInput: let the generic interpreter handle them.
          return null
      }
    },
    onDeadline(session: InterpreterSessionState) {
      session.progressBusy = false
      session.lastSource = 'claude-code:stale'
      return deriveActivity(session)
    },
  }
}
