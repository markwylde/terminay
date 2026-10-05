/**
 * The tabs Home holds.
 *
 * A Home tab is this device's view of something — a section, an automation,
 * an editor, a run, an automation terminal. It is never a workspace panel: the
 * server does not know it exists, and closing one closes a view, not the thing
 * it shows (ADR-0040).
 *
 * A tab is named by a descriptor. The descriptor maps to one id, so opening
 * what is already open finds its tab instead of making a second; a new
 * automation is the exception, and takes a fresh id each time.
 */

import {
	DEFAULT_HOME_SECTION,
	HOME_SECTION_LABELS,
	type HomeSection,
	isHomeSection,
} from './homeSection.ts';

export type HomeTabDescriptor =
	| Readonly<{ kind: 'section'; section: HomeSection }>
	| Readonly<{ kind: 'automation'; serverId: string; automationId: string }>
	| Readonly<{
			kind: 'automation-edit';
			serverId: string;
			automationId: string;
	  }>
	| Readonly<{ kind: 'automation-new'; serverId: string; draftId: string }>
	| Readonly<{
			kind: 'run';
			serverId: string;
			automationId: string;
			runId: string;
	  }>
	| Readonly<{
			kind: 'automation-terminal';
			serverId: string;
			panelId: string;
	  }>;

export type HomeTabKind = HomeTabDescriptor['kind'];

/** The Dockview component and tab component every Home tab is drawn with. */
export const HOME_TAB_COMPONENT = 'home';
export const HOME_TAB_TAB_COMPONENT = 'homeTab';

const encode = (part: string) => encodeURIComponent(part);

/** The one id a descriptor maps to. Parts are escaped so ids split cleanly. */
export function homeTabId(descriptor: HomeTabDescriptor): string {
	switch (descriptor.kind) {
		case 'section':
			return `section:${descriptor.section}`;
		case 'automation':
			return `automation:${encode(descriptor.serverId)}:${encode(descriptor.automationId)}`;
		case 'automation-edit':
			return `automation-edit:${encode(descriptor.serverId)}:${encode(descriptor.automationId)}`;
		case 'automation-new':
			return `automation-new:${encode(descriptor.serverId)}:${encode(descriptor.draftId)}`;
		case 'run':
			return `run:${encode(descriptor.serverId)}:${encode(descriptor.automationId)}:${encode(descriptor.runId)}`;
		case 'automation-terminal':
			return `automation-terminal:${encode(descriptor.serverId)}:${encode(descriptor.panelId)}`;
	}
}

function decodeParts(parts: readonly string[]): string[] | undefined {
	const decoded: string[] = [];
	for (const part of parts) {
		if (part.length === 0) return undefined;
		try {
			decoded.push(decodeURIComponent(part));
		} catch {
			return undefined;
		}
	}
	return decoded;
}

/** The descriptor an id names, or undefined for anything else. */
export function parseHomeTabId(id: unknown): HomeTabDescriptor | undefined {
	if (typeof id !== 'string') return undefined;
	const [kind, ...rest] = id.split(':');
	const parts = decodeParts(rest);
	if (parts === undefined) return undefined;
	const [first, second, third] = parts;
	switch (kind) {
		case 'section':
			return parts.length === 1 && isHomeSection(first)
				? { kind: 'section', section: first }
				: undefined;
		case 'automation':
			return parts.length === 2 && first !== undefined && second !== undefined
				? { kind: 'automation', serverId: first, automationId: second }
				: undefined;
		case 'automation-edit':
			return parts.length === 2 && first !== undefined && second !== undefined
				? { kind: 'automation-edit', serverId: first, automationId: second }
				: undefined;
		case 'automation-new':
			return parts.length === 2 && first !== undefined && second !== undefined
				? { kind: 'automation-new', serverId: first, draftId: second }
				: undefined;
		case 'run':
			return parts.length === 3 &&
				first !== undefined &&
				second !== undefined &&
				third !== undefined
				? { kind: 'run', serverId: first, automationId: second, runId: third }
				: undefined;
		case 'automation-terminal':
			return parts.length === 2 && first !== undefined && second !== undefined
				? { kind: 'automation-terminal', serverId: first, panelId: second }
				: undefined;
		default:
			return undefined;
	}
}

/** The sidebar section a tab belongs to. */
export function homeTabSection(descriptor: HomeTabDescriptor): HomeSection {
	return descriptor.kind === 'section' ? descriptor.section : 'automations';
}

/** A tab's title before whatever it shows has loaded. */
export function defaultHomeTabTitle(descriptor: HomeTabDescriptor): string {
	switch (descriptor.kind) {
		case 'section':
			return HOME_SECTION_LABELS[descriptor.section];
		case 'automation':
			return 'Automation';
		case 'automation-edit':
			return 'Edit automation';
		case 'automation-new':
			return 'New automation';
		case 'run':
			return 'Run';
		case 'automation-terminal':
			return 'Automation terminal';
	}
}

/** The server a tab shows something of; a section belongs to none. */
export function homeTabServerId(
	descriptor: HomeTabDescriptor,
): string | undefined {
	return descriptor.kind === 'section' ? undefined : descriptor.serverId;
}

export const DEFAULT_HOME_TAB: HomeTabDescriptor = {
	kind: 'section',
	section: DEFAULT_HOME_SECTION,
};

// --- The remembered arrangement ---------------------------------------------

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether a remembered tab is restored. Unsaved edits are never remembered,
 * so a new automation — which is nothing but unsaved edits — is not.
 */
function isRestorable(id: unknown): id is string {
	const descriptor = parseHomeTabId(id);
	return descriptor !== undefined && descriptor.kind !== 'automation-new';
}

function sanitizeNode(node: unknown, kept: Set<string>): Json | undefined {
	if (!isObject(node)) return undefined;
	if (node.type === 'leaf') {
		const data = node.data;
		if (!isObject(data) || !Array.isArray(data.views)) return undefined;
		const views = data.views.filter(isRestorable);
		if (views.length === 0) return undefined;
		for (const view of views) kept.add(view);
		const activeView =
			typeof data.activeView === 'string' && views.includes(data.activeView)
				? data.activeView
				: views[0];
		return { ...node, data: { ...data, views, activeView } };
	}
	if (node.type === 'branch') {
		if (!Array.isArray(node.data)) return undefined;
		const children = node.data
			.map((child) => sanitizeNode(child, kept))
			.filter((child): child is Json => child !== undefined);
		if (children.length === 0) return undefined;
		return { ...node, data: children };
	}
	return undefined;
}

/**
 * A remembered Home arrangement, made safe to restore.
 *
 * What a device remembers is a hint and is never trusted: tabs whose ids name
 * nothing Home knows are dropped, new-automation drafts are dropped, every
 * surviving tab is rebuilt from its id rather than from what was stored beside
 * it, and floating or popped-out groups are discarded. Returns undefined when
 * nothing restorable is left, which means "open Home's default tab".
 */
export function sanitizeHomeLayout(stored: unknown): Json | undefined {
	if (!isObject(stored) || !isObject(stored.grid)) return undefined;
	const kept = new Set<string>();
	const root = sanitizeNode(stored.grid.root, kept);
	// Dockview's root is always a branch.
	if (root === undefined || root.type !== 'branch' || kept.size === 0)
		return undefined;
	const panels: Json = {};
	for (const id of kept) {
		const descriptor = parseHomeTabId(id);
		if (descriptor === undefined) continue;
		const remembered = isObject(stored.panels) ? stored.panels[id] : undefined;
		const title =
			isObject(remembered) &&
			typeof remembered.title === 'string' &&
			remembered.title.length > 0 &&
			remembered.title.length <= 200
				? remembered.title
				: defaultHomeTabTitle(descriptor);
		panels[id] = {
			id,
			contentComponent: HOME_TAB_COMPONENT,
			tabComponent: HOME_TAB_TAB_COMPONENT,
			renderer: 'always',
			title,
			params: { descriptor },
		};
	}
	const { height, orientation, width } = stored.grid;
	return {
		// Only the tree and its measurements: a group that was maximised to fit a
		// narrow window is not restored maximised into a wide one.
		grid: { root, height, width, orientation },
		panels,
		...(typeof stored.activeGroup === 'string'
			? { activeGroup: stored.activeGroup }
			: {}),
	};
}
