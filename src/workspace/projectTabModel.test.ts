import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTerminalSettings } from '../terminalSettings.ts';
import {
	getDeterministicProjectTabColor,
	isProjectSidebarOpenOnDevice,
	projectSidebarPatch,
	projectSidebarVisibilityKey,
	projectTabColorHue,
	projectTabHueDistance,
	sidebarActiveGroupOnDevice,
	withProjectSidebarActiveGroup,
	withProjectSidebarVisibility,
} from './projectTabModel.ts';

test('sidebar visibility is device-local per server and project', () => {
	const desktop = withProjectSidebarVisibility(
		defaultTerminalSettings.sidebar,
		'server-a',
		'project-a',
		true,
	);

	assert.equal(isProjectSidebarOpenOnDevice(desktop, 'server-a', 'project-a'), true);
	assert.equal(isProjectSidebarOpenOnDevice(desktop, 'server-a', 'project-b'), false);
	assert.equal(isProjectSidebarOpenOnDevice(desktop, 'server-b', 'project-a'), false);
	assert.equal(projectSidebarVisibilityKey('server-a', 'project-a'), 'server-a:project-a');
	assert.equal(
		sidebarActiveGroupOnDevice(desktop, 'server-a', 'project-a'),
		'explorer',
	);
	const withDocs = withProjectSidebarActiveGroup(
		desktop,
		'server-a',
		'project-a',
		'documentation',
	);
	assert.equal(
		sidebarActiveGroupOnDevice(withDocs, 'server-a', 'project-a'),
		'documentation',
	);
	assert.equal(
		sidebarActiveGroupOnDevice(withDocs, 'server-a', 'project-b'),
		'explorer',
	);
	assert.deepEqual(
		projectSidebarPatch({
			isFileExplorerOpen: true,
			sidebarActiveGroup: 'documentation',
		}),
		null,
		'Sidebar visibility and selected group must not produce a canonical workspace patch.',
	);
});


/** Hue of an assigned color, failing the test rather than returning null so a
 * regression that stops producing palette colors is loud. */
function assignedHue(color: string): number {
	const hue = projectTabColorHue(color);
	assert.notEqual(hue, null, `Expected ${color} to be a hue-bearing color.`);
	return hue ?? 0;
}

test('color hue parsing reads primaries and rejects non-colors', () => {
	assert.equal(projectTabColorHue('#ff0000'), 0);
	assert.equal(projectTabColorHue('#00ff00'), 120);
	assert.equal(projectTabColorHue('#0000ff'), 240);
	assert.equal(projectTabColorHue('  #FFFF00  '), 60);
	for (const value of ['', 'red', '#zzzzzz', '#fff', '#808080']) {
		assert.equal(
			projectTabColorHue(value),
			null,
			`Expected ${value} to carry no hue.`,
		);
	}
});

test('assigned colors sit on the palette hues', () => {
	const hue = assignedHue(getDeterministicProjectTabColor('project-a'));
	assert.equal(
		Math.abs(hue - Math.round(hue / 18) * 18) < 1,
		true,
		`Expected ${hue} to be a palette hue.`,
	);
});

test('hue distance takes the shortest arc', () => {
	assert.equal(projectTabHueDistance(350, 10), 20);
	assert.equal(projectTabHueDistance(10, 350), 20);
	assert.equal(projectTabHueDistance(0, 180), 180);
	assert.equal(projectTabHueDistance(0, 190), 170);
	assert.equal(projectTabHueDistance(42, 42), 0);
});

test('a second project lands far from the first', () => {
	const first = getDeterministicProjectTabColor('desktop-local:project-1');
	const second = getDeterministicProjectTabColor('desktop-local:project-2', [
		first,
	]);
	assert.equal(
		projectTabHueDistance(assignedHue(first), assignedHue(second)) >= 150,
		true,
		`Expected a far-apart hue, got ${first} then ${second}.`,
	);
});

test('successive projects spread across the wheel', () => {
	const assigned: string[] = [];
	for (let index = 1; index <= 6; index += 1) {
		assigned.push(
			getDeterministicProjectTabColor(`desktop-local:project-${index}`, [
				...assigned,
			]),
		);
	}
	const hues = assigned.map(assignedHue);
	let closest = 180;
	for (let left = 0; left < hues.length; left += 1) {
		for (let right = left + 1; right < hues.length; right += 1) {
			closest = Math.min(
				closest,
				projectTabHueDistance(hues[left] ?? 0, hues[right] ?? 0),
			);
		}
	}
	// 36 is the widest separation twenty 18-degree palette hues allow for six
	// projects, and twice the 18 a first-unused-entry scan would leave. The one
	// degree of slack absorbs the rounding of a hue through an 8-bit hex color.
	assert.equal(
		closest >= 35,
		true,
		`Expected six projects at least 36 degrees apart, got ${closest}.`,
	);
});

test('an exhausted palette still assigns a palette color', () => {
	const assigned: string[] = [];
	for (let index = 1; index <= 20; index += 1) {
		assigned.push(
			getDeterministicProjectTabColor(`desktop-local:project-${index}`, [
				...assigned,
			]),
		);
	}
	assert.equal(new Set(assigned).size, 20, 'Expected all twenty palette hues.');
	const extra = getDeterministicProjectTabColor(
		'desktop-local:project-21',
		assigned,
	);
	assert.equal(
		assigned.includes(extra),
		true,
		`Expected a palette color, got ${extra}.`,
	);
});

test('assignment is deterministic and varies by identity', () => {
	const used = ['#e6994d'];
	assert.equal(
		getDeterministicProjectTabColor('project-a', used),
		getDeterministicProjectTabColor('project-a', used),
	);
	assert.notEqual(
		getDeterministicProjectTabColor('desktop-local:project-1'),
		getDeterministicProjectTabColor('server-7:project-4'),
	);
});

test('a user-chosen color off the palette still repels the next project', () => {
	const chosen = '#ff3366';
	const next = getDeterministicProjectTabColor('desktop-local:project-2', [
		chosen,
	]);
	assert.equal(
		projectTabHueDistance(assignedHue(chosen), assignedHue(next)) >= 150,
		true,
		`Expected the next color to avoid ${chosen}, got ${next}.`,
	);
});
