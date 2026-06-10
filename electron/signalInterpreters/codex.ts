import type { ProtocolSignal } from '../../src/types/terminalSignals'
import {
  type InterpreterSessionState,
  type SessionContext,
  type SignalInterpreter,
  deriveActivity,
} from './types'

const CODEX_PROCESS = /codex/i

/**
 * Codex CLI emits NO progress sequences — only an OSC 9 / BEL notification on
 * `agent-turn-complete` or `approval-requested`. Its spinner repaints would
 * flicker the raw-output fallback, so this profile claims the session (raw
 * output ignored) and models the turn boundary explicitly:
 *
 * - while codex is the foreground app → working (agentBusy)
 * - a notification → idle + attention (turn complete / needs approval)
 * - the user responding (input) → working again (next turn)
 *
 * `agentBusy` is the only thing driving working/idle for a codex session — see
 * the codex branch of {@link deriveActivity}.
 */
export function createCodexInterpreter(): SignalInterpreter {
  return {
    id: 'codex',
    matches(context: SessionContext) {
      return context.foregroundProcess !== null && CODEX_PROCESS.test(context.foregroundProcess)
    },
    interpret(signal: ProtocolSignal, session: InterpreterSessionState) {
      switch (signal.kind) {
        case 'foreground':
          session.foregroundBusy = signal.busy
          session.foregroundProcess = signal.processName
          session.claimedBy = 'codex'
          session.lastSource = 'codex:foreground'
          session.agentBusy = signal.busy
          return deriveActivity(session)
        case 'notification':
        case 'bell':
          session.claimedBy = 'codex'
          session.lastSource = `codex:${signal.kind}`
          session.agentBusy = false
          session.attention = true
          return deriveActivity(session)
        case 'userInput':
          // The user responded to a finished/blocked turn — codex resumes work
          // and the attention request is resolved.
          session.claimedBy = 'codex'
          session.lastSource = 'codex:input'
          session.agentBusy = true
          session.attention = false
          return deriveActivity(session)
        default:
          // progress / command: codex doesn't emit these; ignore.
          return null
      }
    },
  }
}
