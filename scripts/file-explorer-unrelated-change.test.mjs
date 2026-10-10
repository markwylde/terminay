import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// A folder's explorer is reloaded when its root, its project, or its clients
// change, when a watch reports a change, or when a person asks. Nothing else
// about the workspace changing may list the tree, open a watch, re-make the
// Git subscription, or ask the server to measure Git (ADR-0059).

const HARNESS = `
	import React, { useState } from 'react';
	import { createRoot } from 'react-dom/client';
	import { useFileExplorerController } from './src/workspace/useFileExplorerController.ts';

	const calls = { listFolder: 0, startWatch: 0, stopWatch: 0, subscribeWatch: 0, subscribeStatusChanges: 0, unsubscribeStatusChanges: 0, gitList: 0, freshGitList: 0 };
	window.calls = calls;
	const clients = {
		fileViewerClient: {
			async listFolder() { calls.listFolder += 1; return { entries: [] }; },
		},
		fileObservationClient: {
			async startWatch(projectId, path) { calls.startWatch += 1; return { subscriptionId: 'watch-' + calls.startWatch, projectId, path }; },
			async stopWatch() { calls.stopWatch += 1; },
			async subscribeWatch() { calls.subscribeWatch += 1; return () => {}; },
		},
		gitClient: {
			async list(request) {
				calls.gitList += 1;
				if (request.fresh === true) calls.freshGitList += 1;
				return { repositoryRoot: null, state: 'not-a-repository', worktrees: [] };
			},
			async subscribeStatusChanges() {
				calls.subscribeStatusChanges += 1;
				return () => { calls.unsubscribeStatusChanges += 1; };
			},
		},
	};

	function Explorer({ project }) {
		// A parent that re-creates everything it can on every render: new
		// callbacks, and a new project object for the same project.
		useFileExplorerController({
			...clients,
			isServerFileViewer: true,
			onOpenFile: () => {},
			onOperationError: () => '',
			onOperationSucceeded: () => {},
			onSetError: () => {},
			project: { ...project },
		});
		return null;
	}

	function Harness() {
		const [state, setState] = useState({ render: 0, rootFolder: '/workspace/a', title: 'A', panelIds: ['panel-1'] });
		window.rerender = (patch = {}) => setState((current) => ({ ...current, ...patch, render: current.render + 1 }));
		window.renders = state.render;
		return <Explorer project={{ id: 'project-a', serverId: 'server-a', rootFolder: state.rootFolder, title: state.title, panelIds: state.panelIds, isFileExplorerOpen: true, creationStatus: 'ready' }} />;
	}

	createRoot(document.getElementById('root')).render(<Harness />);
`;

async function harness(run) {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-explorer-unrelated-'));
	const bundle = join(directory, 'harness.js');
	await build({
		stdin: { contents: HARNESS, loader: 'tsx', resolveDir: process.cwd() },
		bundle: true,
		format: 'iife',
		jsx: 'automatic',
		loader: { '.css': 'text' },
		define: { 'process.env.NODE_ENV': '"production"' },
		outfile: bundle,
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.setContent('<div id="root"></div>');
		await page.addScriptTag({ path: bundle });
		const calls = () => page.evaluate(() => ({ ...window.calls }));
		/** Wait until the counters have stopped moving. */
		const settled = async () => {
			let previous = '';
			for (let attempt = 0; attempt < 40; attempt += 1) {
				await page.waitForTimeout(50);
				const current = JSON.stringify(await calls());
				if (current === previous) return JSON.parse(current);
				previous = current;
			}
			throw new Error(`the explorer never settled: ${previous}`);
		};
		const rerender = async (patch) => {
			const before = await page.evaluate(() => window.renders);
			await page.evaluate((value) => window.rerender(value), patch);
			await page.waitForFunction((value) => window.renders > value, before);
		};
		await run({ calls, settled, rerender });
		assert.deepEqual(errors, []);
	} finally {
		await browser.close();
		await rm(directory, { recursive: true, force: true });
	}
}

test('the explorer loads its root once', async () => {
	await harness(async ({ settled }) => {
		const loaded = await settled();
		assert.equal(loaded.freshGitList, 1, 'Git is measured once for the root');
		assert.equal(loaded.subscribeStatusChanges, 1);
		assert.equal(loaded.startWatch, 1, 'the root directory is watched');
		assert.ok(loaded.listFolder >= 1);
	});
});

test('new callbacks and an unrelated change to the same project disturb nothing', async () => {
	await harness(async ({ settled, rerender }) => {
		const loaded = await settled();
		// What a workspace change to another terminal, or to this project's own
		// panels or name, looks like from here: the same root, project, and
		// clients, with everything else new.
		for (let change = 0; change < 12; change += 1)
			await rerender({ title: `A ${change}`, panelIds: [`panel-${change}`] });
		assert.deepEqual(await settled(), loaded);
	});
});

test('a new root is listed, watched, subscribed, and measured again', async () => {
	await harness(async ({ settled, rerender }) => {
		const loaded = await settled();
		await rerender({ rootFolder: '/workspace/b' });
		const moved = await settled();
		assert.equal(moved.freshGitList, loaded.freshGitList + 1);
		assert.equal(moved.subscribeStatusChanges, loaded.subscribeStatusChanges + 1);
		assert.equal(moved.unsubscribeStatusChanges, loaded.unsubscribeStatusChanges + 1);
		assert.ok(moved.listFolder > loaded.listFolder);
		assert.ok(moved.startWatch > loaded.startWatch);
		// And the new root is then as quiet as the old one was.
		await rerender({ title: 'renamed' });
		assert.deepEqual(await settled(), moved);
	});
});
