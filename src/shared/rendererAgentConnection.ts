import type { AgentClientEntry, AgentClientSnapshot, AgentStatusClient } from '@terminay/client-core'
import { isAgentProvider } from '../types/agentStatus'
import type {
	AgentCompletionOutcome,
	AgentLifecycleEvent,
	AgentModelMetadata,
	AgentState,
	AgentStatusEntry,
	AgentStatusSnapshot,
	AgentToolStatus,
} from '../types/agentStatus'

const EVENT_KINDS = new Set<AgentLifecycleEvent['kind']>([
	'session.started', 'agent.metadata', 'session.stopped', 'turn.started', 'tool.started', 'tool.finished',
	'wait.started', 'wait.finished', 'agent.done', 'subagent.started', 'subagent.stopped', 'agent.exited',
])
const OUTCOMES = new Set<AgentCompletionOutcome>(['success', 'error', 'cancelled'])

/** Explicitly adapt the reduced, authenticated wire projection into the
 * existing shared UI model. No Electron preload state is consulted here. */
export function adaptServerAgentSnapshot(source: AgentClientSnapshot): AgentStatusSnapshot {
	const entries: Record<string, AgentStatusEntry> = {}
	for (const [entryId, value] of Object.entries(source.entries)) {
		const entry = adaptEntry(value)
		if (entry.entryId !== entryId) throw new TypeError('server agent entry key mismatch')
		entries[entryId] = entry
	}
	return Object.freeze({ revision: source.revision, entries: Object.freeze(entries), eventCursors: Object.freeze({}) })
}

export function subscribeServerAgentSnapshots(client: AgentStatusClient, listener: (snapshot: AgentStatusSnapshot) => void): () => void {
	listener(adaptServerAgentSnapshot(client.snapshot))
	return client.onChange((snapshot) => listener(adaptServerAgentSnapshot(snapshot)))
}

function adaptEntry(value: AgentClientEntry): AgentStatusEntry {
	const record = value as Record<string, unknown>
	const string = (key: string, required = true): string | undefined => {
		const candidate = record[key]
		if (candidate === undefined && !required) return undefined
		if (typeof candidate !== 'string') throw new TypeError(`server agent ${key} is invalid`)
		return candidate
	}
	const integer = (key: string): number => {
		const candidate = record[key]
		if (!Number.isSafeInteger(candidate) || (candidate as number) < 0) throw new TypeError(`server agent ${key} is invalid`)
		return candidate as number
	}
	const provider = string('provider')
	const kind = string('kind')
	const state = string('state')
	if (!isAgentProvider(provider) || (kind !== 'root' && kind !== 'subagent') || !['working', 'waiting', 'blocked', 'done', 'idle'].includes(state ?? '')) throw new TypeError('server agent identity is invalid')
	if (typeof record.active !== 'boolean' || typeof record.unread !== 'boolean') throw new TypeError('server agent flags are invalid')
	const lastEventKind = string('lastEventKind') as AgentLifecycleEvent['kind']
	if (!EVENT_KINDS.has(lastEventKind)) throw new TypeError('server agent event kind is invalid')
	const activeTools = adaptTools(record.activeTools)
	const base = {
		entryId: string('entryId')!, kind, provider, agentId: string('agentId')!, sessionId: string('sessionId')!, activationTerminalSessionId: string('activationTerminalSessionId')!,
		...(optionalString(record, 'displayName')), ...(optionalString(record, 'promptText')), ...(optionalModel(record.model)),
		state: state as AgentState, stateStartedAt: integer('stateStartedAt'), updatedAt: integer('updatedAt'), lastEventKind, lastEventSequence: integer('lastEventSequence'),
		active: record.active, activeTools, ...(optionalString(record, 'currentTurnId')), ...(optionalString(record, 'waitingReason')),
		...(optionalOutcome(record, 'completionOutcome')), ...(optionalString(record, 'summary')), ...(optionalNumber(record, 'exitCode')), ...(optionalString(record, 'exitSignal')),
		unread: record.unread, ...(optionalNumber(record, 'acknowledgedAt')),
	}
	if (kind === 'root') {
		if (typeof record.terminalSessionId !== 'string' || record.inProcess !== false) throw new TypeError('server root agent shape is invalid')
		return Object.freeze({ ...base, kind: 'root', terminalSessionId: record.terminalSessionId, inProcess: false })
	}
	if (record.terminalSessionId !== null || record.inProcess !== true || typeof record.parentAgentId !== 'string' || typeof record.parentEntryId !== 'string') throw new TypeError('server subagent shape is invalid')
	return Object.freeze({ ...base, kind: 'subagent', terminalSessionId: null, inProcess: true, parentAgentId: record.parentAgentId, parentEntryId: record.parentEntryId })
}

function optionalString(record: Record<string, unknown>, key: string): Record<string, string> { return typeof record[key] === 'string' ? { [key]: record[key] as string } : {} }
function optionalNumber(record: Record<string, unknown>, key: string): Record<string, number> { return Number.isSafeInteger(record[key]) ? { [key]: record[key] as number } : {} }
function optionalOutcome(record: Record<string, unknown>, key: string): Record<string, AgentCompletionOutcome> { return OUTCOMES.has(record[key] as AgentCompletionOutcome) ? { [key]: record[key] as AgentCompletionOutcome } : {} }
function optionalModel(value: unknown): Record<string, AgentModelMetadata> {
	if (value === undefined) return {}
	if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof (value as Record<string, unknown>).id !== 'string') throw new TypeError('server agent model is invalid')
	const model = value as Record<string, unknown>
	return { model: { id: model.id as string, ...(typeof model.displayName === 'string' ? { displayName: model.displayName } : {}), ...(typeof model.reasoningEffort === 'string' ? { reasoningEffort: model.reasoningEffort } : {}), ...(Number.isSafeInteger(model.contextWindowTokens) ? { contextWindowTokens: model.contextWindowTokens as number } : {}) } }
}
function adaptTools(value: unknown): readonly AgentToolStatus[] {
	if (!Array.isArray(value)) throw new TypeError('server agent tools are invalid')
	return Object.freeze(value.map((candidate) => {
		if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) throw new TypeError('server agent tool is invalid')
		const tool = candidate as Record<string, unknown>
		if (typeof tool.id !== 'string' || typeof tool.name !== 'string' || !Number.isSafeInteger(tool.startedAt)) throw new TypeError('server agent tool is invalid')
		return Object.freeze({ id: tool.id, name: tool.name, startedAt: tool.startedAt as number, ...(typeof tool.description === 'string' ? { description: tool.description } : {}) })
	}))
}
