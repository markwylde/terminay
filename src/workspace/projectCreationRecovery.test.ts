import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createProjectAcrossReconnects,
	isConnectionLoss,
	PROJECT_CREATION_MAX_INTERRUPTIONS,
	PROJECT_CREATION_UNCONFIRMED_MESSAGE,
	resolveInterruptedCreation,
} from './projectCreationRecovery.ts';

function outcomeUnknown(): Error {
	const error = new Error(
		'command outcome is unknown: session-095e22ef-r-cmd-b5da3ced',
	);
	error.name = 'CommandOutcomeUnknownError';
	return error;
}

/** A server that holds projects and can drop the connection mid-command. */
function createServer() {
	const projects = new Map<string, { terminalSessionId?: string }>();
	const calls: string[] = [];
	const faults: Array<'before-commit' | 'after-commit'> = [];
	return {
		projects,
		calls,
		/** The next commands lose their connection at these points, in order. */
		interrupt(...points: Array<'before-commit' | 'after-commit'>) {
			faults.push(...points);
		},
		async create(projectId: string) {
			calls.push('create');
			const fault = faults.shift();
			if (fault === 'before-commit') throw outcomeUnknown();
			if (projects.has(projectId)) throw new Error('project already exists');
			projects.set(projectId, {});
			if (fault === 'after-commit') throw outcomeUnknown();
		},
		async launchTerminal(projectId: string) {
			calls.push('launch');
			const fault = faults.shift();
			if (fault === 'before-commit') throw outcomeUnknown();
			const sessionId = `session-${calls.length}`;
			projects.set(projectId, { terminalSessionId: sessionId });
			if (fault === 'after-commit') throw outcomeUnknown();
			return sessionId;
		},
		resynchronise(projectId: string) {
			calls.push('resync');
			const project = projects.get(projectId);
			return Promise.resolve({
				exists: project !== undefined,
				...(project?.terminalSessionId === undefined
					? {}
					: { terminalSessionId: project.terminalSessionId }),
			});
		},
	};
}

function stepsFor(server: ReturnType<typeof createServer>, projectId = 'p1') {
	return {
		create: () => server.create(projectId),
		launchTerminal: () => server.launchTerminal(projectId),
		resynchronise: () => server.resynchronise(projectId),
	};
}

test('a lost connection is told apart from a refusal', () => {
	assert.equal(isConnectionLoss(outcomeUnknown()), true);
	assert.equal(
		isConnectionLoss(Object.assign(new Error('gone'), { code: 'disconnected' })),
		true,
	);
	assert.equal(
		isConnectionLoss(new Error('wrapped by a feature client', { cause: outcomeUnknown() })),
		true,
	);
	assert.equal(isConnectionLoss(new Error('root is not a directory')), false);
	assert.equal(isConnectionLoss('nope'), false);
});

test('the resolver continues, resends, or fails from the resynchronised state', () => {
	assert.deepEqual(
		resolveInterruptedCreation({ interruptions: 1, reachable: true, done: true }),
		{ kind: 'continue' },
		'the server has it: committed',
	);
	assert.deepEqual(
		resolveInterruptedCreation({ interruptions: 1, reachable: true, done: false }),
		{ kind: 'resend' },
		'the server does not have it: not committed',
	);
	assert.deepEqual(
		resolveInterruptedCreation({
			interruptions: PROJECT_CREATION_MAX_INTERRUPTIONS,
			reachable: true,
			done: false,
		}),
		{ kind: 'fail', message: PROJECT_CREATION_UNCONFIRMED_MESSAGE },
		'attempts exhausted',
	);
	assert.deepEqual(
		resolveInterruptedCreation({ interruptions: 1, reachable: false, done: false }),
		{ kind: 'fail', message: PROJECT_CREATION_UNCONFIRMED_MESSAGE },
		'the connection is not coming back',
	);
});

test('the message shown when recovery gives up names no command or session', () => {
	assert.doesNotMatch(PROJECT_CREATION_UNCONFIRMED_MESSAGE, /session-|cmd-|command outcome/u);
});

test('an uninterrupted creation sends each step once', async () => {
	const server = createServer();
	const sessionId = await createProjectAcrossReconnects(stepsFor(server));
	assert.deepEqual(server.calls, ['create', 'launch']);
	assert.equal(server.projects.get('p1')?.terminalSessionId, sessionId);
});

test('a creation lost before the server applied it is sent again, yielding one project', async () => {
	const server = createServer();
	server.interrupt('before-commit');
	await createProjectAcrossReconnects(stepsFor(server));
	assert.deepEqual(server.calls, ['create', 'resync', 'create', 'launch']);
	assert.equal(server.projects.size, 1);
});

test('a creation lost after the server applied it is not sent again', async () => {
	const server = createServer();
	server.interrupt('after-commit');
	let created = 0;
	await createProjectAcrossReconnects({
		...stepsFor(server),
		onProjectCreated: () => {
			created += 1;
		},
	});
	assert.deepEqual(server.calls, ['create', 'resync', 'launch']);
	assert.equal(server.projects.size, 1);
	assert.equal(created, 1);
});

test('a terminal launch lost after the server applied it adopts that terminal', async () => {
	const server = createServer();
	const steps = stepsFor(server);
	let launches = 0;
	const sessionId = await createProjectAcrossReconnects({
		...steps,
		launchTerminal: () => {
			launches += 1;
			if (launches === 1) server.interrupt('after-commit');
			return steps.launchTerminal();
		},
	});
	assert.deepEqual(server.calls, ['create', 'launch', 'resync']);
	assert.equal(server.projects.get('p1')?.terminalSessionId, sessionId);
});

test('a terminal launch lost before the server applied it is launched again', async () => {
	const server = createServer();
	const steps = stepsFor(server);
	let launches = 0;
	await createProjectAcrossReconnects({
		...steps,
		launchTerminal: () => {
			launches += 1;
			if (launches === 1) server.interrupt('before-commit');
			return steps.launchTerminal();
		},
	});
	assert.deepEqual(server.calls, ['create', 'launch', 'resync', 'launch']);
});

test('a refusal from the server fails with the server’s own error', async () => {
	const server = createServer();
	await assert.rejects(
		createProjectAcrossReconnects({
			...stepsFor(server),
			create: () => Promise.reject(new Error('root is not a directory')),
		}),
		/root is not a directory/u,
	);
	assert.deepEqual(server.calls, [], 'nothing is resynchronised or resent');
});

test('a resend refused as a duplicate, because the first send landed late, still succeeds', async () => {
	const server = createServer();
	const steps = stepsFor(server);
	let sends = 0;
	await createProjectAcrossReconnects({
		...steps,
		create: async () => {
			sends += 1;
			if (sends === 1) throw outcomeUnknown();
			// The interrupted send commits after the snapshot was read.
			server.projects.set('p1', {});
			await steps.create();
		},
	});
	assert.equal(server.projects.size, 1);
});

test('a creation interrupted too many times fails with the plain message', async () => {
	const server = createServer();
	server.interrupt('before-commit', 'before-commit', 'before-commit');
	await assert.rejects(
		createProjectAcrossReconnects(stepsFor(server)),
		(error: Error) => error.message === PROJECT_CREATION_UNCONFIRMED_MESSAGE,
	);
	assert.equal(server.projects.size, 0);
});

test('a connection that is not coming back fails with the plain message', async () => {
	const server = createServer();
	server.interrupt('before-commit');
	await assert.rejects(
		createProjectAcrossReconnects({
			...stepsFor(server),
			resynchronise: () => Promise.resolve(null),
		}),
		(error: Error) => error.message === PROJECT_CREATION_UNCONFIRMED_MESSAGE,
	);
});
