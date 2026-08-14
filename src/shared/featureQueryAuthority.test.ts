import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ClientError } from '@terminay/client-core';
import { describeFeatureFailure, resolveProjectFeatureAuthority } from './featureQueryAuthority';

function context(projects: Record<string, unknown>) {
	const client = {};
	return {
		applicationClient: client,
		agentStatusClient: client,
		client,
		clientId: 'client-1',
		fileObservationClient: client,
		fileViewerClient: client,
		gitClient: client,
		recordingsClient: client,
		serverId: 'server-1',
		workspaceSnapshotStore: {
			snapshot: { projects },
		},
	} as never;
}

const project = {
	id: 'project-1',
	serverId: 'server-1',
	root: '/workspace/one',
	projectEnvironmentId: 'environment-1',
	environmentRevision: 7,
};

describe('project feature authority', () => {
	it('binds every feature client to identity from the hydrated snapshot', () => {
		const result = resolveProjectFeatureAuthority(context({ 'project-1': project }), 'project-1');
		assert.equal(result.state, 'available');
		if (result.state !== 'available') return;
		assert.deepEqual(result.authority.scope, {
			serverId: 'server-1',
			projectId: 'project-1',
			projectEnvironmentId: 'environment-1',
			environmentRevision: 7,
			projectRoot: '/workspace/one',
		});
	});

	it('does not change an existing project authority when another project is created', () => {
		const before = resolveProjectFeatureAuthority(context({ 'project-1': project }), 'project-1');
		const after = resolveProjectFeatureAuthority(context({
			'project-1': project,
			'project-2': { ...project, id: 'project-2', root: '/workspace/two' },
		}), 'project-1');
		assert.equal(before.state, 'available');
		assert.equal(after.state, 'available');
		if (before.state === 'available' && after.state === 'available') {
			assert.deepEqual(after.authority.scope, before.authority.scope);
		}
	});

	it('returns a typed unavailable state instead of inventing project scope', () => {
		assert.deepEqual(resolveProjectFeatureAuthority(context({}), 'missing'), {
			state: 'unavailable',
			reason: 'The selected project is not available on this server.',
		});
	});
});

describe('feature failures', () => {
	it('keeps operation and scope when the server returns a generic message', () => {
		const error = Object.assign(new ClientError('internal', 'query failed'), {
			operation: 'files.list',
		});
		assert.deepEqual(describeFeatureFailure('Explorer', error, {
			serverId: 'server-1', projectId: 'project-1',
		}), {
			title: 'Explorer could not be loaded',
			detail: 'files.list failed for project project-1 on server server-1: query failed',
			retryable: false,
			operation: 'files.list',
		});
	});
});
