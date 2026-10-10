import { WorkspaceClient, type FolderCreateRequest, type FolderRenameRequest, type FolderReorderRequest, type PanelActivationRequest, type PanelFolderMoveRequest, type PanelMoveRequest, type PanelReorderRequest, type PanelSplitRequest, type PanelUpdateRequest, type ProjectActivationRequest, type ProjectCreateRequest, type ProjectMoveRequest, type ProjectRootUpdateRequest, type ProjectSidebarUpdateRequest, type TerminayClient, type WorkspaceCommandOptions, type WorkspaceViewCreateRequest } from '@terminay/client-core'
import {
	parseServerWorkspaceSnapshot,
	type ServerWorkspaceSnapshot,
} from './serverWorkspaceReconciliation'
import { recordBootstrapDiagnostic } from './rendererDiagnostics'
import {
	advanceByWorkspaceDelta,
	applyWorkspaceChangeRecords,
	shareUnchangedWorkspaceObjects,
	type WorkspaceProjectionChange,
} from './workspaceProjection'

/** Told of each projection the store confirms, and of the one before it. An
 * object the change left alone is the same object in both (ADR-0059). */
export type WorkspaceSnapshotListener = (
	snapshot: ServerWorkspaceSnapshot,
	change: WorkspaceProjectionChange,
) => void
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
	/** The newest revision a change event has named while a refresh was in
	 * flight. The refresh fetches again only if its answer stops short of it. */
	private awaitedRevision = 0
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
		if (this.known !== null) listener(this.known, { previous: null })
		return () => this.listeners.delete(listener)
	}

	/**
	 * Observe one part of the projection. The listener is called when what
	 * `select` returns is no longer the value it returned before, and not
	 * otherwise: a change to another project, panel, or session is not heard.
	 * `select` must return a value held by the projection (or a primitive),
	 * never one it builds, or every projection would look like a change.
	 */
	subscribeSelection<T>(
		select: (snapshot: ServerWorkspaceSnapshot | null) => T,
		listener: (selected: T) => void,
	): () => void {
		let selected = select(this.known)
		return this.subscribeAny(() => {
			const next = select(this.known)
			if (Object.is(next, selected)) return
			selected = next
			listener(next)
		})
	}

	/** Called on every confirmed projection, without the replay `subscribe`
	 * gives a new listener. The shape `useSyncExternalStore` subscribes with. */
	subscribeAny(listener: () => void): () => void {
		const heard: WorkspaceSnapshotListener = () => listener()
		this.listeners.add(heard)
		return () => this.listeners.delete(heard)
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
				if (this.advanceByRecord(payload)) return
				void this.refreshTo(payload.revision).catch((error) => this.reportBackgroundFailure(error))
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

	/**
	 * Reach at least `revision`, which a change event named. A refresh already
	 * in flight usually answers with it, so the event only records how far the
	 * projection has to get; a second fetch is made if that answer falls short.
	 */
	private refreshTo(revision: number): Promise<ServerWorkspaceSnapshot> {
		if (this.refreshPromise === null) return this.refresh()
		this.awaitedRevision = Math.max(this.awaitedRevision, revision)
		return this.refreshPromise
	}

	private async refreshUntilSettled(): Promise<ServerWorkspaceSnapshot> {
		let snapshot: ServerWorkspaceSnapshot | null = null
		do {
			this.refreshAgain = false
			snapshot = await this.fetchAndPublish()
		} while ((this.refreshAgain || this.awaitedRevision > snapshot.revision) && !this.closed)
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

	/**
	 * Advance by the change record a `workspace.changed` event carries, without
	 * asking the server anything. This is the ordinary path. It is declined,
	 * and the caller asks for a delta, when the event carries no record, when
	 * the record does not start from the revision held (a change was missed),
	 * when a refresh is already deciding the next projection, or when the
	 * record does not yield a valid projection. Nothing is changed when it is
	 * declined.
	 */
	private advanceByRecord(payload: { readonly record?: unknown }): boolean {
		const previous = this.known
		if (
			payload.record === undefined ||
			previous === null ||
			this.refreshPromise !== null ||
			this.forceSnapshot ||
			this.publishing
		)
			return false
		let snapshot: ServerWorkspaceSnapshot
		try {
			snapshot = applyWorkspaceChangeRecords(previous, [payload.record], this.options.serverId)
		} catch {
			recordBootstrapDiagnostic('workspace.record.declined')
			return false
		}
		recordBootstrapDiagnostic('workspace.record.applied')
		this.publish(snapshot, previous)
		return true
	}

	private async fetchAndPublish(): Promise<ServerWorkspaceSnapshot> {
		const previous = this.known
		let snapshot: ServerWorkspaceSnapshot
		if (previous === null || this.forceSnapshot) {
			this.forceSnapshot = false
			const value = await this.workspace.snapshot()
			recordBootstrapDiagnostic('workspace.snapshot.received')
			snapshot = shareUnchangedWorkspaceObjects(
				previous,
				parseServerWorkspaceSnapshot(value, this.options.serverId, previous),
			)
		} else {
			try {
				const value = await this.workspace.delta(previous.revision, previous.cursor)
				recordBootstrapDiagnostic('workspace.delta.received')
				snapshot = advanceByWorkspaceDelta(previous, value, this.options.serverId)
			} catch (error) {
				this.markStatus({ state: 'stale', error: asError(error) })
				recordBootstrapDiagnostic('workspace.delta.invalid')
				try {
					const recovery = await this.workspace.snapshot()
					recordBootstrapDiagnostic('workspace.snapshot.recovery.received')
					snapshot = shareUnchangedWorkspaceObjects(
						previous,
						parseServerWorkspaceSnapshot(recovery, this.options.serverId, previous),
					)
				} catch (recoveryError) {
					this.markStatus({ state: 'failed', error: asError(recoveryError) })
					recordBootstrapDiagnostic('workspace.snapshot.recovery.failed')
					throw recoveryError
				}
			}
		}
		if (this.closed) throw new Error('workspace snapshot store is closed')
		// No record is applied while a fetch is in flight, so the projection
		// held is still the one this fetch started from.
		this.publish(snapshot, previous)
		return snapshot
	}

	private publish(snapshot: ServerWorkspaceSnapshot, previous: ServerWorkspaceSnapshot | null): void {
		recordBootstrapDiagnostic('workspace.snapshot.normalized')
		this.known = snapshot
		this.markStatus({ state: 'current' })
		if (this.listeners.size > 256) throw new Error('workspace snapshot listener budget exceeded')
		if (this.publishing) throw new Error('workspace snapshot publish is reentrant')
		recordBootstrapDiagnostic('workspace.listeners.publish', this.listeners.size)
		this.publishing = true
		try {
			for (const listener of [...this.listeners]) listener(snapshot, { previous })
			recordBootstrapDiagnostic('workspace.listeners.complete', this.listeners.size)
		} finally {
			this.publishing = false
		}
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

	/** Named workspace command for callers that still persist a default
	 * identity. Live tab and terminal selection is client-local. */
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

	/** Move a panel to another project. A terminal panel's live session moves with it. */
	async movePanel(request: PanelMoveRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.movePanel(request, options)
	}

	/** Move a panel to another folder of its own project. Nothing about a terminal's identity changes. */
	async movePanelToFolder(request: PanelFolderMoveRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.movePanelToFolder(request, options)
	}

	async createFolder(request: FolderCreateRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.createFolder(request, options)
	}

	async renameFolder(request: FolderRenameRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.renameFolder(request, options)
	}

	async reorderFolders(request: FolderReorderRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.reorderFolders(request, options)
	}

	async deleteFolder(folderId: string, options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.deleteFolder(folderId, options)
	}

	async answerFolderOffer(folderId: string, answer: 'accept' | 'decline', options: WorkspaceCommandOptions = {}): Promise<void> {
		if (this.closed) throw new Error('workspace snapshot store is closed')
		await this.workspace.answerFolderOffer(folderId, answer, options)
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

function isWorkspaceChange(value: unknown, serverId: string): value is { readonly serverId: string; readonly revision: number; readonly cursor: string; readonly record?: unknown } {
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
