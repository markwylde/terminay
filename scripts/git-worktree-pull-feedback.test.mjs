import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.git-pull-feedback-'));

async function bundleModule(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react'],
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return require(outputPath);
}

const { assertWorktreePulled } = await bundleModule(
	'src/workspace/useFileExplorerController.ts',
	'file-explorer-controller.cjs',
);
const { WorktreesPanel, buildWorktreeContextMenuItems } = await bundleModule(
	'src/components/git-panel/WorktreesPanel.tsx',
	'worktrees-panel.cjs',
);

test.after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

function makeWorktree(overrides = {}) {
	return {
		path: '/workspace/repo',
		name: 'repo',
		branch: 'main',
		head: 'a'.repeat(40),
		aheadOfMainCount: 0,
		lineAdditions: 0,
		lineDeletions: 0,
		lastChangedAt: null,
		isDirtyBranch: false,
		isCurrent: true,
		isMain: true,
		isBare: false,
		isDetached: false,
		isLocked: false,
		isPrunable: false,
		entries: [],
		...overrides,
	};
}

function makeStatus(worktrees) {
	return {
		gitAvailable: true,
		repoRoot: '/workspace/repo',
		defaultBranch: 'main',
		worktrees,
	};
}

function renderPanel(props) {
	return renderToStaticMarkup(
		React.createElement(WorktreesPanel, {
			viewMode: 'list',
			onDeleteWorktree: () => {},
			onDeletePath: () => {},
			onNewFile: () => {},
			onNewFolder: () => {},
			onOpenEntry: () => {},
			onOpenFolder: () => {},
			onOpenPushMenu: () => {},
			onOpenTerminal: () => {},
			onOpenTerminalAtPath: () => {},
			onPullFromOrigin: () => {},
			onRenameWorktree: () => {},
			onRenamePath: () => {},
			onRevealWorktree: () => {},
			onSwitchProjectRoot: () => {},
			...props,
		}),
	);
}

test('a pull the server did not apply is reported with its message', () => {
	assert.doesNotThrow(() =>
		assertWorktreePulled({ applied: true, state: 'pulled' }),
	);
	assert.throws(
		() =>
			assertWorktreePulled({
				applied: false,
				state: 'command-error',
				error: {
					message:
						'worktree branch "main" has no configured upstream and no matching remote branch',
				},
			}),
		/no matching remote branch/,
	);
	assert.throws(
		() => assertWorktreePulled({ applied: false, state: 'command-error' }),
		/did not pull/,
	);
	assert.throws(() => assertWorktreePulled(null), /did not pull/);
});

test('a worktree being pulled shows that its pull is running', () => {
	const worktree = makeWorktree();
	const idle = renderPanel({ status: makeStatus([worktree]) });
	assert.doesNotMatch(idle, /pulling…/);

	const pulling = renderPanel({
		status: makeStatus([worktree]),
		pullingWorktreePaths: new Set([worktree.path]),
	});
	assert.match(pulling, /worktrees-panel__pulling/);
	assert.match(pulling, /pulling…/);
	assert.match(pulling, /aria-busy="true"/);
});

test('a worktree that is already pulling cannot start a second pull', () => {
	const worktree = makeWorktree();
	const options = {
		onDeleteWorktree: () => {},
		onOpenTerminal: () => {},
		onPullFromOrigin: () => {},
		onRenameWorktree: () => {},
		onRevealWorktree: () => {},
		onSwitchProjectRoot: () => {},
		rootPath: '/workspace/repo',
		worktree,
	};

	const idle = buildWorktreeContextMenuItems(options).find(
		(item) => item.label === 'Pull from origin',
	);
	assert.ok(idle);
	assert.equal(idle.disabled, false);

	const pulling = buildWorktreeContextMenuItems({
		...options,
		isPulling: true,
	}).find((item) => item.label === 'Pulling from origin…');
	assert.ok(pulling);
	assert.equal(pulling.disabled, true);
});
