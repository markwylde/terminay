/**
 * This device's view, as an MCP agent reads and changes it (ADR-0070).
 *
 * The panes a project folder shows are this device's own Dockview. An agent
 * the user is talking to here asks, through the server, to read them or to
 * move, resize, and arrange tabs. Everything here works on the Dockview the
 * user sees, with the moves the user's own drag and drop make, so a terminal
 * keeps its emulator and its place in the stream while it moves.
 */

import type {
	DockviewApi,
	DockviewGroupPanel,
	IDockviewPanel,
	SerializedDockview,
} from 'dockview-react';

export type ViewPosition = 'right' | 'left' | 'above' | 'below' | 'center';
export type TabArrangement = 'grid' | 'columns' | 'rows' | 'tabs';

/** A tab as a request names it: the device's tab id, or a terminal session. */
export type ViewTabTarget = { readonly tab?: string; readonly sessionId?: string };

export type ViewTab = {
	readonly tab: string;
	readonly sessionId?: string;
	readonly kind: 'terminal' | 'file' | 'folder' | 'other';
	readonly title: string;
	readonly active: boolean;
};

export type ViewNode =
	| {
			readonly split: 'row' | 'column';
			readonly children: readonly (ViewNode & { readonly size: number })[];
	  }
	| { readonly pane: string; readonly tabs: readonly ViewTab[] };

/** What an agent may ask the device to do, with a short reason code. */
export class ViewRefusal extends Error {
	readonly code: 'not_found' | 'bad_request' | 'unavailable';

	constructor(code: ViewRefusal['code'], message: string) {
		super(message);
		this.code = code;
		this.name = 'ViewRefusal';
	}
}

type PanelFacts = (panelId: string) => Omit<ViewTab, 'active'> | undefined;

type GridObject = {
	readonly type: 'leaf' | 'branch';
	readonly data: unknown;
	readonly size?: number;
};

/**
 * The pane tree of a serialised Dockview. Its root lays children out along
 * the grid's orientation, and each level below turns the other way. Sizes are
 * each child's share of its split.
 */
export function viewTreeFromSerialized(
	serialized: Pick<SerializedDockview, 'grid'>,
	facts: PanelFacts,
): ViewNode | undefined {
	const visit = (node: GridObject, horizontal: boolean): ViewNode | undefined => {
		if (node.type === 'leaf') {
			const data = node.data as { id?: unknown; views?: unknown; activeView?: unknown };
			const views = Array.isArray(data.views) ? (data.views as unknown[]) : [];
			return {
				pane: String(data.id ?? ''),
				tabs: views.flatMap((id) => {
					if (typeof id !== 'string') return [];
					const fact = facts(id);
					return fact === undefined ? [] : [{ ...fact, active: id === data.activeView }];
				}),
			};
		}
		const children = (Array.isArray(node.data) ? (node.data as GridObject[]) : []).flatMap(
			(child) => {
				const visited = visit(child, !horizontal);
				return visited === undefined ? [] : [{ node: visited, size: child.size ?? 0 }];
			},
		);
		if (children.length === 0) return undefined;
		if (children.length === 1) return children[0]!.node;
		const total = children.reduce((sum, child) => sum + child.size, 0);
		return {
			split: horizontal ? 'row' : 'column',
			children: children.map(({ node: child, size }) => ({
				...child,
				size: total > 0 ? Math.round((size / total) * 1000) / 1000 : 1 / children.length,
			})),
		};
	};
	return visit(
		serialized.grid.root as GridObject,
		String(serialized.grid.orientation) === 'HORIZONTAL',
	);
}

/** What one Dockview panel is, for a layout. */
export function panelFacts(panel: IDockviewPanel): Omit<ViewTab, 'active'> {
	const params = (panel.params ?? {}) as Record<string, unknown>;
	const sessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined;
	const component = (panel.view as { contentComponent?: unknown } | undefined)?.contentComponent;
	const kind: ViewTab['kind'] =
		sessionId !== undefined
			? 'terminal'
			: component === 'file' || typeof params.filePath === 'string'
				? 'file'
				: component === 'folder' || typeof params.folderPath === 'string'
					? 'folder'
					: 'other';
	return {
		tab: panel.id,
		...(sessionId === undefined ? {} : { sessionId }),
		kind,
		title: typeof panel.title === 'string' ? panel.title : '',
	};
}

/** This Dockview's pane tree and the tab with focus. */
export function describeDockview(api: DockviewApi): {
	readonly root?: ViewNode;
	readonly focusedTab?: string;
} {
	const root = viewTreeFromSerialized(api.toJSON(), (id) => {
		const panel = api.getPanel(id);
		return panel === undefined ? undefined : panelFacts(panel);
	});
	return {
		...(root === undefined ? {} : { root }),
		...(api.activePanel === undefined ? {} : { focusedTab: api.activePanel.id }),
	};
}

/** A tab of this Dockview, or undefined. */
export function findViewPanel(
	api: DockviewApi,
	target: ViewTabTarget,
): IDockviewPanel | undefined {
	if (target.tab !== undefined) {
		const panel = api.getPanel(target.tab);
		if (panel !== undefined) return panel;
	}
	if (target.sessionId === undefined) return undefined;
	return api.panels.find(
		(panel) => (panel.params as { sessionId?: unknown } | undefined)?.sessionId === target.sessionId,
	);
}

const DOCKVIEW_POSITION = {
	right: 'right',
	left: 'left',
	above: 'top',
	below: 'bottom',
	center: 'center',
} as const;

/** Put a tab beside another tab's pane, or into it. */
export function placeViewPanel(
	panel: IDockviewPanel,
	beside: IDockviewPanel,
	position: ViewPosition,
): void {
	if (panel.id === beside.id)
		throw new ViewRefusal('bad_request', 'A tab cannot be placed beside itself.');
	const group = beside.group;
	// A pane's only tab cannot be split off its own pane; it is already there.
	if (position !== 'center' && panel.group === group && group.panels.length === 1) return;
	panel.api.moveTo({ group, position: DOCKVIEW_POSITION[position] });
}

/** Set the width and/or height of a tab's pane, as fractions of the whole. */
export function resizeViewPanel(
	api: DockviewApi,
	panel: IDockviewPanel,
	size: { readonly width?: number; readonly height?: number },
): void {
	panel.group.api.setSize({
		...(size.width === undefined ? {} : { width: Math.round(api.width * size.width) }),
		...(size.height === undefined ? {} : { height: Math.round(api.height * size.height) }),
	});
}

/** Columns and rows for an arrangement of `count` tabs. */
export function arrangementShape(
	arrangement: TabArrangement,
	count: number,
): { readonly columns: number; readonly rows: number } {
	if (count <= 0) return { columns: 0, rows: 0 };
	switch (arrangement) {
		case 'tabs':
			return { columns: 1, rows: 1 };
		case 'columns':
			return { columns: count, rows: 1 };
		case 'rows':
			return { columns: 1, rows: count };
		case 'grid': {
			const columns = Math.ceil(Math.sqrt(count));
			return { columns, rows: Math.ceil(count / columns) };
		}
	}
}

/**
 * Arrange tabs, in order, into equal panes: row by row for a grid, so four
 * tabs make two columns of two with the first two tabs on top.
 */
export function arrangeViewPanels(
	api: DockviewApi,
	panels: readonly IDockviewPanel[],
	arrangement: TabArrangement,
): void {
	const [first, ...rest] = panels;
	if (first === undefined) return;
	// Gather every tab into the first one's pane, then deal them out.
	for (const panel of rest)
		if (panel.group !== first.group) panel.api.moveTo({ group: first.group, position: 'center' });
	if (arrangement === 'tabs') {
		first.api.setActive();
		return;
	}
	const { columns, rows } = arrangementShape(arrangement, panels.length);
	const at = (row: number, column: number) => panels[row * columns + column];
	// The top of each column, to the right of the one before.
	for (let column = 1; column < columns; column += 1) {
		const top = at(0, column);
		const previous = at(0, column - 1);
		if (top === undefined || previous === undefined) break;
		top.api.moveTo({ group: previous.group, position: 'right' });
	}
	// Each column's rows, below the one above.
	for (let column = 0; column < columns; column += 1)
		for (let row = 1; row < rows; row += 1) {
			const panel = at(row, column);
			const above = at(row - 1, column);
			if (panel === undefined || above === undefined) continue;
			panel.api.moveTo({ group: above.group, position: 'bottom' });
		}
	equalise(api, panels, columns, rows);
}

function equalise(
	api: DockviewApi,
	panels: readonly IDockviewPanel[],
	columns: number,
	rows: number,
): void {
	const groups = (column: number): DockviewGroupPanel[] => {
		const found: DockviewGroupPanel[] = [];
		for (let row = 0; row < rows; row += 1) {
			const panel = panels[row * columns + column];
			if (panel !== undefined) found.push(panel.group);
		}
		return found;
	};
	if (columns > 1)
		for (let column = 0; column < columns - 1; column += 1)
			groups(column)[0]?.api.setSize({ width: Math.floor(api.width / columns) });
	for (let column = 0; column < columns; column += 1) {
		const stack = groups(column);
		for (let row = 0; row < stack.length - 1; row += 1)
			stack[row]!.api.setSize({ height: Math.floor(api.height / stack.length) });
	}
}

/**
 * A file path inside a folder root, or undefined when it would leave it. The
 * server confines every read to the root anyway; this only refuses to open a
 * tab for a path that could never be shown.
 */
export function pathInsideRoot(root: string, path: string): string | undefined {
	const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
	const parts = (value: string) => value.split(/[\\/]+/).filter((part) => part.length > 0);
	const rootParts = parts(root);
	const absolute = /^([A-Za-z]:)?[\\/]/.test(path);
	const combined = absolute ? parts(path) : [...rootParts, ...parts(path)];
	const resolved: string[] = [];
	for (const part of combined) {
		if (part === '.') continue;
		if (part === '..') {
			if (resolved.length === 0) return undefined;
			resolved.pop();
			continue;
		}
		resolved.push(part);
	}
	if (resolved.length <= rootParts.length) return undefined;
	for (let index = 0; index < rootParts.length; index += 1)
		if (resolved[index] !== rootParts[index]) return undefined;
	const leading = /^[A-Za-z]:/.test(rootParts[0] ?? '') ? '' : separator;
	return `${leading}${resolved.join(separator)}`;
}
