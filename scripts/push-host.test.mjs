import assert from 'node:assert/strict';
import test from 'node:test';
import {
	bindPushHost,
	boundedNotificationCount,
	findNotificationTargetPanel,
	PUSH_OPERATIONS,
	readSessionNotificationsHost,
} from '../src/workspace/pushHost.ts';

const settle = async () => {
	for (let turn = 0; turn < 10; turn += 1)
		await new Promise((resolve) => setImmediate(resolve));
};

const enrolment = (overrides = {}) => ({
	routingId: 'routing',
	key: 'key',
	token: 'token',
	silent: true,
	...overrides,
});

function harness(options = {}) {
	const { command } = options;
	const state = {
		// `undefined` is a real value here: the manager holds no enrolment.
		current: 'current' in options ? options.current : enrolment(),
		visible: options.visible ?? true,
	};
	const commands = [];
	const enrolmentListeners = new Set();
	const visibilityListeners = new Set();
	const stop = bindPushHost({
		host: {
			getPushEnrolment: async () => state.current,
			subscribePushEnrolment: (listener) => {
				enrolmentListeners.add(listener);
				return () => enrolmentListeners.delete(listener);
			},
			setNotificationCount: () => {},
			subscribeNotificationTarget: () => () => {},
		},
		command:
			command ??
			(async (operation, payload) => {
				commands.push([operation, payload]);
			}),
		isVisible: () => state.visible,
		onVisibilityChange: (listener) => {
			visibilityListeners.add(listener);
			return () => visibilityListeners.delete(listener);
		},
	});
	return {
		state,
		commands,
		stop,
		enrolmentChanged: () => {
			for (const listener of enrolmentListeners) listener();
		},
		visibilityChanged: () => {
			for (const listener of visibilityListeners) listener();
		},
		listeners: () => enrolmentListeners.size + visibilityListeners.size,
	};
}

test('the enrolment the manager holds is sent to the server once per connection', async () => {
	const h = harness();
	await settle();
	assert.deepEqual(h.commands, [[PUSH_OPERATIONS.enrol, enrolment()]]);
});

test('only the four enrolment fields are forwarded', async () => {
	const h = harness({
		current: enrolment({ endpoint: 'https://push.example.test/abc', label: 'Mac Studio' }),
	});
	await settle();
	assert.deepEqual(Object.keys(h.commands[0][1]).sort(), ['key', 'routingId', 'silent', 'token']);
});

test('without an enrolment the server is told to hold none', async () => {
	const h = harness({ current: undefined });
	await settle();
	assert.deepEqual(h.commands, [[PUSH_OPERATIONS.withdraw, {}]]);
});

test('a manager that fails to answer is treated as having no enrolment', async () => {
	const commands = [];
	bindPushHost({
		host: {
			getPushEnrolment: async () => {
				throw new Error('the app host did not answer in time');
			},
			subscribePushEnrolment: () => () => {},
			setNotificationCount: () => {},
			subscribeNotificationTarget: () => () => {},
		},
		command: async (operation, payload) => {
			commands.push([operation, payload]);
		},
		isVisible: () => true,
		onVisibilityChange: () => () => {},
	});
	await settle();
	assert.deepEqual(commands, [[PUSH_OPERATIONS.withdraw, {}]]);
});

test('turning notifications off, then on, withdraws and enrols again', async () => {
	const h = harness();
	await settle();
	h.state.current = undefined;
	h.enrolmentChanged();
	await settle();
	h.state.current = enrolment({ token: 'new-token' });
	h.enrolmentChanged();
	await settle();
	assert.deepEqual(
		h.commands.map(([operation]) => operation),
		[PUSH_OPERATIONS.enrol, PUSH_OPERATIONS.withdraw, PUSH_OPERATIONS.enrol],
	);
	assert.equal(h.commands.at(-1)[1].token, 'new-token');
});

test('a change that arrives mid-sync is applied after it, never before', async () => {
	const order = [];
	let release;
	const first = new Promise((resolve) => {
		release = resolve;
	});
	const h = harness({
		command: async (operation) => {
			order.push(operation);
			if (order.length === 1) await first;
		},
	});
	await settle();
	// Switched off while the enrolment is still in flight.
	h.state.current = undefined;
	h.enrolmentChanged();
	await settle();
	assert.deepEqual(order, [PUSH_OPERATIONS.enrol], 'the withdrawal waits its turn');
	release();
	await settle();
	assert.deepEqual(order, [PUSH_OPERATIONS.enrol, PUSH_OPERATIONS.withdraw]);
});

test('visibility is reported when it changes', async () => {
	const h = harness();
	await settle();
	h.state.visible = false;
	h.visibilityChanged();
	h.state.visible = true;
	h.visibilityChanged();
	await settle();
	assert.deepEqual(h.commands.slice(1), [
		[PUSH_OPERATIONS.visibility, { visible: false }],
		[PUSH_OPERATIONS.visibility, { visible: true }],
	]);
});

test('a window that enrols while hidden says it is hidden', async () => {
	const h = harness({ visible: false });
	await settle();
	assert.deepEqual(h.commands, [
		[PUSH_OPERATIONS.enrol, enrolment()],
		[PUSH_OPERATIONS.visibility, { visible: false }],
	]);
});

test('a failed command is swallowed and the next change tries again', async () => {
	let attempts = 0;
	const h = harness({
		command: async () => {
			attempts += 1;
			throw new Error('connection lost');
		},
	});
	await settle();
	h.enrolmentChanged();
	await settle();
	assert.equal(attempts, 2);
});

test('ending the binding stops every report and releases its listeners', async () => {
	const h = harness();
	await settle();
	h.stop();
	assert.equal(h.listeners(), 0);
	h.visibilityChanged();
	h.enrolmentChanged();
	await settle();
	assert.equal(h.commands.length, 1);
});

test("a banner's target resolves to its terminal's panel, or to nothing", () => {
	const inventory = {
		'project-a': [
			{ kind: 'file', panelId: 'panel-file', projectId: 'project-a' },
			{ kind: 'terminal', panelId: 'panel-1', projectId: 'project-a', sessionId: 'session-1' },
			{ kind: 'terminal', panelId: 'panel-2', projectId: 'project-a', sessionId: 'session-2' },
		],
		'project-b': [
			{ kind: 'terminal', panelId: 'panel-3', projectId: 'project-b', sessionId: 'session-1' },
		],
	};
	assert.deepEqual(
		findNotificationTargetPanel(inventory, { projectId: 'project-a', sessionId: 'session-2' }),
		{ projectId: 'project-a', panelId: 'panel-2' },
	);
	// The same session id in another project is a different terminal.
	assert.deepEqual(
		findNotificationTargetPanel(inventory, { projectId: 'project-b', sessionId: 'session-1' }),
		{ projectId: 'project-b', panelId: 'panel-3' },
	);
	// A terminal that has closed, and a project this window does not show.
	assert.equal(findNotificationTargetPanel(inventory, { projectId: 'project-a', sessionId: 'gone' }), undefined);
	assert.equal(findNotificationTargetPanel(inventory, { projectId: 'elsewhere', sessionId: 'session-1' }), undefined);
});

test('the workspace wires the manager to the count, the enrolment, and the target', async () => {
	const { readFile } = await import('node:fs/promises');
	const app = await readFile('src/App.tsx', 'utf8');
	// The manager is told a count and nothing else.
	assert.match(app, /sessionNotifications\?\.setNotificationCount\(\s*boundedNotificationCount\(notificationCount\),?\s*\)/);
	// Enrolment and visibility are bound only for a server that pushes.
	assert.match(app, /!serverPushes\s*\)\s*return;\s*return bindPushHost\(/);
	// A target selects its panel the way a list row does, and only if it exists.
	const target = app.slice(app.indexOf('subscribeNotificationTarget('), app.indexOf('const dismissAllNotifications'));
	assert.match(target, /findNotificationTargetPanel\(/);
	assert.match(target, /if \(panel === undefined\) return;/);
	assert.match(target, /activatePanelInProject\(panel\.projectId, panel\.panelId\)/);
});

test('the count handed to the manager is a whole number in range', () => {
	assert.equal(boundedNotificationCount(3), 3);
	assert.equal(boundedNotificationCount(0), 0);
	assert.equal(boundedNotificationCount(-2), 0);
	assert.equal(boundedNotificationCount(2.9), 2);
	assert.equal(boundedNotificationCount(123_456), 9999);
	assert.equal(boundedNotificationCount(Number.NaN), 0);
});

test('the notifications surface is read only from a complete session host', () => {
	const complete = {
		getPushEnrolment: async () => undefined,
		subscribePushEnrolment: () => () => {},
		setNotificationCount: () => {},
		subscribeNotificationTarget: () => () => {},
	};
	assert.equal(
		readSessionNotificationsHost({
			__TERMINAY_SESSION_TRANSPORT__: { notifications: complete },
		}),
		complete,
	);
	// Desktop and a first-party tab have no manager behind them.
	assert.equal(readSessionNotificationsHost({}), undefined);
	assert.equal(
		readSessionNotificationsHost({ __TERMINAY_SESSION_TRANSPORT__: {} }),
		undefined,
	);
	const { setNotificationCount: _dropped, ...partial } = complete;
	assert.equal(
		readSessionNotificationsHost({
			__TERMINAY_SESSION_TRANSPORT__: { notifications: partial },
		}),
		undefined,
		'a partial surface is not used',
	);
});
