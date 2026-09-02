import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTerminalSettings } from '../terminalSettings.ts';
import {
	getProjectTabColor,
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
	const hue = assignedHue(getProjectTabColor('project-a', [], () => 0));
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
	const first = getProjectTabColor('desktop-local:project-1', [], () => 0);
	const second = getProjectTabColor('desktop-local:project-2', [
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
			getProjectTabColor(`desktop-local:project-${index}`, [
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
			getProjectTabColor(`desktop-local:project-${index}`, [
				...assigned,
			]),
		);
	}
	assert.equal(new Set(assigned).size, 20, 'Expected all twenty palette hues.');
	const extra = getProjectTabColor(
		'desktop-local:project-21',
		assigned,
	);
	assert.equal(
		assigned.includes(extra),
		true,
		`Expected a palette color, got ${extra}.`,
	);
});

test('assignment against colors in use is reproducible', () => {
	const used = ['#e6994d'];
	assert.equal(
		getProjectTabColor('project-a', used),
		getProjectTabColor('project-a', used),
	);
	// Two opposite colors in use leave two equally distant candidates, which is
	// the only situation where identity decides. A single color in use has one
	// unique furthest hue, so identity never comes into it.
	const tied = ['#db5757', '#57dbdb'];
	const picked = new Set(
		Array.from({ length: 50 }, (_, index) =>
			getProjectTabColor(`project-${index}`, tied),
		),
	);
	assert.equal(
		picked.size,
		2,
		`Expected identity to reach both tied candidates, got ${[...picked].join(', ')}.`,
	);
});

test('the first color in a workspace is drawn at random', () => {
	// A pinned source indexes the palette directly, so the whole wheel is
	// reachable and the caller can still fix the sequence.
	assert.equal(
		assignedHue(getProjectTabColor('project-a', [], () => 0)),
		0,
	);
	assert.notEqual(
		getProjectTabColor('project-a', [], () => 0),
		getProjectTabColor('project-a', [], () => 0.5),
	);
	// A source returning just under 1 must stay inside the palette.
	assert.notEqual(projectTabColorHue(getProjectTabColor('a', [], () => 0.999)), null);
});

test('randomness applies only to the first color', () => {
	const used = ['#db5757'];
	assert.equal(
		getProjectTabColor('project-a', used, () => 0),
		getProjectTabColor('project-a', used, () => 0.75),
		'Expected the random source to be ignored once a color is in use.',
	);
});

test('the default random source varies the first color', () => {
	const seen = new Set<string>();
	for (let attempt = 0; attempt < 200; attempt += 1)
		seen.add(getProjectTabColor('project-a'));
	assert.equal(
		seen.size > 1,
		true,
		`Expected varied first colors, always got ${[...seen].join(', ')}.`,
	);
});

test('a user-chosen color off the palette still repels the next project', () => {
	const chosen = '#ff3366';
	const next = getProjectTabColor('desktop-local:project-2', [
		chosen,
	]);
	assert.equal(
		projectTabHueDistance(assignedHue(chosen), assignedHue(next)) >= 150,
		true,
		`Expected the next color to avoid ${chosen}, got ${next}.`,
	);
});
