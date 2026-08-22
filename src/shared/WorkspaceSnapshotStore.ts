import { WorkspaceClient, type PanelActivationRequest, type PanelReorderRequest, type PanelSplitRequest, type PanelUpdateRequest, type ProjectActivationRequest, type ProjectCreateRequest, type ProjectMoveRequest, type ProjectRootUpdateRequest, type ProjectSidebarUpdateRequest, type TerminayClient, type WorkspaceCommandOptions, type WorkspaceViewCreateRequest } from '@terminay/client-core'
import {
	parseServerWorkspaceSnapshot,
	parseServerWorkspaceDelta,
	type ServerWorkspaceSnapshot,
} from './serverWorkspaceReconciliation'
import { recordBootstrapDiagnostic } from './rendererDiagnostics'

export type WorkspaceSnapshotListener = (snapshot: ServerWorkspaceSnapshot) => void
export type WorkspaceReconciliationStatus = Readonly<{
	state: 'current' | 'stale' | 'failed'
	error?: Error
}>
export type WorkspaceStatusListener = (status: WorkspaceReconciliationStatus) => void

/**
 * One authenticated server connection owns one validated workspace projection.
 * Views subscribe to it; they do not each poll the server and invent their own
 * terminal/session scope.
 */
export class WorkspaceSnapshotStore {
	private readonly workspace: WorkspaceClient
	private readonly listeners = new Set<WorkspaceSnapshotListener>()
	private readonly statusListeners = new Set<WorkspaceStatusListener>()
	private known: ServerWorkspaceSnapshot | null = null
	private reconciliationStatus: WorkspaceReconciliationStatus = { state: 'stale' }
	private unsubscribeEvents: (() => Promise<void>) | undefined
	private refreshPromise: Promise<ServerWorkspaceSnapshot> | null = null
	private refreshAgain = false
	private forceSnapshot = false
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
	get status(): WorkspaceReconciliationStatus { return this.reconciliationStatus }

	subscribe(listener: WorkspaceSnapshotListener): () => void {
		this.listeners.add(listener)
		if (this.known !== null) listener(this.known)
		return () => this.listeners.delete(listener)
	}

	subscribeStatus(listener: WorkspaceStatusListener): () => void {
		this.statusListeners.add(listener)
		listener(this.reconciliationStatus)
		return () => this.statusListeners.delete(listener)
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
				void this.refresh().catch((error) => this.reportBackgroundFailure(error))
			})
			const removeResync = subscription.onResync(() => {
				this.forceSnapshot = true
				this.markStatus({ state: 'stale', error: new Error('Workspace event history requires resynchronization.') })
				void this.refresh().catch((error) => this.reportBackgroundFailure(error))
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
		const promise = this.refreshUntilSettled()
		this.refreshPromise = promise
		try {
			return await promise
		} finally {
			if (this.refreshPromise === promise) {
				this.refreshPromise = null
			}
		}
	}

	private async refreshUntilSettled(): Promise<ServerWorkspaceSnapshot> {
		let snapshot: ServerWorkspaceSnapshot | null = null
		do {
			this.refreshAgain = false
			snapshot = await this.fetchAndPublish()
		} while (this.refreshAgain && !this.closed)
		return snapshot
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
			// Change events are an acceleration signal, not a delivery guarantee. A
			// command response establishes that the authority may have advanced, so
			// explicitly reconcile after installing the listener. This closes both
			// the command/event ordering window and a lost-event recovery window.
			void this.refresh().catch((error) => {
				if (settled) return
				settled = true
				window.clearTimeout(timeout)
				unsubscribe()
				this.reportBackgroundFailure(error)
				resolve(null)
			})
		})
	}

	private async fetchAndPublish(): Promise<ServerWorkspaceSnapshot> {
		const previous = this.known
		let snapshot: ServerWorkspaceSnapshot
		if (previous === null || this.forceSnapshot) {
			this.forceSnapshot = false
			const value = await this.workspace.snapshot()
			recordBootstrapDiagnostic('workspace.snapshot.received')
			snapshot = parseServerWorkspaceSnapshot(value, this.options.serverId, previous)
		} else {
			try {
				const value = await this.workspace.delta(previous.revision, previous.cursor)
				recordBootstrapDiagnostic('workspace.delta.received')
				snapshot = parseServerWorkspaceDelta(value, this.options.serverId, previous).state
			} catch (error) {
				this.markStatus({ state: 'stale', error: asError(error) })
				recordBootstrapDiagnostic('workspace.delta.invalid')
				try {
					const recovery = await this.workspace.snapshot()
					recordBootstrapDiagnostic('workspace.snapshot.recovery.received')
					snapshot = parseServerWorkspaceSnapshot(recovery, this.options.serverId, previous)
				} catch (recoveryError) {
					this.markStatus({ state: 'failed', error: asError(recoveryError) })
					recordBootstrapDiagnostic('workspace.snapshot.recovery.failed')
					throw recoveryError
				}
			}
		}
		if (this.closed) throw new Error('workspace snapshot store is closed')
		recordBootstrapDiagnostic('workspace.snapshot.normalized')
		this.known = snapshot
		this.markStatus({ state: 'current' })
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

	private markStatus(status: WorkspaceReconciliationStatus): void {
		this.reconciliationStatus = status
		for (const listener of [...this.statusListeners]) listener(status)
	}

	private reportBackgroundFailure(error: unknown): void {
		const normalized = asError(error)
		this.markStatus({ state: 'failed', error: normalized })
		recordBootstrapDiagnostic('workspace.reconciliation.failed')
		console.warn('workspace reconciliation failed', normalized.name)
	}

	/** Keep the only presentation mutation on the same authenticated workspace
	 * authority as snapshot reconciliation. */
	async activatePanel(request: PanelActivationRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.activatePanel(request, options)
	}

	async reorderPanels(request: PanelReorderRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.reorderPanels(request, options)
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

	async updateProjectSidebar(request: ProjectSidebarUpdateRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.updateProjectSidebar(request, options)
	}

	async activateProject(request: ProjectActivationRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.activateProject(request, options)
	}

	async closeProject(projectId: string, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.closeProject(projectId, options)
	}

	async createView(request: WorkspaceViewCreateRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.createView(request, options)
	}

	async moveProject(request: ProjectMoveRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.moveProject(request, options)
	}

	async closeView(viewId: string, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.closeView(viewId, options)
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
		this.statusListeners.clear()
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error('Workspace reconciliation failed.', { cause: error })
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
