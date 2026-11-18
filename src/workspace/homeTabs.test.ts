import assert from 'node:assert/strict';
import test from 'node:test';
import {
	HOME_SECTION_LABELS,
	HOME_SECTIONS,
	visibleHomeSections,
} from './homeSection.ts';
import {
	defaultHomeTabTitle,
	homeTabId,
	homeTabSection,
	homeTabServerId,
	parseHomeTabId,
	sanitizeHomeLayout,
} from './homeTabs.ts';

test("Home lists its sections in order, What's New second, Pull Requests and Issues after Recordings", () => {
	assert.deepEqual(HOME_SECTIONS, [
		'home',
		'whatsNew',
		'tabs',
		'bots',
		'automations',
		'workflows',
		'recordings',
		'pullRequests',
		'issues',
	]);
	assert.deepEqual(
		HOME_SECTIONS.map((section) => HOME_SECTION_LABELS[section]),
		[
			'Home',
			"What's New",
			'Tabs',
			'Bots',
			'Automations',
			'Workflows',
			'Recordings',
			'Pull Requests',
			'Issues',
		],
	);
});

test("without a forge source, What's New stays second and the forge sections drop out", () => {
	assert.deepEqual(visibleHomeSections(new Set(['pullRequests', 'issues'])), [
		'home',
		'whatsNew',
		'tabs',
		'bots',
		'automations',
		'workflows',
		'recordings',
	]);
});

test('a bot tab belongs to Bots and round-trips through its id', () => {
	const descriptor = {
		kind: 'bot',
		serverId: 'srv:1',
		botId: 'abcdef123456',
	} as const;
	const id = homeTabId(descriptor);
	assert.equal(id, 'bot:srv%3A1:abcdef123456');
	assert.deepEqual(parseHomeTabId(id), descriptor);
	assert.equal(homeTabSection(descriptor), 'bots');
	assert.equal(homeTabServerId(descriptor), 'srv:1');
	assert.equal(defaultHomeTabTitle(descriptor), 'Bot');
	assert.equal(parseHomeTabId('bot:only-one-part'), undefined);
});

test('every section owns its own section tab, and other tabs keep their owners', () => {
	for (const section of HOME_SECTIONS)
		assert.equal(homeTabSection({ kind: 'section', section }), section);
	assert.equal(
		homeTabSection({ kind: 'recording', serverId: 's', recordingId: 'r' }),
		'recordings',
	);
	assert.equal(
		homeTabSection({ kind: 'automation', serverId: 's', automationId: 'a' }),
		'automations',
	);
});

test('a remembered bot tab is restored', () => {
	const id = homeTabId({
		kind: 'bot',
		serverId: 'local',
		botId: 'abcdef123456',
	});
	const restored = sanitizeHomeLayout({
		grid: {
			root: {
				type: 'branch',
				data: [{ type: 'leaf', data: { views: [id], activeView: id } }],
			},
			height: 1,
			width: 1,
			orientation: 'HORIZONTAL',
		},
		panels: { [id]: { title: 'Bird' } },
	});
	assert.equal(
		(restored?.panels as Record<string, { title: string }> | undefined)?.[id]
			?.title,
		'Bird',
	);
});

test('a pull request or issue tab belongs to its section and round-trips through its id', () => {
	const descriptor = {
		kind: 'forge-item',
		serverId: 'srv:1',
		sourceId: 'com.terminay.gitea/forge',
		itemKind: 'issue',
		origin: 'https://git.example.net:4222',
		owner: 'acme',
		name: 'app',
		number: 540,
	} as const;
	const id = homeTabId(descriptor);
	assert.equal(
		id,
		'forge-item:srv%3A1:com.terminay.gitea%2Fforge:issue:https%3A%2F%2Fgit.example.net%3A4222:acme:app:540',
	);
	assert.deepEqual(parseHomeTabId(id), descriptor);
	assert.equal(homeTabSection(descriptor), 'issues');
	assert.equal(
		homeTabSection({ ...descriptor, itemKind: 'pullRequest' }),
		'pullRequests',
	);
	assert.equal(homeTabServerId(descriptor), 'srv:1');
	assert.equal(defaultHomeTabTitle(descriptor), 'app#540');
});

test('a malformed pull request or issue tab id names nothing', () => {
	const id = homeTabId({
		kind: 'forge-item',
		serverId: 's',
		sourceId: 'src',
		itemKind: 'pullRequest',
		origin: 'https://git.example.net',
		owner: 'acme',
		name: 'app',
		number: 7,
	});
	assert.equal(
		parseHomeTabId(id.replace(':pullRequest:', ':commit:')),
		undefined,
	);
	assert.equal(parseHomeTabId(id.replace(/:7$/, ':0')), undefined);
	assert.equal(parseHomeTabId(id.replace(/:7$/, ':07')), undefined);
	assert.equal(parseHomeTabId(id.replace(/:7$/, ':7.5')), undefined);
	assert.equal(parseHomeTabId(id.replace(/:7$/, '')), undefined);
});
