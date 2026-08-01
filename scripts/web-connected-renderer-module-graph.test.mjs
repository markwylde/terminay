import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const CONNECTED_WEB_ENTRY = 'src/web/ConnectedWebRendererWorkspace.tsx';
const WEB_MANAGER_ENTRY = 'src/web/main.tsx';

const RETIRED_CONNECTED_WEB_TARGETS = Object.freeze([
	'src/shared/ServerWorkspaceSurface.tsx',
	'src/shared/ResponsiveWorkspaceShell.tsx',
	'src/shared/ResponsiveWorkspaceShell.css',
]);

const WEB_ONLY_WORKSPACE_SELECTORS = Object.freeze([
	'browser-host-titlebar',
	'browser-host-workspace',
	'browser-host-sidebar',
	'browser-host-empty-workspace',
	'browser-host-empty-terminal',
]);

const IMPORT_PATTERN =
	/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu;

test('connected web mounts the real renderer and cannot reach the parallel workspace tree', async () => {
	const manager = await readFile(WEB_MANAGER_ENTRY, 'utf8');
	assert.match(
		manager,
		/import \{ ConnectedWebRendererWorkspace \} from ['"]\.\/ConnectedWebRendererWorkspace['"]/u,
	);
	assert.match(manager, /<ConnectedWebRendererWorkspace/u);
	assert.doesNotMatch(
		manager,
		/ServerWorkspaceSurface|ResponsiveWorkspaceShell|SharedProductionRoutes(?!\.css)/u,
	);

	const graph = await collectRelativeModuleGraph(CONNECTED_WEB_ENTRY);
	for (const target of RETIRED_CONNECTED_WEB_TARGETS) {
		assert.equal(
			graph.has(target),
			false,
			`connected web must not reach retired parallel workspace module ${target}`,
		);
	}
	assert.equal(graph.has('src/App.tsx'), true, 'connected web must mount the real App renderer');
	assert.equal(
		graph.has('src/shared/ConnectedRendererWorkspace.tsx'),
		true,
		'connected web must use the shared real-renderer composition seam',
	);
	assert.equal(
		graph.has('src/web/index.css'),
		false,
		'connected renderer must not import web-manager-only workspace CSS',
	);
});

test('retired parallel workspace deletion inventory stays explicit', () => {
	const inventory = RETIRED_CONNECTED_WEB_TARGETS.join('\n');
	assert.match(inventory, /ServerWorkspaceSurface/u);
	assert.match(inventory, /ResponsiveWorkspaceShell/u);
	assert.equal(RETIRED_CONNECTED_WEB_TARGETS.length, 3);
});

test('web-only workspace selectors stay outside the connected renderer graph', async () => {
	const graph = await collectRelativeModuleGraph(CONNECTED_WEB_ENTRY);
	for (const file of graph) {
		if (!file.endsWith('.css')) continue;
		const source = await readFile(file, 'utf8');
		for (const selector of WEB_ONLY_WORKSPACE_SELECTORS) {
			assert.doesNotMatch(
				source,
				new RegExp(`\\.${selector}(?:[\\s:{.#>]|$)`, 'u'),
				`${file} reintroduces web-only workspace selector .${selector}`,
			);
		}
	}
});

async function collectRelativeModuleGraph(entry) {
	const seen = new Set();
	const visit = async (file) => {
		const normalized = path.posix.normalize(file);
		if (seen.has(normalized)) return;
		seen.add(normalized);
		if (normalized.endsWith('.css')) return;
		const source = await readFile(normalized, 'utf8');
		for (const match of source.matchAll(IMPORT_PATTERN)) {
			const specifier = match[1];
			if (!specifier.startsWith('.')) continue;
			const resolved = await resolveRelativeImport(normalized, specifier);
			if (resolved !== undefined) await visit(resolved);
		}
	};
	await visit(entry);
	return seen;
}

async function resolveRelativeImport(importer, specifier) {
	const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
	const candidates = path.posix.extname(base)
		? [base]
		: [
				`${base}.ts`,
				`${base}.tsx`,
				`${base}.css`,
				path.posix.join(base, 'index.ts'),
				path.posix.join(base, 'index.tsx'),
			];
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next supported project source extension.
		}
	}
	return undefined;
}
