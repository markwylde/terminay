import { type JsonValue, protocolError } from '@terminay/protocol';
import {
	ProgramTitleCoalescer,
	type ProgramTitleCoalescerOptions,
	sanitiseProgramTitle,
} from './activity/programTitle.js';
import type { TerminalActivityService } from './activity/service.js';
import type {
	AuthenticatedClient,
	OperationRegistries,
	OrderedEvent,
	OrderedEventJournalLike,
	QueryRequest,
} from './types.js';
import type {
	WorkspaceChangeRecord,
	WorkspacePanel,
	WorkspaceStore,
} from './workspace.js';

/** Stable protocol names for the terminal title projection. */
export const TERMINAL_TITLE_OPERATIONS = Object.freeze({
	snapshot: 'terminal-titles.snapshot',
	event: 'terminal-titles',
} as const);

/** What a terminal's tab displays, as the server resolved it. */
export interface TerminalTitleEntry {
	readonly panelId: string;
	readonly projectId: string;
	readonly sessionId: string;
	readonly title: string;
}

export interface TerminalTitleSnapshot {
	readonly titles: Readonly<Record<string, TerminalTitleEntry>>;
}

export type TerminalTitleEvent =
	| (TerminalTitleEntry & { readonly removed?: undefined })
	| {
			readonly panelId: string;
			readonly projectId: string;
			readonly sessionId: string;
			readonly removed: true;
	  };

export interface TerminalTitleServiceOptions {
	readonly workspace: WorkspaceStore;
	/** The `programSetTabTitles` server setting, read when it is needed. */
	readonly enabled: () => boolean;
	readonly windowMs?: ProgramTitleCoalescerOptions['windowMs'];
	readonly setTimeout?: ProgramTitleCoalescerOptions['setTimeout'];
	readonly clearTimeout?: ProgramTitleCoalescerOptions['clearTimeout'];
}

/**
 * The titles programs write to their terminals, and the title each terminal
 * displays because of them (ADR-0058).
 *
 * A program title is live state: it is held here, in memory, and never reaches
 * the workspace model, its revision, or disk. The server is still its only
 * reader and its only resolver: the displayed title is the name a person gave
 * the terminal, else the program's title, else the terminal's default name.
 * What is published is that resolved title, per terminal, and only when it
 * changes.
 */
export class TerminalTitleService {
	private readonly workspace: WorkspaceStore;
	private readonly enabled: () => boolean;
	private readonly programTitles = new Map<string, string>();
	private readonly panelBySession = new Map<string, string>();
	private readonly published = new Map<string, TerminalTitleEntry>();
	private readonly listeners = new Set<(event: TerminalTitleEvent) => void>();
	private readonly coalescer: ProgramTitleCoalescer;
	private readonly unsubscribeWorkspace: () => void;

	constructor(options: TerminalTitleServiceOptions) {
		this.workspace = options.workspace;
		this.enabled = options.enabled;
		this.coalescer = new ProgramTitleCoalescer({
			commit: (sessionId, title) => this.setProgramTitle(sessionId, title),
			...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
			...(options.setTimeout === undefined
				? {}
				: { setTimeout: options.setTimeout }),
			...(options.clearTimeout === undefined
				? {}
				: { clearTimeout: options.clearTimeout }),
		});
		for (const panel of Object.values(this.workspace.state.panels))
			this.refresh(panel.id, false);
		this.unsubscribeWorkspace = this.workspace.subscribe((_event, record) =>
			this.workspaceChanged(record),
		);
	}

	/**
	 * A title sequence a session's program wrote. Per-event work is a map
	 * write (ADR-0044); the timer that bounds publication is armed here and
	 * nowhere else (ADR-0028).
	 */
	observe(sessionId: string, raw: string): void {
		if (!this.enabled()) return;
		this.coalescer.push(sessionId, sanitiseProgramTitle(raw));
	}

	/** The title a terminal panel displays, or `undefined` for anything else. */
	displayedTitle(panelId: string): string | undefined {
		return this.published.get(panelId)?.title;
	}

	/** The title the terminal presenting a session displays. */
	displayedTitleForSession(sessionId: string): string | undefined {
		const panelId = this.panelFor(sessionId);
		return panelId === undefined ? undefined : this.displayedTitle(panelId);
	}

	/** The program's own title for a panel, whether or not it is displayed. */
	programTitle(panelId: string): string | undefined {
		return this.enabled() ? this.programTitles.get(panelId) : undefined;
	}

	/** Every displayed title, or those of one project. */
	snapshot(projectId?: string): TerminalTitleSnapshot {
		const titles: Record<string, TerminalTitleEntry> = {};
		for (const entry of this.published.values())
			if (projectId === undefined || entry.projectId === projectId)
				titles[entry.panelId] = entry;
		return Object.freeze({ titles: Object.freeze(titles) });
	}

	subscribe(listener: (event: TerminalTitleEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Bring displayed titles in line with the setting. Call when it may have
	 * changed: while it is off no terminal displays a program title, and none
	 * is kept to be shown when it is turned on again. */
	reconcile(): void {
		if (!this.enabled()) {
			this.coalescer.dispose();
			this.programTitles.clear();
		}
		for (const panelId of [...this.published.keys()]) this.refresh(panelId);
	}

	dispose(): void {
		this.unsubscribeWorkspace();
		this.coalescer.dispose();
		this.listeners.clear();
	}

	private setProgramTitle(sessionId: string, title: string | undefined): void {
		if (!this.enabled()) return;
		const panelId = this.panelFor(sessionId);
		// A title for a terminal with no panel is dropped.
		if (panelId === undefined) return;
		if (title === undefined) this.programTitles.delete(panelId);
		else this.programTitles.set(panelId, title);
		this.refresh(panelId);
	}

	private panelFor(sessionId: string): string | undefined {
		const indexed = this.panelBySession.get(sessionId);
		if (indexed !== undefined) return indexed;
		// The index follows committed commands. A terminal put in place another
		// way (restart recovery) is found once here and indexed.
		for (const panel of Object.values(this.workspace.state.panels))
			if (panel.type === 'terminal' && panel.sessionId === sessionId) {
				this.refresh(panel.id, false);
				return panel.id;
			}
		return undefined;
	}

	private workspaceChanged(record: WorkspaceChangeRecord): void {
		for (const panelId of record.removed.panels ?? []) this.refresh(panelId);
		for (const panelId of Object.keys(record.changed.panels ?? {}))
			this.refresh(panelId);
	}

	/** Resolve a panel's displayed title again and publish it if it differs. */
	private refresh(panelId: string, publish = true): void {
		const panel = this.workspace.state.panels[panelId];
		const previous = this.published.get(panelId);
		if (panel === undefined || panel.type !== 'terminal') {
			this.programTitles.delete(panelId);
			if (previous === undefined) return;
			this.published.delete(panelId);
			if (this.panelBySession.get(previous.sessionId) === panelId)
				this.panelBySession.delete(previous.sessionId);
			this.coalescer.forget(previous.sessionId);
			if (publish)
				this.emit({
					panelId,
					projectId: previous.projectId,
					sessionId: previous.sessionId,
					removed: true,
				});
			return;
		}
		if (previous !== undefined && previous.sessionId !== panel.sessionId) {
			if (this.panelBySession.get(previous.sessionId) === panelId)
				this.panelBySession.delete(previous.sessionId);
		}
		this.panelBySession.set(panel.sessionId, panelId);
		const title = this.resolve(panel);
		if (
			previous !== undefined &&
			previous.title === title &&
			previous.projectId === panel.projectId &&
			previous.sessionId === panel.sessionId
		)
			return;
		const entry: TerminalTitleEntry = Object.freeze({
			panelId,
			projectId: panel.projectId,
			sessionId: panel.sessionId,
			title,
		});
		this.published.set(panelId, entry);
		if (!publish) return;
		// A connection scoped to the project the terminal left hears no more of
		// it, so it is told the terminal is gone from there.
		if (previous !== undefined && previous.projectId !== panel.projectId)
			this.emit({
				panelId,
				projectId: previous.projectId,
				sessionId: previous.sessionId,
				removed: true,
			});
		this.emit(entry);
	}

	/** A person's name for the terminal, else the program's, else its default
	 * name. `panel.title` is what a panel stored before title sources holds. */
	private resolve(panel: Extract<WorkspacePanel, { type: 'terminal' }>): string {
		return (
			panel.namedTitle ??
			(this.enabled() ? this.programTitles.get(panel.id) : undefined) ??
			panel.defaultTitle ??
			panel.title ??
			'Terminal'
		);
	}

	private emit(event: TerminalTitleEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				/* a title is presentation; a failing observer changes nothing */
			}
		}
	}
}

/** Feed a terminal activity service's title sequences to a title service. */
export function bindTerminalTitles(
	activity: Pick<TerminalActivityService, 'setProgramTitleListener'>,
	titles: TerminalTitleService,
): () => void {
	activity.setProgramTitleListener((identity, raw) =>
		titles.observe(identity.sessionId, raw),
	);
	return () => activity.setProgramTitleListener(undefined);
}

export interface TerminalTitleOperationRegistry {
	readonly operations: OperationRegistries;
	readonly close: () => void;
}

/**
 * Expose displayed titles through the authenticated application protocol: a
 * snapshot query, and one keyed event per change on the shared journal so
 * title subscriptions order and replay like every other server event.
 */
export function createTerminalTitleOperationRegistry(options: {
	readonly service: TerminalTitleService;
	readonly eventJournal: OrderedEventJournalLike;
}): TerminalTitleOperationRegistry {
	const unsubscribe = options.service.subscribe((event) => {
		options.eventJournal.append(
			TERMINAL_TITLE_OPERATIONS.event,
			event as unknown as JsonValue,
		);
	});
	return {
		operations: {
			queries: {
				[TERMINAL_TITLE_OPERATIONS.snapshot]: (request: QueryRequest) => {
					if (request.context.authScope === 'none')
						throw protocolError(
							'forbidden',
							'terminal titles require read access',
						);
					return options.service.snapshot(
						projectClaim(request.context.claims),
					) as unknown as JsonValue;
				},
			},
			commands: {},
			policies: {
				[TERMINAL_TITLE_OPERATIONS.snapshot]: { scope: 'read' },
			},
		},
		close: unsubscribe,
	};
}

/** A project-claimed client learns only its own project's titles. */
export function terminalTitleEventProjector(
	event: OrderedEvent,
	client: AuthenticatedClient | undefined,
): OrderedEvent | undefined {
	if (event.event !== TERMINAL_TITLE_OPERATIONS.event) return event;
	const claimed = projectClaim(client?.claims);
	if (claimed === undefined) return event;
	const payload = event.payload;
	return typeof payload === 'object' &&
		payload !== null &&
		!Array.isArray(payload) &&
		payload.projectId === claimed
		? event
		: undefined;
}

function projectClaim(claims: unknown): string | undefined {
	return typeof claims === 'object' &&
		claims !== null &&
		!Array.isArray(claims) &&
		typeof (claims as Record<string, unknown>).projectId === 'string'
		? ((claims as Record<string, unknown>).projectId as string)
		: undefined;
}
