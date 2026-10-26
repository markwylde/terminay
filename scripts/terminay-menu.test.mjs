import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTerminayMenu } from '../electron/terminayMenu.ts';

const SHORTCUTS = {
	'new-terminal': 'CmdOrCtrl+T',
	'new-project': 'CmdOrCtrl+P',
	'open-recordings': 'CmdOrCtrl+Shift+R',
};

function build(platform, shortcuts = SHORTCUTS) {
	const dispatched = [];
	let aboutShown = 0;
	const menu = buildTerminayMenu({
		platform,
		shortcut: (command) => shortcuts[command],
		dispatch: (command) => dispatched.push(command),
		showAbout: () => {
			aboutShown += 1;
		},
	});
	return { menu, dispatched, about: () => aboutShown };
}

/** The menu as the user sees it: visible entries, separators as '-'. */
function visibleEntries(menu) {
	return menu.submenu
		.filter((item) => item.visible !== false)
		.map((item) =>
			item.type === 'separator' ? '-' : (item.label ?? `role:${item.role}`),
		);
}

const byLabel = (menu, label) =>
	menu.submenu.find((item) => item.label === label);

test('macOS: the Terminay menu holds About, Settings, creation, and the system items', () => {
	const { menu } = build('darwin');
	assert.equal(menu.label, 'Terminay');
	assert.deepEqual(visibleEntries(menu), [
		'About Terminay',
		'-',
		'Settings…',
		'-',
		'New Terminal Tab',
		'New Project',
		'-',
		'role:services',
		'-',
		'role:hide',
		'role:hideOthers',
		'role:unhide',
		'-',
		'role:quit',
	]);
	assert.equal(byLabel(menu, 'Settings…').accelerator, 'CmdOrCtrl+,');
	assert.equal(byLabel(menu, 'New Terminal Tab').accelerator, 'CmdOrCtrl+T');
	assert.equal(byLabel(menu, 'New Project').accelerator, 'CmdOrCtrl+P');
});

for (const platform of ['linux', 'win32']) {
	test(`${platform}: the first menu is Terminay with creation, Settings, and Quit`, () => {
		const { menu } = build(platform);
		assert.equal(menu.label, 'Terminay');
		assert.deepEqual(visibleEntries(menu), [
			'New Terminal Tab',
			'New Project',
			'-',
			'Settings…',
			'-',
			'role:quit',
		]);
		assert.equal(byLabel(menu, 'Settings…').accelerator, 'CmdOrCtrl+,');
	});
}

for (const platform of ['darwin', 'linux']) {
	test(`${platform}: no File menu or management entries are visible`, () => {
		const { menu } = build(platform);
		const labels = visibleEntries(menu);
		for (const label of [
			'File',
			'Remote Control',
			'Remote Access',
			'Extensions…',
			'Extensions',
			'Macros',
			'Recordings',
			'Create a new terminal tab',
			'Create a new project',
		]) {
			assert.ok(!labels.includes(label), `${label} must not be visible`);
		}
	});

	test(`${platform}: management accelerators stay registered on hidden items`, () => {
		const { menu, dispatched } = build(platform);
		const macros = byLabel(menu, 'Macros');
		assert.equal(macros.visible, false);
		assert.equal(macros.acceleratorWorksWhenHidden, true);
		assert.equal(macros.accelerator, 'CmdOrCtrl+;');
		const recordings = byLabel(menu, 'Recordings');
		assert.equal(recordings.visible, false);
		assert.equal(recordings.accelerator, 'CmdOrCtrl+Shift+R');
		// Unbound commands get no hidden item.
		assert.equal(byLabel(menu, 'Remote Access'), undefined);
		macros.click();
		recordings.click();
		assert.deepEqual(dispatched, ['open-macros', 'open-recordings']);
	});

	test(`${platform}: entries dispatch the named commands`, () => {
		const { menu, dispatched } = build(platform);
		byLabel(menu, 'New Terminal Tab').click();
		byLabel(menu, 'New Project').click();
		byLabel(menu, 'Settings…').click();
		assert.deepEqual(dispatched, [
			'new-terminal',
			'new-project',
			'open-settings',
		]);
	});
}

test('macOS: About Terminay opens the About window', () => {
	const { menu, about } = build('darwin');
	byLabel(menu, 'About Terminay').click();
	assert.equal(about(), 1);
});
