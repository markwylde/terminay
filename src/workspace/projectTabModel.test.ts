import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTerminalSettings } from '../terminalSettings.ts';
import {
	isProjectSidebarOpenOnDevice,
	projectSidebarPatch,
	projectSidebarVisibilityKey,
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
