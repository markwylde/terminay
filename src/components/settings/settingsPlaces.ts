/**
 * Where each setting lives, for the Settings places rail (ADR-0115).
 *
 * A setting appears only under the place that stores it: this device (the
 * connection host) or a server. Its place is read from the same authority the
 * settings stores use, so a new setting lands in the right place by declaring
 * its authority, never by being added to a list here.
 */

import {
	SERVER_OWNED_TERMINAL_SETTING_KEYS,
	type SettingsFieldDefinition,
	type SettingsSectionDefinition,
} from '../../terminalSettings.ts';
import type { TerminalSettings } from '../../types/settings.ts';

export type SettingsPlaceKind = 'device' | 'server';

/** Device overrides: paths under a server-owned key that the device keeps. */
export const DEVICE_OVERRIDE_SETTING_PATHS: ReadonlySet<string> = new Set([
	'dictation.microphoneDeviceId',
]);

/** The place that stores the setting at `key`, a dotted path. */
export function placeOfSettingKey(key: string): SettingsPlaceKind {
	if (DEVICE_OVERRIDE_SETTING_PATHS.has(key)) return 'device';
	const top = key.split('.')[0] as keyof TerminalSettings;
	return SERVER_OWNED_TERMINAL_SETTING_KEYS.has(top) ? 'server' : 'device';
}

/**
 * Sections listed under another category than the one they are defined in.
 * Without the move a server would get an Appearance page holding only tab
 * indicators, and the device a Files page holding only sidebar defaults.
 */
const SECTION_PLACEMENT: Readonly<Record<string, string>> = Object.freeze({
	'tab-indicators': 'interaction',
	sidebar: 'appearance',
});

/** Sections with no fields of their own, placed by what they manage. */
const FIELDLESS_SECTION_PLACES: Readonly<Record<string, SettingsPlaceKind>> =
	Object.freeze({ 'shell-launch': 'server' });

/** The category a section is listed under. */
export function placementCategoryId(section: Pick<SettingsSectionDefinition, 'id' | 'categoryId'>): string {
	return SECTION_PLACEMENT[section.id] ?? section.categoryId;
}

export type PlacedSection = Omit<SettingsSectionDefinition, 'categoryId' | 'fields'> &
	Readonly<{
		/** The category the section is listed under in this place. */
		categoryId: SettingsSectionDefinition['categoryId'];
		fields: SettingsFieldDefinition[];
	}>;

/**
 * The sections of one place, each holding only that place's fields and
 * listed under its placement category. A section with no field there is left
 * out.
 */
export function sectionsForPlace(
	sections: readonly SettingsSectionDefinition[],
	place: SettingsPlaceKind,
): PlacedSection[] {
	return sections.flatMap((section) => {
		const fields = section.fields.filter((field) => placeOfSettingKey(field.key) === place);
		const keep =
			fields.length > 0 ||
			(section.fields.length === 0 && FIELDLESS_SECTION_PLACES[section.id] === place);
		if (!keep) return [];
		return [
			{
				...section,
				categoryId: placementCategoryId(section) as SettingsSectionDefinition['categoryId'],
				fields,
			},
		];
	});
}

/** Categories that are not lists of settings fields, by the place they manage. */
const NON_FIELD_CATEGORY_PLACES: Readonly<Record<string, SettingsPlaceKind | 'both'>> =
	Object.freeze({
		servers: 'device',
		'import-export': 'device',
		diagnostics: 'device',
		remote: 'server',
		macros: 'server',
		workflows: 'server',
		extensions: 'server',
		// Each place has its own Updates page: Desktop's channel, or a server's track.
		updates: 'both',
	});

export type PlaceHost = Readonly<{
	/** Terminay Desktop, which has an updater, diagnostics and Import & Export. */
	desktop: boolean;
}>;

/** Desktop-only categories of this device. */
const DESKTOP_ONLY_DEVICE_CATEGORIES: ReadonlySet<string> = new Set([
	'import-export',
	'updates',
	'diagnostics',
]);

/**
 * Whether `categoryId` belongs under `place` on this host. Field categories
 * belong where they have at least one placed section; the rest are placed by
 * what they manage.
 */
export function categoryBelongsToPlace(
	categoryId: string,
	place: SettingsPlaceKind,
	host: PlaceHost,
	placedSections: readonly Pick<PlacedSection, 'categoryId'>[],
): boolean {
	if (place === 'device' && !host.desktop && DESKTOP_ONLY_DEVICE_CATEGORIES.has(categoryId))
		return false;
	const fixed = NON_FIELD_CATEGORY_PLACES[categoryId];
	if (fixed !== undefined) return fixed === 'both' || fixed === place;
	return placedSections.some((section) => section.categoryId === categoryId);
}

/**
 * The place a request for a category opens. Device-only categories open on
 * the device; the rest open on the active project's server, else the first
 * attached server, else the device.
 */
export function placeForCategory(
	categoryId: string,
	options: Readonly<{
		deviceHasCategory: boolean;
		serverHasCategory: boolean;
		activeServerPlaceId?: string;
		serverPlaceIds: readonly string[];
	}>,
): string {
	const server = options.activeServerPlaceId ?? options.serverPlaceIds[0];
	if (options.serverHasCategory && !options.deviceHasCategory && server !== undefined)
		return server;
	if (options.deviceHasCategory && !options.serverHasCategory) return DEVICE_PLACE_ID;
	if (categoryId === 'updates') return server ?? DEVICE_PLACE_ID;
	return options.activeServerPlaceId ?? DEVICE_PLACE_ID;
}

/** The id of the device tile on the rail. Server tiles use their profile id. */
export const DEVICE_PLACE_ID = '__device__';

/**
 * The place Settings shows when it is opened with no category named: where it
 * was last left, while that place is still attached; otherwise the active
 * project's server, or the device when no project tab is active.
 */
export function placeOnOpen(
	options: Readonly<{
		lastPlaceId?: string;
		activeServerPlaceId?: string;
		serverPlaceIds: readonly string[];
	}>,
): string {
	const { lastPlaceId } = options;
	if (
		lastPlaceId !== undefined &&
		(lastPlaceId === DEVICE_PLACE_ID || options.serverPlaceIds.includes(lastPlaceId))
	)
		return lastPlaceId;
	return options.activeServerPlaceId ?? DEVICE_PLACE_ID;
}

/**
 * Whether Settings leaves a server place for this device after the attached
 * servers change: when none is left, or when the server it showed has gone.
 * It never moves quietly to another server.
 */
export function leavesServerPlace(
	options: Readonly<{
		previousServerPlaceId?: string;
		serverPlaceIds: readonly string[];
	}>,
): boolean {
	const { previousServerPlaceId, serverPlaceIds } = options;
	return (
		serverPlaceIds.length === 0 ||
		(previousServerPlaceId !== undefined && !serverPlaceIds.includes(previousServerPlaceId))
	);
}

/**
 * The category to show after moving to another place: the same one when the
 * new place has it, otherwise the new place's first.
 */
export function categoryAfterPlaceChange(
	currentCategoryId: string,
	nextPlaceCategoryIds: readonly string[],
): string | undefined {
	return nextPlaceCategoryIds.includes(currentCategoryId)
		? currentCategoryId
		: nextPlaceCategoryIds[0];
}

export type DeviceHostKind = 'mac' | 'pc' | 'browser';

/** The device tile's name. */
export function devicePlaceName(kind: DeviceHostKind): string {
	switch (kind) {
		case 'mac':
			return 'This Mac';
		case 'pc':
			return 'This PC';
		case 'browser':
			return 'This device';
	}
}

/** Which device name applies, from whether this is Desktop and its platform. */
export function deviceHostKind(desktop: boolean, platform: string): DeviceHostKind {
	if (!desktop) return 'browser';
	return platform.toLowerCase().includes('mac') ? 'mac' : 'pc';
}

/** The one-line scope statement every category page carries. */
export function placeScopeLine(
	options: Readonly<{
		place: SettingsPlaceKind;
		categoryId: string;
		deviceName: string;
		serverName?: string;
	}>,
): string {
	const device = options.deviceName.replace(/^This /, 'this ');
	if (options.place === 'device') {
		if (options.categoryId === 'import-export')
			return 'Across every attached server · each through its own connection';
		if (options.categoryId === 'servers')
			return `On ${device} · the servers ${device} connects to`;
		return `On ${device} · whichever server is connected`;
	}
	return `On ${options.serverName ?? 'this server'} · every device connected to it`;
}

/** A stable, readable colour for a server tile, derived from its identity. */
export function serverTileColor(identity: string): string {
	let hash = 0;
	for (const character of identity) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	const hue = hash % 360;
	return `hsl(${hue} 32% 34%)`;
}

/** The letter on a server tile. */
export function serverTileInitial(name: string): string {
	const letter = [...name.trim()][0];
	return letter === undefined ? '?' : letter.toLocaleUpperCase();
}
