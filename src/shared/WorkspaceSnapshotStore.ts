import { WorkspaceClient, type PanelActivationRequest, type PanelSplitRequest, type PanelUpdateRequest, type ProjectActivationRequest, type ProjectCreateRequest, type ProjectRootUpdateRequest, type TerminayClient, type WorkspaceCommandOptions } from '@terminay/client-core'
import {
	parseServerWorkspaceSnapshot,
	type ServerWorkspaceSnapshot,
} from './serverWorkspaceReconciliation'

export type WorkspaceSnapshotListener = (snapshot: ServerWorkspaceSnapshot) => void

/**
 * One authenticated server connection owns one validated workspace projection.
 * Views subscribe to it; they do not each poll the server and invent their own
 * terminal/session scope.
 */
export class WorkspaceSnapshotStore {
	private readonly workspace: WorkspaceClient
	private readonly listeners = new Set<WorkspaceSnapshotListener>()
	private known: ServerWorkspaceSnapshot | null = null
	private unsubscribeEvents: (() => Promise<void>) | undefined
	private refreshPromise: Promise<ServerWorkspaceSnapshot> | null = null
	private refreshAgain = false
	private publishing = false
	private closed = false

	constructor(
		private readonly options: Readonly<{
			client: TerminayClient
			serverId: string
		}>,
	) {
		this.workspace = new WorkspaceClient(options.client)
	}

	get snapshot(): ServerWorkspaceSnapshot | null { return this.known }

	subscribe(listener: WorkspaceSnapshotListener): () => void {
		this.listeners.add(listener)
		if (this.known !== null) listener(this.known)
		return () => this.listeners.delete(listener)
	}

	async start(): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		if (this.known !== null) return
		await this.subscribeToChanges()
		await this.loadInitialSnapshot()
	}

	/** Establish the live journal before loading the initial snapshot so a
	 * workspace change cannot be lost in the snapshot/subscription window. */
	async subscribeToChanges(): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		if (this.unsubscribeEvents === undefined) {
			const subscription = await this.options.client.subscribe('workspace.changed')
			const removeEvent = subscription.onEvent((event) => {
				const payload = event.payload
				if (!isWorkspaceChange(payload, this.options.serverId)) return
				if (this.known !== null && payload.revision <= this.known.revision) return
				void this.refresh().catch(() => undefined)
			})
			const removeResync = subscription.onResync(() => {
				this.known = null
				void this.refresh().catch(() => undefined)
			})
			this.unsubscribeEvents = async () => {
				removeEvent()
				removeResync()
				await subscription.unsubscribe()
			}
		}
	}

	async loadInitialSnapshot(): Promise<ServerWorkspaceSnapshot> {
		return this.refresh()
	}

	async refresh(): Promise<ServerWorkspaceSnapshot> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		if (this.refreshPromise !== null) {
			this.refreshAgain = true
			return this.refreshPromise
		}
		this.refreshAgain = false
		const promise = this.fetchAndPublish()
		this.refreshPromise = promise
		try {
			return await promise
		} finally {
			if (this.refreshPromise === promise) {
				this.refreshPromise = null
			}
			if (this.refreshAgain && !this.closed) {
				this.refreshAgain = false
				void this.refresh().catch(() => undefined)
			}
		}
	}

	async waitForSnapshot(
		predicate: (snapshot: ServerWorkspaceSnapshot) => boolean,
		options: { timeoutMs?: number } = {},
	): Promise<ServerWorkspaceSnapshot | null> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		if (this.known !== null && predicate(this.known)) return this.known
		const timeoutMs = options.timeoutMs ?? 2_000
		return await new Promise<ServerWorkspaceSnapshot | null>((resolve) => {
			let settled = false
			let unsubscribe: () => void = () => undefined
			const timeout = window.setTimeout(() => {
				if (settled) return
				settled = true
				unsubscribe()
				resolve(null)
			}, timeoutMs)
			unsubscribe = this.subscribe((snapshot) => {
				if (settled || !predicate(snapshot)) return
				settled = true
				window.clearTimeout(timeout)
				unsubscribe()
				resolve(snapshot)
			})
		})
	}

	private async fetchAndPublish(): Promise<ServerWorkspaceSnapshot> {
		const previous = this.known
		const value = previous === null
			? await this.workspace.snapshot()
			: await this.workspace.delta(previous.revision, previous.cursor)
		recordBootstrapDiagnostic(previous === null ? 'workspace.snapshot.received' : 'workspace.delta.received')
		if (this.closed) throw new Error('workspace snapshot store is closed')
		const snapshot = parseServerWorkspaceSnapshot(value, this.options.serverId, previous)
		recordBootstrapDiagnostic('workspace.snapshot.normalized')
		this.known = snapshot
		if (this.listeners.size > 256) throw new Error('workspace snapshot listener budget exceeded')
		if (this.publishing) throw new Error('workspace snapshot publish is reentrant')
		recordBootstrapDiagnostic('workspace.listeners.publish', this.listeners.size)
		this.publishing = true
		try {
			for (const listener of [...this.listeners]) listener(snapshot)
			recordBootstrapDiagnostic('workspace.listeners.complete', this.listeners.size)
		} finally {
			this.publishing = false
		}
		return snapshot
	}

	/** Keep the only presentation mutation on the same authenticated workspace
	 * authority as snapshot reconciliation. */
	async activatePanel(request: PanelActivationRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.activatePanel(request, options)
	}

	async splitPanel(request: PanelSplitRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.splitPanel(request, options)
	}

	async updatePanel(request: PanelUpdateRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.updatePanel(request, options)
	}

	async createProject(request: ProjectCreateRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.createProject(request, options)
	}

	async activateProject(request: ProjectActivationRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.activateProject(request, options)
	}

	async closeProject(projectId: string, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.closeProject(projectId, options)
	}

	async closePanel(panelId: string, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.closePanel(panelId, options)
	}

	async setProjectRoot(request: ProjectRootUpdateRequest, options: WorkspaceCommandOptions = {}) {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		const result = await this.workspace.updateProjectRoot(request, options)
		return result
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		void this.unsubscribeEvents?.().catch((error) => {
			if (!isExpectedDisconnect(error)) {
				console.warn('workspace snapshot subscription cleanup failed', error)
			}
		})
		this.unsubscribeEvents = undefined
		this.listeners.clear()
	}
}

function recordBootstrapDiagnostic(phase: string, count?: number): void {
	const diagnostic = (window as Window & {
		terminayBootstrapDiagnostic?: { record?: (phase: string, count?: number) => void }
	}).terminayBootstrapDiagnostic?.record
	diagnostic?.(phase, count)
}

function isWorkspaceChange(value: unknown, serverId: string): value is { readonly serverId: string; readonly revision: number; readonly cursor: string } {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& (value as { serverId?: unknown }).serverId === serverId
		&& Number.isSafeInteger((value as { revision?: unknown }).revision)
		&& ((value as { revision: number }).revision >= 0)
		&& (value as { cursor?: unknown }).cursor === String((value as { revision: number }).revision)
}

function isExpectedDisconnect(error: unknown): boolean {
	return error instanceof Error
		&& (
			error.name === 'ClientDisconnectedError'
			|| error.name === 'CommandOutcomeUnknownError'
			|| (error as { code?: unknown }).code === 'disconnected'
			|| (error as { code?: unknown }).code === 'unknown_command_outcome'
		)
}
