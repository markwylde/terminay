import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentStatusService,
	createExtensionAgentBroker,
	TerminalActivityService,
} from '../dist/index.js';

/**
 * What a live, already-bound extension context may publish.
 *
 * An extension whose CLI changes conversation inside one process — Claude
 * Code's `/clear` rewrites its own `sessions/<pid>.json` with a new session id
 * without touching the process tree — has no foreground or topology edge to
 * re-observe on, so its only lever is a second `terminal.bindSession` on the
 * context it is already bound in. A binding-only publication naming another
 * provider session is therefore the replacement: the host retires the root on
 * screen and the next `session.started` opens the new one in the same terminal.
 */
const providerId = 'example.agent/test';
const identity = Object.freeze({
	serverId: 'server-rebind',
	projectId: 'project-rebind',
	sessionId: 'terminal-rebind',
});
const terminal = Object.freeze({
	contextId: 'context-rebind',
	serverId: identity.serverId,
	projectId: identity.projectId,
	projectEnvironmentId: 'terminay.this-server',
	terminalSessionId: identity.sessionId,
	terminalIncarnationId: '1',
	providerId,
});

function bindingFor(providerSessionId) {
	return {
		providerSessionId,
		mappingVersion: '0.1',
		fingerprint: {
			kind: 'writable-file-below-terminal-process',
			file: { id: 'file-1' },
		},
	};
}

async function boundTerminal(t) {
	const activity = new TerminalActivityService({ serverId: identity.serverId });
	activity.register(identity);
	const agents = new AgentStatusService({ activity });
	await agents.start();
	t.after(async () => {
		await agents.stop().catch(() => undefined);
	});
	agents.register(identity);
	agents.claimExtensionProvider(identity, providerId);
	const broker = createExtensionAgentBroker(agents);
	const signal = new AbortController().signal;
	const publish = (publicationId, extra) =>
		broker.publish(
			{
				extensionId: 'example.agent',
				providerId,
				terminal,
				publicationId,
				mappingVersion: '0.1',
				events: [],
				...extra,
			},
			signal,
		);
	assert.deepEqual(
		await publish('bind-first', { binding: bindingFor('root-a') }),
		{ acceptedEventCount: 0, rejectedEventCount: 0 },
	);
	assert.equal(
		(
			await publish('start-first', {
				events: [{ kind: 'session.started', title: 'A' }],
			})
		).acceptedEventCount,
		1,
	);
	return { agents, publish };
}

const rootsOf = (agents) =>
	Object.values(agents.getSnapshot().entries)
		.filter((entry) => entry.kind === 'root')
		.map((entry) => [entry.sessionId, entry.active]);

test('a binding-only publication for another provider session replaces the root in place', async (t) => {
	const { agents, publish } = await boundTerminal(t);
	assert.deepEqual(await publish('rebind', { binding: bindingFor('root-b') }), {
		acceptedEventCount: 0,
		rejectedEventCount: 0,
	});
	assert.deepEqual(
		rootsOf(agents),
		[['root-a', false]],
		'the previous root is retired by the replacement binding',
	);
	assert.equal(
		(
			await publish('start-second', {
				events: [{ kind: 'session.started', title: 'B' }],
			})
		).acceptedEventCount,
		1,
	);
	assert.deepEqual(
		rootsOf(agents),
		[
			['root-a', false],
			['root-b', true],
		],
		'the replacement session opens as a live root in the same terminal',
	);
});

test('a replacement binding carrying events is refused', async (t) => {
	const { agents, publish } = await boundTerminal(t);
	const rebind = await publish('rebind-with-events', {
		binding: bindingFor('root-b'),
		events: [{ kind: 'session.started', title: 'B' }],
	});
	assert.equal(rebind.acceptedEventCount, 0);
	assert.match(
		rebind.failure,
		/session replacement requires a separate binding publication/,
	);
	assert.deepEqual(rootsOf(agents), [['root-a', true]]);
});

test('re-publishing the same provider session from a live context is accepted', async (t) => {
	const { agents, publish } = await boundTerminal(t);
	assert.deepEqual(
		await publish('rebind-same', { binding: bindingFor('root-a') }),
		{ acceptedEventCount: 0, rejectedEventCount: 0 },
	);
	assert.deepEqual(rootsOf(agents), [['root-a', true]]);
});
