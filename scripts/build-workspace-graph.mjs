#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, } from 'node:path';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const workspaces = {
	'@terminay/protocol': {
		dependencies: [],
		tsconfig: 'packages/protocol/tsconfig.json',
		outputDirectory: 'packages/protocol/dist',
	},
	'@terminay/client-core': {
		dependencies: ['@terminay/protocol'],
		tsconfig: 'packages/client-core/tsconfig.json',
		outputDirectory: 'packages/client-core/dist',
	},
	'@terminay/responsive-ui': {
		dependencies: ['@terminay/client-core', '@terminay/protocol'],
		tsconfig: 'packages/responsive-ui/tsconfig.json',
		outputDirectory: 'packages/responsive-ui/dist',
	},
	'@terminay/extension-api': {
		dependencies: [],
		tsconfig: 'packages/extension-api/tsconfig.json',
		outputDirectory: 'packages/extension-api/dist',
	},
	'@terminay/ui-bundle': {
		dependencies: ['@terminay/protocol'],
		tsconfig: 'packages/ui-bundle/tsconfig.json',
		outputDirectory: 'packages/ui-bundle/dist',
	},
	'@terminay/server-core': {
		dependencies: [
			'@terminay/protocol',
			'@terminay/extension-api',
			'@terminay/ui-bundle',
		],
		tsconfig: 'packages/server-core/tsconfig.json',
		outputDirectory: 'packages/server-core/dist',
	},
	'@terminay/server': {
		dependencies: ['@terminay/server-core'],
		tsconfig: 'apps/terminay-server/tsconfig.json',
		outputDirectory: 'apps/terminay-server/dist',
	},
	'@terminay/web': {
		dependencies: [
			'@terminay/client-core',
			'@terminay/protocol',
			'@terminay/ui-bundle',
			'@terminay/responsive-ui',
			'@terminay/server-core',
		],
		tsconfig: 'apps/terminay-web/tsconfig.json',
		outputDirectory: 'apps/terminay-web/dist',
	},
};

function parseTargets(argv) {
	const targets = [];
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] !== '--target' || argv[index + 1] === undefined) {
			throw new Error(
				'usage: build-workspace-graph.mjs --target <workspace> [--target <workspace>...]',
			);
		}
		targets.push(argv[index + 1]);
		index += 1;
	}
	if (targets.length === 0) {
		throw new Error('at least one --target is required');
	}
	return targets;
}

function collectRequired(targets) {
	const required = new Set();
	const visit = (workspace) => {
		const definition = workspaces[workspace];
		if (definition === undefined)
			throw new Error(`unknown build workspace: ${workspace}`);
		if (required.has(workspace)) return;
		required.add(workspace);
		for (const dependency of definition.dependencies) visit(dependency);
	};
	for (const target of targets) visit(target);
	return required;
}

function runTypeScript(workspace) {
	const definition = workspaces[workspace];
	const tsc = join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
	const outputDirectory = join(repositoryRoot, definition.outputDirectory);
	// Incremental TypeScript trusts its build-info file even if another task has
	// removed dist/. Rebuild from source in that case so every graph target is
	// independently materialized (notably deterministic-artifact validation).
	if (!existsSync(outputDirectory)) {
		rmSync(join(repositoryRoot, dirname(definition.tsconfig), 'tsconfig.tsbuildinfo'), {
			force: true,
		});
	}
	process.stdout.write(`[build] ${workspace}\n`);
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, [tsc, '-p', definition.tsconfig], {
			cwd: repositoryRoot,
			stdio: 'inherit',
		});
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolvePromise();
			else
				reject(
					new Error(
						`TypeScript build failed for ${workspace} (${signal ?? `exit ${code}`})`,
					),
				);
		});
	});
}

const required = collectRequired(parseTargets(process.argv.slice(2)));
const completed = new Set();
while (completed.size < required.size) {
	const ready = [...required].filter(
		(workspace) =>
			!completed.has(workspace) &&
			workspaces[workspace].dependencies.every((dependency) =>
				completed.has(dependency),
			),
	);
	if (ready.length === 0) {
		throw new Error('workspace build graph contains a cycle');
	}
	await Promise.all(ready.map(runTypeScript));
	for (const workspace of ready) completed.add(workspace);
}
