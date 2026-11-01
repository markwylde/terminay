import assert from 'node:assert/strict';
import test from 'node:test';
import { HOME_SECTION_LABELS, HOME_SECTIONS } from './homeSection.ts';
import {
	defaultHomeTabTitle,
	homeTabId,
	homeTabSection,
	homeTabServerId,
	parseHomeTabId,
	sanitizeHomeLayout,
} from './homeTabs.ts';

test('Home lists exactly five sections, Bots between Tabs and Automations', () => {
	assert.deepEqual(HOME_SECTIONS, [
		'home',
		'tabs',
		'bots',
		'automations',
		'recordings',
	]);
	assert.deepEqual(
		HOME_SECTIONS.map((section) => HOME_SECTION_LABELS[section]),
		['Home', 'Tabs', 'Bots', 'Automations', 'Recordings'],
	);
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
	const id = homeTabId({ kind: 'bot', serverId: 'local', botId: 'abcdef123456' });
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
		(restored?.panels as Record<string, { title: string }> | undefined)?.[id]?.title,
		'Bird',
	);
});
