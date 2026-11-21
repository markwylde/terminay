import assert from 'node:assert/strict';
import test from 'node:test';
import { applyViewRequest } from './useWorkspaceViewController.ts';

function fakeWindow(options: { activates?: boolean } = {}) {
	const panel = { id: 'panel', params: { sessionId: 's' } };
	const api = {
		activePanel: undefined as typeof panel | undefined,
		panels: [panel],
		getPanel: (id: string) => (id === panel.id ? panel : undefined),
		toJSON: () => ({
			grid: { root: { type: 'branch', data: [] } },
			panels: {},
		}),
	};
	const workspace = {
		viewApi: () => api,
		activateTerminal: () => {
			if (options.activates !== false) api.activePanel = panel;
		},
		activatePanel: () => {},
	};
	const held = new Set<string>();
	let shown: string | undefined;
	const window = {
		projectIds: () => [...held],
		folderIds: () => ['folder'],
		workspace: () => workspace,
		showProject: (id: string) => {
			shown = id;
		},
		shownProjectId: () => shown,
		selectFolder: () => {},
		selectedFolderId: () => 'folder',
		targetProjectId: () => shown,
	};
	return { window, held, shown: () => shown };
}

const focus = {
	op: 'focus',
	params: { projectId: 'late', tab: { sessionId: 's' } },
};

test('a focus request waits for a project still on its way to the window', async () => {
	const fake = fakeWindow();
	setTimeout(() => fake.held.add('late'), 40);
	// biome-ignore lint/suspicious/noExplicitAny: a structural test double.
	await applyViewRequest(fake.window as any, focus as any);
	assert.equal(fake.shown(), 'late');
});

test('a project that never arrives is refused and the view does not move', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	const fake = fakeWindow();
	// biome-ignore lint/suspicious/noExplicitAny: a structural test double.
	const result = applyViewRequest(fake.window as any, focus as any);
	const refused = assert.rejects(
		result,
		(error: { code?: string }) => error.code === 'unavailable',
	);
	for (let elapsed = 0; elapsed <= 5_100; elapsed += 16) {
		t.mock.timers.tick(16);
		await Promise.resolve();
	}
	await refused;
	assert.equal(fake.shown(), undefined);
});

test('every wait of one operation shares the 9-second deadline', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	const fake = fakeWindow({ activates: false });
	let settledAt: number | undefined;
	const start = Date.now();
	// biome-ignore lint/suspicious/noExplicitAny: a structural test double.
	const result = applyViewRequest(fake.window as any, focus as any).catch(
		(error) => {
			settledAt = Date.now() - start;
			return error;
		},
	);
	for (
		let elapsed = 0;
		elapsed <= 10_000 && settledAt === undefined;
		elapsed += 16
	) {
		if (elapsed >= 4_900) fake.held.add('late');
		t.mock.timers.tick(16);
		await new Promise((resolve) => setImmediate(resolve));
	}
	const error = (await result) as { code?: string };
	assert.equal(error.code, 'unavailable');
	assert.ok(
		settledAt !== undefined && settledAt <= 9_016,
		`settled at ${settledAt}`,
	);
});
