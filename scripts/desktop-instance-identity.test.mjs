import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-instance-'));
const output = join(directory, 'desktopInstanceIdentity.mjs');
const workspaceOutput = join(directory, 'workspacePersistence.mjs');
const workspaceHydrationOutput = join(directory, 'workspaceHydration.mjs');
const environmentsOutput = join(directory, 'projectEnvironmentPersistence.mjs');
const environmentRepositoryOutput = join(
	directory,
	'projectEnvironmentRepository.mjs',
);
const recordingServiceOutput = join(directory, 'recordingService.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/desktopInstanceIdentity.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
await Promise.all([
	build({
		bundle: true,
		entryPoints: ['electron/workspacePersistence.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: workspaceOutput,
		platform: 'node',
		target: 'node20',
	}),
	build({
		bundle: true,
		entryPoints: ['packages/server-core/src/workspaceHydration.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: workspaceHydrationOutput,
		platform: 'node',
		target: 'node20',
	}),
	build({
		bundle: true,
		entryPoints: ['electron/projectEnvironmentPersistence.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: environmentsOutput,
		platform: 'node',
		target: 'node20',
	}),
	build({
		bundle: true,
		entryPoints: ['packages/server-core/src/projectEnvironment/repository.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: environmentRepositoryOutput,
		platform: 'node',
		target: 'node20',
	}),
	build({
		bundle: true,
		entryPoints: ['packages/server-core/src/recordingService/service.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: recordingServiceOutput,
		platform: 'node',
		target: 'node20',
	}),
]);
const identity = await import(pathToFileURL(output).href);
const workspacePersistence = await import(pathToFileURL(workspaceOutput).href);
const workspaceHydration = await import(
	pathToFileURL(workspaceHydrationOutput).href
);
const environments = await import(pathToFileURL(environmentsOutput).href);
const environmentRepository = await import(
	pathToFileURL(environmentRepositoryOutput).href
);
const recordingService = await import(
	pathToFileURL(recordingServiceOutput).href
);
test.after(async () => rm(directory, { force: true, recursive: true }));

test('two Electron user-data roots keep identical workspace object ids in isolated authorities, routes, partitions, and stores', async () => {
	const [rootA, rootB] = await Promise.all([
		mkdtemp(join(directory, 'profile-a-')),
		mkdtemp(join(directory, 'profile-b-')),
	]);
	const first = identity.resolveDesktopInstanceIdentity(rootA);
	const second = identity.resolveDesktopInstanceIdentity(rootB);

	assert.match(first.id, /^desktop-[A-Za-z0-9_-]{32,96}$/u);
	assert.match(second.id, /^desktop-[A-Za-z0-9_-]{32,96}$/u);
	assert.notEqual(first.id, second.id);
	assert.deepEqual(
		identity.resolveDesktopInstanceIdentity(rootA),
		first,
		'a restart must retain its profile authority',
	);

	const projectId = 'project-shared';
	const sessionId = 'terminal-shared';
	const legacy = legacyWorkspace(projectId, sessionId);
	const migratedA = identity.migrateLegacyEmbeddedWorkspaceServerId(
		legacy,
		first.id,
	);
	const migratedB = identity.migrateLegacyEmbeddedWorkspaceServerId(
		legacy,
		second.id,
	);
	assert.equal(migratedA.projects[projectId].id, projectId);
	assert.equal(migratedB.projects[projectId].id, projectId);
	assert.equal(migratedA.terminalSessions[sessionId].id, sessionId);
	assert.equal(migratedB.terminalSessions[sessionId].id, sessionId);
	assert.notEqual(migratedA.serverId, migratedB.serverId);
	assert.notEqual(
		identity.localEmbeddedProfileId(first.id),
		identity.localEmbeddedProfileId(second.id),
		'Local host routes must not collide across Desktop profiles',
	);
	assert.notEqual(
		identity.desktopLocalServerUiPartitionKey(first.id),
		identity.desktopLocalServerUiPartitionKey(second.id),
		'persistent Chromium partitions must remain profile-scoped',
	);
	assert.notDeepEqual(
		identity.desktopEmbeddedStorePaths(first),
		identity.desktopEmbeddedStorePaths(second),
		'workspace, recording, bundle and environment stores must remain under their exact roots',
	);
});

test('legacy embedded workspace, environment, and recording ownership migrates once without changing project or terminal identities', async () => {
	const root = await mkdtemp(join(directory, 'legacy-profile-'));
	const instance = identity.resolveDesktopInstanceIdentity(root);
	const workspace = legacyWorkspace('project-a', 'terminal-a');
	const migratedWorkspace = identity.migrateLegacyEmbeddedWorkspaceServerId(
		workspace,
		instance.id,
	);
	assert.equal(migratedWorkspace.serverId, instance.id);
	assert.equal(migratedWorkspace.views['view-a'].serverId, instance.id);
	assert.equal(migratedWorkspace.projects['project-a'].serverId, instance.id);
	assert.equal(
		migratedWorkspace.terminalSessions['terminal-a'].serverId,
		instance.id,
	);
	assert.equal(migratedWorkspace.projects['project-a'].id, 'project-a');
	assert.equal(
		migratedWorkspace.terminalSessions['terminal-a'].id,
		'terminal-a',
	);
	assert.deepEqual(
		identity.migrateLegacyEmbeddedProjectEnvironmentServerId(
			{ cursor: '1', serverId: 'desktop-local' },
			instance.id,
		),
		{ cursor: '1', serverId: instance.id },
	);
	assert.deepEqual(
		identity.migrateLegacyEmbeddedRecordingServerId(
			{ recordingId: 'recording-a', serverId: 'desktop-local' },
			instance.id,
		),
		{ recordingId: 'recording-a', serverId: instance.id },
	);

	const foreign = { serverId: 'remote-server-a', projects: {} };
	assert.strictEqual(
		identity.migrateLegacyEmbeddedWorkspaceServerId(foreign, instance.id),
		foreign,
		'a foreign workspace authority must not be adopted by name or path',
	);
	const persisted = JSON.parse(
		await readFile(join(root, 'desktop-instance.v1.json'), 'utf8'),
	);
	assert.deepEqual(Object.keys(persisted).sort(), ['id', 'schemaVersion']);
	assert.equal(persisted.id, instance.id);
});

test('compatibility transforms are atomically persisted before their repositories load', async () => {
	const root = await mkdtemp(join(directory, 'migration-storage-'));
	const instance = identity.resolveDesktopInstanceIdentity(root);
	const paths = identity.desktopEmbeddedStorePaths(instance);
	const workspace = workspaceHydration.createFreshWorkspaceState(
		'desktop-local',
		root,
		0,
	);
	await writeFile(paths.workspace, JSON.stringify(workspace), 'utf8');
	const workspaceBackend =
		workspacePersistence.createEmbeddedWorkspaceStateBackend({
			filePath: paths.workspace,
			migrate: (state) =>
				identity.migrateLegacyEmbeddedWorkspaceServerId(state, instance.id),
		});
	assert.equal((await workspaceBackend.load()).serverId, instance.id);
	const restored = await workspaceHydration.openCanonicalWorkspace({
		backend: workspaceBackend,
		defaultProjectRoot: root,
		serverId: instance.id,
	});
	assert.equal(restored.state.serverId, instance.id);
	assert.deepEqual(
		Object.keys(restored.state.projects),
		['default'],
		'legacy migration must preserve the canonical restored project',
	);
	assert.equal(
		JSON.parse(await readFile(paths.workspace, 'utf8')).terminalSessions[
			'default'
		].serverId,
		instance.id,
	);

	await writeFile(
		paths.projectEnvironments,
		JSON.stringify({ cursor: '0', serverId: 'desktop-local' }),
		'utf8',
	);
	const environmentBackend =
		new environments.MigratingProjectEnvironmentStateBackend(
			new environmentRepository.FileProjectEnvironmentStateBackend(
				paths.projectEnvironments,
			),
			(state) =>
				identity.migrateLegacyEmbeddedProjectEnvironmentServerId(
					state,
					instance.id,
				),
		);
	assert.equal((await environmentBackend.load()).serverId, instance.id);
	assert.equal(
		JSON.parse(await readFile(paths.projectEnvironments, 'utf8')).serverId,
		instance.id,
	);
});

test('legacy recording sidecars become visible only to their migrated Desktop authority', async () => {
	const root = await mkdtemp(join(directory, 'recording-storage-'));
	const instance = identity.resolveDesktopInstanceIdentity(root);
	const paths = identity.desktopEmbeddedStorePaths(instance);
	const day = join(paths.recordings, '2026-08-24');
	await mkdir(day, { recursive: true });
	await writeFile(join(day, 'recording-a.cast'), '{"version":2}\n', 'utf8');
	await writeFile(
		join(day, 'recording-a.json'),
		JSON.stringify({
			recordingId: 'recording-a',
			recordingState: 'completed',
			relativeCastPath: '2026-08-24/recording-a.cast',
			serverId: 'desktop-local',
			startedAt: '2026-08-24T00:00:00.000Z',
		}),
		'utf8',
	);
	const service = new recordingService.RecordingService({
		homeDirectory: root,
		libraryIndexPath: paths.recordingLibrary,
		recordingRoot: paths.recordings,
		serverId: instance.id,
		migrateStoredMetadata: (metadata) =>
			identity.migrateLegacyEmbeddedRecordingServerId(metadata, instance.id),
	});
	assert.equal(service.listRecordings()[0].serverId, instance.id);
	assert.equal(
		JSON.parse(await readFile(join(day, 'recording-a.json'), 'utf8')).serverId,
		instance.id,
	);
});

function legacyWorkspace(projectId, sessionId) {
	return {
		serverId: 'desktop-local',
		views: {
			'view-a': { id: 'view-a', serverId: 'desktop-local' },
		},
		projects: {
			[projectId]: { id: projectId, serverId: 'desktop-local' },
		},
		terminalSessions: {
			[sessionId]: { id: sessionId, serverId: 'desktop-local' },
		},
	};
}
