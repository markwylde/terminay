/**
 * How a device has chosen to show Home's Workflows section.
 *
 * Device presentation state, like Home's tab arrangement (ADR-0040): kept in
 * this device's storage and never written to the server. Every read is
 * validated field by field, and anything storage cannot give back becomes
 * the default, so a broken or missing record never breaks the section.
 */

export type WorkflowsHomeStatus = 'alert' | 'running' | 'done';
export type WorkflowsHomeGroup = 'none' | 'project' | 'workflow';
export type WorkflowsHomeLayout = 'side' | 'rows';
export type WorkflowsHomeSort = 'attention' | 'recent' | 'progress' | 'name';
export type WorkflowsHomeNotes = 'full' | 'short' | 'current';

export type WorkflowsHomeView = Readonly<{
	text: string;
	/** None selected means every status. */
	statuses: readonly WorkflowsHomeStatus[];
	/**
	 * Projects left out, as `serverId:projectId`. Stored this way round so a
	 * project the device has not seen is included.
	 */
	excludedProjects: readonly string[];
	group: WorkflowsHomeGroup;
	layout: WorkflowsHomeLayout;
	sort: WorkflowsHomeSort;
	notes: WorkflowsHomeNotes;
	showFinished: boolean;
	narrow: boolean;
	/** Folded group keys. */
	folded: readonly string[];
}>;

export const WORKFLOWS_HOME_VIEW_KEY = 'terminay.workflowsHome.view.v1';

export const DEFAULT_WORKFLOWS_HOME_VIEW: WorkflowsHomeView = Object.freeze({
	text: '',
	statuses: Object.freeze([]),
	excludedProjects: Object.freeze([]),
	group: 'none',
	layout: 'side',
	sort: 'attention',
	notes: 'full',
	showFinished: true,
	narrow: false,
	folded: Object.freeze([]),
});

const STATUSES: readonly WorkflowsHomeStatus[] = ['alert', 'running', 'done'];
const GROUPS: readonly WorkflowsHomeGroup[] = ['none', 'project', 'workflow'];
const LAYOUTS: readonly WorkflowsHomeLayout[] = ['side', 'rows'];
const SORTS: readonly WorkflowsHomeSort[] = ['attention', 'recent', 'progress', 'name'];
const NOTES: readonly WorkflowsHomeNotes[] = ['full', 'short', 'current'];
/** Bounds on what a record may hold, so a damaged one cannot grow unbounded. */
const MAX_TEXT = 200;
const MAX_KEYS = 500;
const MAX_KEY_LENGTH = 1024;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

function keys(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	const out = new Set<string>();
	for (const item of value) {
		if (typeof item === 'string' && item.length > 0 && item.length <= MAX_KEY_LENGTH)
			out.add(item);
		if (out.size >= MAX_KEYS) break;
	}
	return Object.freeze([...out]);
}

/** A stored value as a view; whatever is missing or wrong is the default. */
export function parseWorkflowsHomeView(value: unknown): WorkflowsHomeView {
	const d = DEFAULT_WORKFLOWS_HOME_VIEW;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return d;
	const record = value as Record<string, unknown>;
	const statuses = Array.isArray(record.statuses)
		? STATUSES.filter((status) => (record.statuses as unknown[]).includes(status))
		: [];
	return Object.freeze({
		text: typeof record.text === 'string' ? record.text.slice(0, MAX_TEXT) : d.text,
		statuses: Object.freeze(statuses),
		excludedProjects: keys(record.excludedProjects),
		group: oneOf(record.group, GROUPS, d.group),
		layout: oneOf(record.layout, LAYOUTS, d.layout),
		sort: oneOf(record.sort, SORTS, d.sort),
		notes: oneOf(record.notes, NOTES, d.notes),
		showFinished:
			typeof record.showFinished === 'boolean' ? record.showFinished : d.showFinished,
		narrow: typeof record.narrow === 'boolean' ? record.narrow : d.narrow,
		folded: keys(record.folded),
	});
}

type ViewStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): ViewStorage | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		return undefined;
	}
}

/** The view this device remembers, or the default. Never throws. */
export function readWorkflowsHomeView(
	storage: ViewStorage | undefined = defaultStorage(),
): WorkflowsHomeView {
	try {
		const raw = storage?.getItem(WORKFLOWS_HOME_VIEW_KEY);
		if (raw === null || raw === undefined) return DEFAULT_WORKFLOWS_HOME_VIEW;
		return parseWorkflowsHomeView(JSON.parse(raw));
	} catch {
		return DEFAULT_WORKFLOWS_HOME_VIEW;
	}
}

/** Remember a view. A full or disabled storage is not an error. */
export function writeWorkflowsHomeView(
	view: WorkflowsHomeView,
	storage: ViewStorage | undefined = defaultStorage(),
): void {
	try {
		storage?.setItem(WORKFLOWS_HOME_VIEW_KEY, JSON.stringify(view));
	} catch {
		// Remembering is a convenience; the section works without it.
	}
}

/** Whether any option differs from its default. */
export function isDefaultWorkflowsHomeView(view: WorkflowsHomeView): boolean {
	return JSON.stringify(view) === JSON.stringify(DEFAULT_WORKFLOWS_HOME_VIEW);
}
