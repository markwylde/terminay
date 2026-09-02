import { defaultTerminalSettings } from '../terminalSettings.ts';
import type { SidebarGroupId, SidebarPanelId, SidebarSettings } from '../types/settings';

const PROJECT_TAB_COLOR_PALETTE_SIZE = 20;
const BUSY_ENVIRONMENT_STATUSES = new Set([
	'connecting',
	'reconnecting',
	'provisioning',
	'starting',
]);

export function projectTabIsBusy(
	project: Pick<
		ProjectTab,
		'creationStatus' | 'environmentStatus' | 'hydrating'
	>,
): boolean {
	if (project.creationStatus === 'loading' || project.hydrating === true)
		return true;
	return (
		project.environmentStatus !== undefined &&
		BUSY_ENVIRONMENT_STATUSES.has(project.environmentStatus)
	);
}

export type ProjectTab = {
	creationError?: string;
	creationStatus?: 'loading' | 'failed';
	hydrating?: boolean;
	projectEnvironmentId?: string;
	environmentRevision?: number;
	environmentLabel?: string;
	environmentStatus?: string;
	defaultShellProfileId?: string;
	id: string;
	title: string;
	color: string;
	emoji: string;
	fileExplorerWidth: number;
	isFileExplorerOpen: boolean;
	sidebarActiveGroup: SidebarGroupId;
	isExplorerPaneCollapsed: boolean;
	isAgentsPaneCollapsed: boolean;
	isGitPaneCollapsed: boolean;
	isDocumentationPaneCollapsed: boolean;
	expandedAgentEntryIds: string[];
	expandedDocumentationFolderIds: string[];
	sidebarAgentsHeight: number;
	sidebarExplorerHeight: number;
	sidebarGitHeight: number;
	sidebarDocumentationHeight: number;
	sidebarPanelOrder: SidebarPanelId[];
	rootFolder: string;
};

export type ProjectSidebarState = Pick<
	ProjectTab,
	| 'fileExplorerWidth'
	| 'isExplorerPaneCollapsed'
	| 'isAgentsPaneCollapsed'
	| 'isGitPaneCollapsed'
	| 'isDocumentationPaneCollapsed'
	| 'expandedAgentEntryIds'
	| 'expandedDocumentationFolderIds'
	| 'sidebarAgentsHeight'
	| 'sidebarExplorerHeight'
	| 'sidebarGitHeight'
	| 'sidebarDocumentationHeight'
	| 'sidebarPanelOrder'
>;

type ProjectSidebarInput = Omit<
	ProjectSidebarState,
	'expandedAgentEntryIds' | 'expandedDocumentationFolderIds' | 'sidebarPanelOrder'
> & {
	readonly expandedAgentEntryIds: readonly string[];
	readonly expandedDocumentationFolderIds: readonly string[];
	readonly sidebarPanelOrder: readonly SidebarPanelId[];
};

const PROJECT_SIDEBAR_KEYS: readonly (keyof ProjectSidebarState)[] = [
	'fileExplorerWidth',
	'isExplorerPaneCollapsed',
	'isAgentsPaneCollapsed',
	'isGitPaneCollapsed',
	'isDocumentationPaneCollapsed',
	'expandedAgentEntryIds',
	'expandedDocumentationFolderIds',
	'sidebarAgentsHeight',
	'sidebarExplorerHeight',
	'sidebarGitHeight',
	'sidebarDocumentationHeight',
	'sidebarPanelOrder',
];

export function projectSidebarVisibilityKey(
	serverId: string,
	projectId: string,
): string {
	return `${serverId}:${projectId}`;
}

export function isProjectSidebarOpenOnDevice(
	sidebarSettings: SidebarSettings,
	serverId: string,
	projectId: string,
): boolean {
	return sidebarSettings.projectVisibility[
		projectSidebarVisibilityKey(serverId, projectId)
	] === true;
}

export function withProjectSidebarVisibility(
	sidebarSettings: SidebarSettings,
	serverId: string,
	projectId: string,
	isOpen: boolean,
): SidebarSettings {
	return {
		...sidebarSettings,
		projectVisibility: {
			...sidebarSettings.projectVisibility,
			[projectSidebarVisibilityKey(serverId, projectId)]: isOpen,
		},
	};
}

export function sidebarActiveGroupOnDevice(
	sidebarSettings: SidebarSettings,
	serverId: string,
	projectId: string,
): SidebarGroupId {
	return (
		sidebarSettings.projectActiveGroup[
			projectSidebarVisibilityKey(serverId, projectId)
		] ?? 'explorer'
	);
}

export function withProjectSidebarActiveGroup(
	sidebarSettings: SidebarSettings,
	serverId: string,
	projectId: string,
	groupId: SidebarGroupId,
): SidebarSettings {
	return {
		...sidebarSettings,
		projectActiveGroup: {
			...sidebarSettings.projectActiveGroup,
			[projectSidebarVisibilityKey(serverId, projectId)]: groupId,
		},
	};
}

export function projectSidebarState(project: ProjectSidebarInput): ProjectSidebarState {
	return {
		...project,
		expandedAgentEntryIds: [...project.expandedAgentEntryIds],
		expandedDocumentationFolderIds: [...project.expandedDocumentationFolderIds],
		sidebarPanelOrder: [...project.sidebarPanelOrder],
	};
}

export function projectSidebarPatch(
	updates: Partial<ProjectTab>,
): Partial<ProjectSidebarState> | null {
	const patch: Partial<ProjectSidebarState> = {};
	for (const key of PROJECT_SIDEBAR_KEYS) {
		if (!(key in updates)) continue;
		const value = updates[key];
		if (value === undefined) continue;
		Object.assign(patch, { [key]: Array.isArray(value) ? [...value] : value });
	}
	return Object.keys(patch).length === 0 ? null : patch;
}

function hueToProjectTabColor(hue: number): string {
	const normalizedHue = (((hue % 360) + 360) % 360) / 360;
	const saturation = 0.65;
	const lightness = 0.6;
	const hue2rgb = (p: number, q: number, value: number) => {
		let t = value;
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	const q =
		lightness < 0.5
			? lightness * (1 + saturation)
			: lightness + saturation - lightness * saturation;
	const p = 2 * lightness - q;
	const toHex = (value: number) =>
		Math.round(value * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${toHex(hue2rgb(p, q, normalizedHue + 1 / 3))}${toHex(hue2rgb(p, q, normalizedHue))}${toHex(hue2rgb(p, q, normalizedHue - 1 / 3))}`;
}

const PROJECT_TAB_COLOR_PALETTE_HUES = Array.from(
	{ length: PROJECT_TAB_COLOR_PALETTE_SIZE },
	(_, index) => (360 / PROJECT_TAB_COLOR_PALETTE_SIZE) * index,
) as readonly number[];

const DEFAULT_PROJECT_TAB_COLORS = PROJECT_TAB_COLOR_PALETTE_HUES.map(
	hueToProjectTabColor,
) as readonly string[];

/** Read the hue back out of a `#rrggbb` color. Returns null for anything that is
 * not one, and for greys, which carry no hue to keep away from. */
export function projectTabColorHue(color: string): number | null {
	const digits = /^#([0-9a-f]{6})$/i.exec(color.trim())?.[1];
	if (digits === undefined) return null;
	const packed = Number.parseInt(digits, 16);
	const red = ((packed >> 16) & 0xff) / 255;
	const green = ((packed >> 8) & 0xff) / 255;
	const blue = (packed & 0xff) / 255;
	const max = Math.max(red, green, blue);
	const chroma = max - Math.min(red, green, blue);
	if (chroma === 0) return null;
	const sextant =
		max === red
			? (green - blue) / chroma
			: max === green
				? (blue - red) / chroma + 2
				: (red - green) / chroma + 4;
	return (((sextant * 60) % 360) + 360) % 360;
}

/** Shortest arc between two hues, 0-180. */
export function projectTabHueDistance(left: number, right: number): number {
	const delta = Math.abs(left - right) % 360;
	return delta > 180 ? 360 - delta : delta;
}

export function getRandomProjectTabColor(
	usedColors: Iterable<string> = [],
): string {
	return getProjectTabColor('project-default', usedColors);
}

function stableProjectColorIndex(identity: string, size: number): number {
	let hash = 2166136261;
	for (const character of identity) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % size;
}

/** Pick the palette color furthest from the colors already in use, so a new
 * project reads as a different color family rather than a neighbouring shade.
 * Ties resolve from project identity, which keeps the result reproducible for a
 * given project and workspace state - reconciliation re-derives a color for any
 * project the server holds without one, and that must not change under it.
 *
 * Pass `randomSource` only where a project is genuinely being created. With no
 * color in use every entry is equally correct, and a caller that is assigning a
 * brand new color may spend that freedom on variety. Persisted and explicitly
 * selected project colors bypass this path. */
export function getProjectTabColor(
	identity: string,
	usedColors: Iterable<string> = [],
	randomSource?: () => number,
): string {
	const usedHues: number[] = [];
	for (const color of usedColors) {
		const hue = projectTabColorHue(color);
		if (hue !== null) usedHues.push(hue);
	}
	if (usedHues.length === 0 && randomSource !== undefined) {
		const index = Math.min(
			DEFAULT_PROJECT_TAB_COLORS.length - 1,
			Math.max(0, Math.floor(randomSource() * DEFAULT_PROJECT_TAB_COLORS.length)),
		);
		return DEFAULT_PROJECT_TAB_COLORS[index] ?? hueToProjectTabColor(0);
	}
	let bestDistance = -1;
	let furthest: string[] = [];
	for (let index = 0; index < DEFAULT_PROJECT_TAB_COLORS.length; index += 1) {
		const color = DEFAULT_PROJECT_TAB_COLORS[index];
		const hue = PROJECT_TAB_COLOR_PALETTE_HUES[index];
		if (color === undefined || hue === undefined) continue;
		let nearest = Number.POSITIVE_INFINITY;
		for (const usedHue of usedHues) {
			nearest = Math.min(nearest, projectTabHueDistance(hue, usedHue));
		}
		if (nearest > bestDistance) {
			bestDistance = nearest;
			furthest = [color];
		} else if (nearest === bestDistance) {
			furthest.push(color);
		}
	}
	return (
		furthest[stableProjectColorIndex(identity, furthest.length)] ??
		hueToProjectTabColor(0)
	);
}

export function createProjectTab(
	index: number,
	homePath: string,
	usedColors: Iterable<string> = [],
	sidebarDefaults: SidebarSettings = defaultTerminalSettings.sidebar,
	colorScope = 'desktop-local',
	randomSource?: () => number,
): ProjectTab {
	const id = `project-${index}`;
	return {
		projectEnvironmentId: 'terminay:this-server',
		environmentRevision: 1,
		environmentLabel: 'This server',
		environmentStatus: 'ready',
		id,
		title: `Project ${index}`,
		color: getProjectTabColor(`${colorScope}:${id}`, usedColors, randomSource),
		emoji: '',
		fileExplorerWidth: sidebarDefaults.defaultWidth,
		isFileExplorerOpen: false,
		sidebarActiveGroup: 'explorer',
		isExplorerPaneCollapsed:
			sidebarDefaults.defaultExplorerState === 'collapsed',
		isAgentsPaneCollapsed: false,
		isGitPaneCollapsed: sidebarDefaults.defaultGitState === 'collapsed',
		isDocumentationPaneCollapsed: sidebarDefaults.defaultDocumentationState === 'collapsed',
		expandedAgentEntryIds: [],
		expandedDocumentationFolderIds: [],
		sidebarAgentsHeight: sidebarDefaults.defaultAgentsPaneHeight,
		sidebarExplorerHeight: sidebarDefaults.defaultExplorerPaneHeight,
		sidebarGitHeight: sidebarDefaults.defaultGitPaneHeight,
		sidebarDocumentationHeight: sidebarDefaults.defaultDocumentationPaneHeight,
		sidebarPanelOrder: [...sidebarDefaults.panelOrder],
		rootFolder: homePath,
	};
}
