import assert from 'node:assert/strict';
import test from 'node:test';
import { isProjectEditCommitted } from '../src/web/projectEditSettlement.ts';

const result = {
	color: '#123456',
	defaultShellProfileId: 'profile:zsh',
	emoji: '🚀',
	rootFolder: '/workspace',
	title: ' Project ',
};

const project = {
	id: 'project:one',
	serverId: 'server:one',
	name: 'Project',
	root: '/workspace',
	rootOrigin: 'explicit',
	color: '#123456',
	icon: '🚀',
	viewId: 'view:one',
	projectEnvironmentId: 'terminay:this-server',
	environmentRevision: 1,
	panelIds: [],
	defaultShellProfileId: 'profile:zsh',
};

test('project editor waits for profile and final project mutation', () => {
	assert.equal(isProjectEditCommitted(project, result), true);
	assert.equal(
		isProjectEditCommitted({ ...project, defaultShellProfileId: undefined }, result),
		false,
	);
	assert.equal(isProjectEditCommitted({ ...project, name: 'Old' }, result), false);
});

test('server-default selection commits when the profile field is absent', () => {
	assert.equal(
		isProjectEditCommitted(
			{ ...project, defaultShellProfileId: undefined },
			{ ...result, defaultShellProfileId: null },
		),
		true,
	);
});
