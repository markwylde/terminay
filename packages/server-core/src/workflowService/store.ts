import fs from 'node:fs';
import { join } from 'node:path';
import {
	type DurableFileOps,
	PREVIOUS_SUFFIX,
	preserveCorruptFile,
	readStateFileSync,
	writeFileDurablySync,
} from '../durableFile.js';
import { WorkflowServiceError } from './errors.js';
import { validateSessionRecord } from './normalize.js';
import { applyStepUpdate, isUnfinished, resumeStepId } from './steps.js';
import {
	type SessionWorkflowRecord,
	type SessionWorkflowView,
	WORKFLOW_RECORD_SCHEMA_VERSION,
	type Workflow,
	type WorkflowStepStatus,
} from './types.js';

/** Directory under the data root holding one file per terminal session. */
export const WORKFLOW_RECORDS_DIRECTORY = 'workflows';

export type WorkflowChange =
	| SessionWorkflowView
	| { readonly sessionId: string; readonly state: 'none' };

export interface WorkflowStoreOptions {
	/** Directory for the session files; omitted keeps workflows in memory. */
	readonly directory?: string;
	readonly now?: () => number;
	/** File operations for durable writes; tests inject failures here. */
	readonly fileOps?: DurableFileOps;
}

type Entry =
	| { readonly state: 'attached'; readonly workflow: Workflow }
	| { readonly state: 'unrestorable' };

/** Session ids are opaque; a file name must be safe on every platform. */
export function workflowFileName(sessionId: string): string {
	return `${Buffer.from(sessionId, 'utf8').toString('base64url')}.json`;
}

function sessionIdOfFile(name: string): string | undefined {
	if (!name.endsWith('.json')) return undefined;
	try {
		const id = Buffer.from(name.slice(0, -5), 'base64url').toString('utf8');
		return workflowFileName(id) === name ? id : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Workflows of terminal sessions (ADR-0097). Each session's file is canonical
 * state (ADR-0088): a change is written durably before it is acknowledged, a
 * failed write leaves the workflow as it was, and replacing or removing a
 * workflow is one replace of that one file. A workflow lasts as long as its
 * session (ADR-0076).
 */
export class WorkflowStore {
	private readonly entries = new Map<string, Entry>();
	private readonly listeners = new Set<(change: WorkflowChange) => void>();
	private readonly now: () => number;

	constructor(private readonly options: WorkflowStoreOptions = {}) {
		this.now = options.now ?? Date.now;
	}

	onChange(listener: (change: WorkflowChange) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Load the workflows of sessions that are running, after held sessions are
	 * reattached, and delete the files of every other session.
	 */
	restore(runningSessionIds: Iterable<string>): void {
		this.entries.clear();
		const directory = this.options.directory;
		if (directory === undefined) return;
		const running = new Set(runningSessionIds);
		let names: string[];
		try {
			names = fs.readdirSync(directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
			throw error;
		}
		const sessions = new Set<string>();
		for (const name of names) {
			const base = name.endsWith(PREVIOUS_SUFFIX)
				? name.slice(0, -PREVIOUS_SUFFIX.length)
				: name;
			const sessionId = sessionIdOfFile(base);
			if (sessionId !== undefined) sessions.add(sessionId);
		}
		for (const sessionId of sessions) {
			if (!running.has(sessionId)) {
				this.deleteFiles(sessionId);
				continue;
			}
			const read = readStateFileSync<SessionWorkflowRecord>(
				this.pathOf(sessionId),
				{
					kind: 'canonical',
					mode: 0o600,
					validate: (raw) => {
						const record = validateSessionRecord(raw);
						return record?.sessionId === sessionId ? record : undefined;
					},
				},
			);
			if (read.status === 'missing') continue;
			if (read.status === 'corrupt') {
				// The file name says whose it was. Both copies stay where they
				// are until the user removes the workflow.
				this.entries.set(sessionId, { state: 'unrestorable' });
				continue;
			}
			if (read.value.workflow !== null)
				this.entries.set(sessionId, {
					state: 'attached',
					workflow: read.value.workflow,
				});
		}
	}

	get(sessionId: string): SessionWorkflowView | undefined {
		const entry = this.entries.get(sessionId);
		return entry === undefined ? undefined : viewOf(sessionId, entry);
	}

	list(): SessionWorkflowView[] {
		return [...this.entries].map(([sessionId, entry]) =>
			viewOf(sessionId, entry),
		);
	}

	/**
	 * Attach a workflow. An unfinished (or unrestorable) workflow already on
	 * the session is replaced only when `replaceWorkflowId` names it.
	 */
	attach(
		sessionId: string,
		workflow: Workflow,
		replaceWorkflowId?: string,
	): SessionWorkflowView {
		this.assertReplaceable(sessionId, replaceWorkflowId);
		return this.commit(sessionId, { state: 'attached', workflow });
	}

	/** Refuse unless the session's unfinished workflow is `replaceWorkflowId`. */
	assertReplaceable(sessionId: string, replaceWorkflowId?: string): void {
		const current = this.entries.get(sessionId);
		if (current === undefined) return;
		if (current.state === 'unrestorable')
			throw new WorkflowServiceError(
				'workflow_exists',
				'this terminal has a workflow that could not be restored; remove it first',
				{ workflowId: null },
			);
		if (!isUnfinished(current.workflow)) return;
		if (replaceWorkflowId === current.workflow.id) return;
		throw new WorkflowServiceError(
			'workflow_exists',
			`this terminal already has the unfinished workflow "${current.workflow.name}"`,
			{ workflowId: current.workflow.id },
		);
	}

	updateStep(
		sessionId: string,
		stepId: string,
		status: WorkflowStepStatus,
		note: unknown,
	): SessionWorkflowView {
		const workflow = this.workflowOf(sessionId);
		const next = applyStepUpdate(workflow, stepId, status, note, this.now());
		return this.commit(sessionId, { state: 'attached', workflow: next });
	}

	workflowOf(sessionId: string): Workflow {
		const entry = this.entries.get(sessionId);
		if (entry === undefined || entry.state !== 'attached')
			throw new WorkflowServiceError(
				'no_workflow',
				entry === undefined
					? 'this terminal has no workflow'
					: 'this terminal has a workflow that could not be restored',
			);
		return entry.workflow;
	}

	/** The user removes the workflow; the terminal is untouched. */
	remove(sessionId: string): void {
		const entry = this.entries.get(sessionId);
		if (entry === undefined) return;
		if (entry.state === 'unrestorable' && this.options.directory !== undefined) {
			// Keep the unreadable copies for diagnosis, out of the way.
			for (const path of [
				this.pathOf(sessionId),
				`${this.pathOf(sessionId)}${PREVIOUS_SUFFIX}`,
			])
				if (fs.existsSync(path)) preserveCorruptFile(path);
		}
		this.write(sessionId, {
			schemaVersion: WORKFLOW_RECORD_SCHEMA_VERSION,
			sessionId,
			workflow: null,
		});
		this.entries.delete(sessionId);
		this.emit({ sessionId, state: 'none' });
	}

	/** The terminal closed or its session ended. */
	endSession(sessionId: string): void {
		const had = this.entries.delete(sessionId);
		this.deleteFiles(sessionId);
		if (had) this.emit({ sessionId, state: 'none' });
	}

	private commit(sessionId: string, entry: Entry & { state: 'attached' }) {
		this.write(sessionId, {
			schemaVersion: WORKFLOW_RECORD_SCHEMA_VERSION,
			sessionId,
			workflow: entry.workflow,
		});
		// Only a durable write changes what the server holds.
		this.entries.set(sessionId, entry);
		const view = viewOf(sessionId, entry);
		this.emit(view);
		return view;
	}

	private write(sessionId: string, record: SessionWorkflowRecord): void {
		const directory = this.options.directory;
		if (directory === undefined) return;
		try {
			fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
			writeFileDurablySync(
				this.pathOf(sessionId),
				JSON.stringify(record),
				{ mode: 0o600, keepPrevious: true },
				...(this.options.fileOps === undefined ? [] : [this.options.fileOps]),
			);
		} catch (error) {
			throw new WorkflowServiceError(
				'write_failed',
				'the workflow could not be saved',
				{ cause: error instanceof Error ? error.message : String(error) },
			);
		}
	}

	private deleteFiles(sessionId: string): void {
		if (this.options.directory === undefined) return;
		const path = this.pathOf(sessionId);
		fs.rmSync(path, { force: true });
		fs.rmSync(`${path}${PREVIOUS_SUFFIX}`, { force: true });
	}

	private pathOf(sessionId: string): string {
		return join(
			this.options.directory as string,
			workflowFileName(sessionId),
		);
	}

	private emit(change: WorkflowChange): void {
		for (const listener of this.listeners) {
			try {
				listener(change);
			} catch {}
		}
	}
}

function viewOf(sessionId: string, entry: Entry): SessionWorkflowView {
	if (entry.state === 'unrestorable')
		return { sessionId, state: 'unrestorable' };
	return {
		sessionId,
		state: 'attached',
		workflow: structuredClone(entry.workflow),
		resumeStepId: resumeStepId(entry.workflow),
		unfinished: isUnfinished(entry.workflow),
	};
}
