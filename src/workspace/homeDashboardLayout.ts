/**
 * The Home overview's layout: which widgets show, in what order, at what size.
 *
 * The stored value is a server setting (ADR-0100) holding only ids, sizes, and
 * visibility. This module turns that value into what the grid shows, and makes
 * every edit the overview offers. It is pure, so it is tested without React.
 *
 * Two rules keep devices from erasing each other's work: an entry naming a
 * widget this client does not know is kept (and not shown), and a widget the
 * stored value does not name is appended at its defaults.
 */

import type {
	HomeDashboardSettings,
	HomeDashboardWidgetEntry,
	HomeDashboardWidgetSize,
} from '../types/settings.ts';

export type HomeWidgetId =
	| 'quick-actions'
	| 'needs-you'
	| 'agents'
	| 'workflows'
	| 'bots'
	| 'run-history'
	| 'pull-requests'
	| 'notifications'
	| 'projects'
	| 'bot-sessions'
	| 'automations'
	| 'recordings'
	| 'tabs'
	| 'connections';

export type HomeWidgetDefinition = Readonly<{
	id: HomeWidgetId;
	title: string;
	defaultSize: HomeDashboardWidgetSize;
	defaultHidden: boolean;
	sizes: readonly HomeDashboardWidgetSize[];
}>;

const ALL_SIZES: readonly HomeDashboardWidgetSize[] = ['small', 'wide', 'tall'];

function widget(
	id: HomeWidgetId,
	title: string,
	defaultSize: HomeDashboardWidgetSize,
	options: {
		hidden?: boolean;
		sizes?: readonly HomeDashboardWidgetSize[];
	} = {},
): HomeWidgetDefinition {
	return Object.freeze({
		id,
		title,
		defaultSize,
		defaultHidden: options.hidden === true,
		sizes: options.sizes ?? ALL_SIZES,
	});
}

/** The catalogue, in default order. */
export const HOME_WIDGETS: readonly HomeWidgetDefinition[] = Object.freeze([
	widget('quick-actions', 'Quick actions', 'wide', {
		sizes: ['small', 'wide'],
	}),
	widget('needs-you', 'Needs you', 'wide'),
	widget('agents', 'Agents', 'small'),
	widget('workflows', 'Workflows', 'wide'),
	widget('bots', 'Bots', 'small'),
	widget('run-history', 'Run history', 'wide'),
	widget('pull-requests', 'Pull requests', 'wide'),
	widget('notifications', 'Notifications', 'small'),
	widget('projects', 'Projects', 'small'),
	widget('bot-sessions', 'Bot sessions', 'small'),
	widget('automations', 'Automations', 'small'),
	widget('recordings', 'Recordings', 'small'),
	widget('tabs', 'Tabs', 'small', { hidden: true }),
	widget('connections', 'Connections', 'small', { hidden: true }),
]);

const BY_ID = new Map<string, HomeWidgetDefinition>(
	HOME_WIDGETS.map((definition) => [definition.id, definition]),
);

export function homeWidgetDefinition(
	id: string,
): HomeWidgetDefinition | undefined {
	return BY_ID.get(id);
}

/** One widget as the grid shows it. */
export type ResolvedHomeWidget = Readonly<{
	id: HomeWidgetId;
	definition: HomeWidgetDefinition;
	size: HomeDashboardWidgetSize;
	hidden: boolean;
}>;

/**
 * The full layout to edit: every stored entry (known or not) in stored order,
 * then every catalogue widget the stored value does not name, at its defaults.
 */
function completeEntries(
	settings: HomeDashboardSettings,
): HomeDashboardWidgetEntry[] {
	const entries = settings.widgets.map((entry) => ({ ...entry }));
	const named = new Set(entries.map((entry) => entry.id));
	for (const definition of HOME_WIDGETS) {
		if (named.has(definition.id)) continue;
		entries.push({
			id: definition.id,
			size: definition.defaultSize,
			hidden: definition.defaultHidden,
		});
	}
	return entries;
}

/** What the grid shows, and what the hidden tray lists, in order. */
export function resolveLayout(
	settings: HomeDashboardSettings,
): readonly ResolvedHomeWidget[] {
	const resolved: ResolvedHomeWidget[] = [];
	for (const entry of completeEntries(settings)) {
		const definition = BY_ID.get(entry.id);
		if (definition === undefined) continue;
		resolved.push(
			Object.freeze({
				id: definition.id,
				definition,
				size: definition.sizes.includes(entry.size)
					? entry.size
					: definition.defaultSize,
				hidden: entry.hidden,
			}),
		);
	}
	return Object.freeze(resolved);
}

export function visibleWidgets(
	settings: HomeDashboardSettings,
): readonly ResolvedHomeWidget[] {
	return resolveLayout(settings).filter((item) => !item.hidden);
}

export function hiddenWidgets(
	settings: HomeDashboardSettings,
): readonly ResolvedHomeWidget[] {
	return resolveLayout(settings).filter((item) => item.hidden);
}

function settingsOf(
	entries: HomeDashboardWidgetEntry[],
): HomeDashboardSettings {
	return { widgets: entries };
}

/**
 * Move a shown widget by `delta` places among the shown widgets. Hidden and
 * unknown entries keep their own places in the stored order.
 */
export function moveWidgetBy(
	settings: HomeDashboardSettings,
	id: string,
	delta: number,
): HomeDashboardSettings {
	const shown = visibleWidgets(settings).map((item) => item.id as string);
	const from = shown.indexOf(id);
	const to = from + delta;
	if (from < 0 || to < 0 || to >= shown.length || delta === 0) return settings;
	return moveWidgetBefore(
		settings,
		id,
		delta < 0 ? shown[to] : (shown[to + 1] ?? null),
	);
}

/**
 * Move a widget so it sits immediately before `beforeId`, or last when
 * `beforeId` is null. This is what a drop does.
 */
export function moveWidgetBefore(
	settings: HomeDashboardSettings,
	id: string,
	beforeId: string | null,
): HomeDashboardSettings {
	if (id === beforeId) return settings;
	const entries = completeEntries(settings);
	const from = entries.findIndex((entry) => entry.id === id);
	if (from < 0) return settings;
	const [moving] = entries.splice(from, 1);
	if (moving === undefined) return settings;
	const target =
		beforeId === null
			? entries.length
			: entries.findIndex((entry) => entry.id === beforeId);
	if (target < 0) return settings;
	entries.splice(target, 0, moving);
	return settingsOf(entries);
}

/** Move a widget to just after the last shown widget: where Add puts it. */
function moveAfterShown(
	entries: HomeDashboardWidgetEntry[],
	id: string,
): HomeDashboardWidgetEntry[] {
	const from = entries.findIndex((entry) => entry.id === id);
	if (from < 0) return entries;
	const [moving] = entries.splice(from, 1);
	if (moving === undefined) return entries;
	let last = -1;
	entries.forEach((entry, index) => {
		if (!entry.hidden && BY_ID.has(entry.id)) last = index;
	});
	entries.splice(last + 1, 0, moving);
	return entries;
}

export function setWidgetSize(
	settings: HomeDashboardSettings,
	id: string,
	size: HomeDashboardWidgetSize,
): HomeDashboardSettings {
	const definition = BY_ID.get(id);
	if (definition === undefined || !definition.sizes.includes(size))
		return settings;
	return settingsOf(
		completeEntries(settings).map((entry) =>
			entry.id === id ? { ...entry, size } : entry,
		),
	);
}

export function setWidgetHidden(
	settings: HomeDashboardSettings,
	id: string,
	hidden: boolean,
): HomeDashboardSettings {
	if (!BY_ID.has(id)) return settings;
	const entries = completeEntries(settings).map((entry) =>
		entry.id === id ? { ...entry, hidden } : entry,
	);
	// A widget added back goes to the end of what is shown.
	return settingsOf(hidden ? entries : moveAfterShown(entries, id));
}

/**
 * The default layout. Entries for widgets this client does not know are
 * kept, after the catalogue, so a newer client's choice for them survives.
 */
export function resetLayout(
	settings: HomeDashboardSettings,
): HomeDashboardSettings {
	return settingsOf([
		...HOME_WIDGETS.map((definition) => ({
			id: definition.id,
			size: definition.defaultSize,
			hidden: definition.defaultHidden,
		})),
		...settings.widgets.filter((entry) => !BY_ID.has(entry.id)),
	]);
}

export function sameLayout(
	left: HomeDashboardSettings,
	right: HomeDashboardSettings,
): boolean {
	return JSON.stringify(left.widgets) === JSON.stringify(right.widgets);
}

/**
 * Saves layout edits one at a time, in the order they were made.
 *
 * Each save carries the whole layout as it stood after its edit, so whichever
 * edit was made last is what the server holds. While saves are outstanding the
 * overview shows the newest edit. When a save fails, every edit not yet
 * confirmed is dropped and the overview shows what the server last confirmed.
 */
export type LayoutSaveState = Readonly<{
	/** The layout to show while edits are outstanding; undefined shows the
	 * server's. */
	pending?: HomeDashboardSettings;
	failed: boolean;
}>;

export class HomeLayoutSaveQueue {
	private queue: HomeDashboardSettings[] = [];
	private running = false;
	private state: LayoutSaveState = { failed: false };
	private readonly listeners = new Set<() => void>();

	/** Resolves with the layout the server then holds, when it says. */
	private readonly save: (
		layout: HomeDashboardSettings,
	) => Promise<HomeDashboardSettings | undefined>;

	constructor(
		save: (
			layout: HomeDashboardSettings,
		) => Promise<HomeDashboardSettings | undefined>,
	) {
		this.save = save;
	}

	snapshot(): LayoutSaveState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private publish(next: LayoutSaveState): void {
		this.state = next;
		for (const listener of this.listeners) listener();
	}

	enqueue(layout: HomeDashboardSettings): void {
		this.queue.push(layout);
		this.publish({ pending: layout, failed: false });
		void this.drain();
	}

	private async drain(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			while (this.queue.length > 0) {
				const next = this.queue.shift();
				if (next === undefined) break;
				try {
					const confirmed = await this.save(next);
					if (confirmed !== undefined) this.lastServer = confirmed;
				} catch {
					this.queue = [];
					this.publish({ failed: true });
					return;
				}
			}
		} finally {
			this.running = false;
		}
		// The server's update may have arrived before the save resolved.
		if (this.lastServer !== undefined) this.settle(this.lastServer);
	}

	private lastServer: HomeDashboardSettings | undefined;

	/**
	 * The server's layout changed. Once it holds the newest edit and nothing is
	 * left to save, the overview goes back to showing the server's value; a
	 * failure notice gives way to the server's next word.
	 */
	settle(server: HomeDashboardSettings): void {
		const previous = this.lastServer;
		this.lastServer = server;
		const { pending, failed } = this.state;
		if (failed) {
			if (previous !== undefined && sameLayout(previous, server)) return;
			this.publish({ failed: false });
			return;
		}
		if (
			pending !== undefined &&
			!this.running &&
			this.queue.length === 0 &&
			sameLayout(pending, server)
		)
			this.publish({ failed: false });
	}
}
