import assert from 'node:assert/strict';
import test from 'node:test';
import { DEVICE_OVERRIDE_PATHS, SETTING_AUTHORITY } from '@terminay/server-core';
import {
	defaultTerminalSettings,
	SERVER_OWNED_TERMINAL_SETTING_KEYS,
	terminalSettingsCategories,
	terminalSettingsSections,
} from '../../terminalSettings.ts';
import type { TerminalSettings } from '../../types/settings.ts';
import { groupSettingsCategories } from './settingsCategoryGroups.ts';
import {
	categoryAfterPlaceChange,
	leavesServerPlace,
	categoryBelongsToPlace,
	DEVICE_PLACE_ID,
	deviceHostKind,
	devicePlaceName,
	placeForCategory,
	placeOfSettingKey,
	placeOnOpen,
	placeScopeLine,
	type SettingsPlaceKind,
	sectionsForPlace,
	serverTileColor,
	serverTileInitial,
} from './settingsPlaces.ts';

const NON_FIELD_CATEGORIES = [
	'servers',
	'remote',
	'import-export',
	'macros',
	'workflows',
	'extensions',
	'diagnostics',
	'updates',
];

function groupedIds(place: SettingsPlaceKind, desktop: boolean) {
	const placed = sectionsForPlace(terminalSettingsSections, place);
	const ids = [
		...terminalSettingsCategories.map((category) => category.id as string),
		...NON_FIELD_CATEGORIES,
	].filter(
		(id, index, all) =>
			all.indexOf(id) === index && categoryBelongsToPlace(id, place, { desktop }, placed),
	);
	return groupSettingsCategories(ids.map((id) => ({ id, label: id }))).map((group) => [
		group.label,
		group.categories.map((category) => category.id),
	]);
}

test('the renderer and the server agree on every setting authority', () => {
	// Keys stored outside TerminalSettings (macros, shell profiles) are not
	// the renderer's to place.
	for (const key of Object.keys(defaultTerminalSettings) as (keyof TerminalSettings)[]) {
		const authority = SETTING_AUTHORITY[key];
		const serverOwned = SERVER_OWNED_TERMINAL_SETTING_KEYS.has(key);
		if (serverOwned) assert.equal(authority, 'server', `${key} is server-owned in the renderer only`);
		else
			assert.notEqual(authority, 'server', `${key} is server-owned on the server only`);
	}
	for (const path of DEVICE_OVERRIDE_PATHS) assert.equal(placeOfSettingKey(path), 'device');
});

test('a field is placed by its top-level authority', () => {
	assert.equal(placeOfSettingKey('scrollback'), 'server');
	assert.equal(placeOfSettingKey('activityIndicators.showActiveTabs'), 'server');
	assert.equal(placeOfSettingKey('macOptionIsMeta'), 'device');
	assert.equal(placeOfSettingKey('dictation.provider'), 'server');
	assert.equal(placeOfSettingKey('dictation.microphoneDeviceId'), 'device');
	assert.equal(placeOfSettingKey('updateChannel'), 'device');
});

test('no field is listed under both places', () => {
	const device = new Set(
		sectionsForPlace(terminalSettingsSections, 'device').flatMap((section) =>
			section.fields.map((field) => field.key),
		),
	);
	for (const section of sectionsForPlace(terminalSettingsSections, 'server'))
		for (const field of section.fields) assert.ok(!device.has(field.key), field.key);
});

test('tab indicators sit under a server Interaction and sidebar defaults under device Appearance', () => {
	const server = sectionsForPlace(terminalSettingsSections, 'server');
	const device = sectionsForPlace(terminalSettingsSections, 'device');
	assert.equal(server.find((section) => section.id === 'tab-indicators')?.categoryId, 'interaction');
	assert.equal(device.find((section) => section.id === 'sidebar')?.categoryId, 'appearance');
	assert.equal(device.find((section) => section.id === 'tab-indicators'), undefined);
	assert.equal(server.find((section) => section.id === 'sidebar'), undefined);
});

test('a mixed section keeps only the place’s own fields', () => {
	const deviceDictation = sectionsForPlace(terminalSettingsSections, 'device').find(
		(section) => section.id === 'dictation',
	);
	assert.deepEqual(
		deviceDictation?.fields.map((field) => field.key),
		['dictation.microphoneDeviceId'],
	);
	const serverDictation = sectionsForPlace(terminalSettingsSections, 'server').find(
		(section) => section.id === 'dictation',
	);
	assert.ok(serverDictation !== undefined);
	assert.ok(!serverDictation.fields.some((field) => field.key === 'dictation.microphoneDeviceId'));
});

test('categories of this Mac on Desktop', () => {
	assert.deepEqual(groupedIds('device', true), [
		['General', ['appearance', 'theme', 'keyboard', 'accessibility', 'ai']],
		['Terminal', ['cursor', 'interaction', 'scrolling']],
		['Connections', ['servers', 'import-export']],
		['System', ['updates', 'diagnostics']],
	]);
});

test('categories of this device in a browser', () => {
	assert.deepEqual(groupedIds('device', false), [
		['General', ['appearance', 'theme', 'keyboard', 'accessibility', 'ai']],
		['Terminal', ['cursor', 'interaction', 'scrolling']],
		['Connections', ['servers']],
	]);
});

test('categories of a server, on any host', () => {
	const expected = [
		['General', ['files', 'ai']],
		['Terminal', ['shell', 'interaction', 'scrolling']],
		['Connections', ['remote']],
		['Automation', ['macros', 'workflows', 'recording']],
		['Extensions', ['extensions']],
		['System', ['updates']],
	];
	assert.deepEqual(groupedIds('server', true), expected);
	assert.deepEqual(groupedIds('server', false), expected);
});

test('a request for a server-only category opens a server, even from Home', () => {
	const serverOnly = { deviceHasCategory: false, serverHasCategory: true };
	assert.equal(
		placeForCategory('macros', { ...serverOnly, serverPlaceIds: ['pop', 'local'] }),
		'pop',
	);
	assert.equal(
		placeForCategory('macros', {
			...serverOnly,
			activeServerPlaceId: 'local',
			serverPlaceIds: ['pop', 'local'],
		}),
		'local',
	);
	assert.equal(
		placeForCategory('servers', {
			deviceHasCategory: true,
			serverHasCategory: false,
			activeServerPlaceId: 'pop',
			serverPlaceIds: ['pop'],
		}),
		DEVICE_PLACE_ID,
	);
	assert.equal(
		placeForCategory('scrolling', {
			deviceHasCategory: true,
			serverHasCategory: true,
			activeServerPlaceId: 'pop',
			serverPlaceIds: ['pop'],
		}),
		'pop',
	);
});

test('reopening Settings returns to the last place while it is attached', () => {
	assert.equal(
		placeOnOpen({ lastPlaceId: DEVICE_PLACE_ID, activeServerPlaceId: 'pop', serverPlaceIds: ['pop'] }),
		DEVICE_PLACE_ID,
	);
	assert.equal(
		placeOnOpen({ lastPlaceId: 'gone', serverPlaceIds: ['pop'] }),
		DEVICE_PLACE_ID,
	);
	assert.equal(
		placeOnOpen({ lastPlaceId: 'gone', activeServerPlaceId: 'pop', serverPlaceIds: ['pop'] }),
		'pop',
	);
	assert.equal(placeOnOpen({ serverPlaceIds: [] }), DEVICE_PLACE_ID);
});

test('changing place keeps the category when the new place has it', () => {
	assert.equal(categoryAfterPlaceChange('scrolling', ['appearance', 'scrolling']), 'scrolling');
	assert.equal(categoryAfterPlaceChange('macros', ['appearance', 'scrolling']), 'appearance');
});

test('the device tile is named after the host', () => {
	assert.equal(devicePlaceName(deviceHostKind(true, 'MacIntel')), 'This Mac');
	assert.equal(devicePlaceName(deviceHostKind(true, 'Win32')), 'This PC');
	assert.equal(devicePlaceName(deviceHostKind(true, 'Linux x86_64')), 'This PC');
	assert.equal(devicePlaceName(deviceHostKind(false, 'MacIntel')), 'This device');
});

test('every page states its scope', () => {
	assert.equal(
		placeScopeLine({ place: 'device', categoryId: 'cursor', deviceName: 'This Mac' }),
		'On this Mac · whichever server is connected',
	);
	assert.equal(
		placeScopeLine({ place: 'device', categoryId: 'servers', deviceName: 'This Mac' }),
		'On this Mac · the servers this Mac connects to',
	);
	assert.equal(
		placeScopeLine({ place: 'device', categoryId: 'import-export', deviceName: 'This Mac' }),
		'Across every attached server · each through its own connection',
	);
	assert.equal(
		placeScopeLine({
			place: 'server',
			categoryId: 'scrolling',
			deviceName: 'This Mac',
			serverName: 'Pop Terminay',
		}),
		'On Pop Terminay · every device connected to it',
	);
});

test('server tiles have a stable colour and an initial', () => {
	assert.equal(serverTileColor('fierce-maple'), serverTileColor('fierce-maple'));
	assert.equal(serverTileInitial('pop terminay'), 'P');
	assert.equal(serverTileInitial('  '), '?');
});

test('the selected server detaching moves Settings to this device, never to another server', () => {
	assert.equal(
		leavesServerPlace({ previousServerPlaceId: 'pop', serverPlaceIds: ['local'] }),
		true,
	);
	assert.equal(leavesServerPlace({ previousServerPlaceId: 'pop', serverPlaceIds: [] }), true);
	assert.equal(
		leavesServerPlace({ previousServerPlaceId: 'pop', serverPlaceIds: ['local', 'pop'] }),
		false,
	);
	// Another server detaching leaves the selected one where it is.
	assert.equal(
		leavesServerPlace({ previousServerPlaceId: 'local', serverPlaceIds: ['local'] }),
		false,
	);
});
