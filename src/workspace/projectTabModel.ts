import { defaultTerminalSettings } from '../terminalSettings';
import type { SidebarPanelId, SidebarSettings } from '../types/settings';

const PROJECT_TAB_COLOR_PALETTE_SIZE = 20;

export type ProjectTab = {
	id: string;
	title: string;
	color: string;
	emoji: string;
	fileExplorerWidth: number;
	isFileExplorerOpen: boolean;
	isExplorerPaneCollapsed: boolean;
	isAgentsPaneCollapsed: boolean;
	isGitPaneCollapsed: boolean;
	expandedAgentEntryIds: string[];
	sidebarAgentsHeight: number;
	sidebarExplorerHeight: number;
	sidebarGitHeight: number;
	sidebarPanelOrder: SidebarPanelId[];
	rootFolder: string;
};

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

const DEFAULT_PROJECT_TAB_COLORS = Array.from(
	{ length: PROJECT_TAB_COLOR_PALETTE_SIZE },
	(_, index) =>
		hueToProjectTabColor((360 / PROJECT_TAB_COLOR_PALETTE_SIZE) * index),
) as readonly string[];

export function getRandomProjectTabColor(
	usedColors: Iterable<string> = [],
): string {
	return getDeterministicProjectTabColor('project-default', usedColors);
}

function stableProjectColorIndex(identity: string, size: number): number {
	let hash = 2166136261;
	for (const character of identity) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % size;
}

/** Pick a stable default from project identity while avoiding colors already in
 * use. Persisted and explicitly selected project colors bypass this path. */
export function getDeterministicProjectTabColor(
	identity: string,
	usedColors: Iterable<string> = [],
): string {
	const used = new Set(
		Array.from(usedColors, (color) => color.trim().toLowerCase()),
	);
	const start = stableProjectColorIndex(
		identity,
		DEFAULT_PROJECT_TAB_COLORS.length,
	);
	for (
		let offset = 0;
		offset < DEFAULT_PROJECT_TAB_COLORS.length;
		offset += 1
	) {
		const color =
			DEFAULT_PROJECT_TAB_COLORS[
				(start + offset) % DEFAULT_PROJECT_TAB_COLORS.length
			];
		if (color !== undefined && !used.has(color.toLowerCase())) return color;
	}
	return hueToProjectTabColor(stableProjectColorIndex(identity, 360));
}

export function createProjectTab(
	index: number,
	homePath: string,
	usedColors: Iterable<string> = [],
	sidebarDefaults: SidebarSettings = defaultTerminalSettings.sidebar,
	colorScope = 'desktop-local',
): ProjectTab {
	const id = `project-${index}`;
	return {
		id,
		title: `Project ${index}`,
		color: getDeterministicProjectTabColor(`${colorScope}:${id}`, usedColors),
		emoji: '',
		fileExplorerWidth: sidebarDefaults.defaultWidth,
		isFileExplorerOpen: false,
		isExplorerPaneCollapsed:
			sidebarDefaults.defaultExplorerState === 'collapsed',
		isAgentsPaneCollapsed: false,
		isGitPaneCollapsed: sidebarDefaults.defaultGitState === 'collapsed',
		expandedAgentEntryIds: [],
		sidebarAgentsHeight: sidebarDefaults.defaultAgentsPaneHeight,
		sidebarExplorerHeight: sidebarDefaults.defaultExplorerPaneHeight,
		sidebarGitHeight: sidebarDefaults.defaultGitPaneHeight,
		sidebarPanelOrder: [...sidebarDefaults.panelOrder],
		rootFolder: homePath,
	};
}
