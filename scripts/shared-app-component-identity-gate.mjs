import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const electronEntry = path.join(root, 'src/main.tsx');
const webEntry = path.join(root, 'src/web/main.tsx');
const canonicalApp = path.join(root, 'src/App.tsx');
const forbiddenConnectedWebModules = new Set([
	path.join(root, 'src/shared/ResponsiveWorkspaceShell.tsx'),
	path.join(root, 'src/shared/ServerWorkspaceSurface.tsx'),
]);

const electronGraph = await collectGraph(electronEntry);
const webGraph = await collectGraph(webEntry);
const errors = [];

if (!electronGraph.has(canonicalApp)) {
	errors.push(
		'Electron production entry does not resolve the canonical src/App.tsx module.',
	);
}
if (!webGraph.has(canonicalApp)) {
	errors.push(
		'Web production entry does not resolve the canonical src/App.tsx module.',
	);
}
for (const forbidden of forbiddenConnectedWebModules) {
	if (webGraph.has(forbidden)) {
		errors.push(
			`Web connected entry still resolves duplicate shell module ${path.relative(root, forbidden)}.`,
		);
	}
}

const appSource = await readFile(canonicalApp, 'utf8');
if (
	!appSource.includes(
		"export const TERMINAY_APP_COMPONENT_ID =\n\t'src/App.tsx#App/ProjectWorkspace/Dockview@1';",
	) ||
	!appSource.includes('data-terminay-app-component={TERMINAY_APP_COMPONENT_ID}')
) {
	errors.push(
		'Canonical App does not own its stable component identity attribute.',
	);
}

for (const file of webGraph) {
	if (file === canonicalApp) continue;
	const source = await readFile(file, 'utf8');
	if (source.includes('data-terminay-app-component')) {
		errors.push(
			`Non-canonical web module fabricates App component identity: ${path.relative(root, file)}.`,
		);
	}
}

const report = {
	canonicalIdentity: 'src/App.tsx#App/ProjectWorkspace/Dockview@1',
	electron: summarize(electronGraph),
	web: summarize(webGraph),
	errors,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (errors.length > 0) process.exitCode = 1;

async function collectGraph(entry) {
	const visited = new Set();
	const pending = [entry];
	while (pending.length > 0) {
		const file = pending.pop();
		if (visited.has(file)) continue;
		visited.add(file);
		const source = await readFile(file, 'utf8');
		const sourceFile = ts.createSourceFile(
			file,
			source,
			ts.ScriptTarget.Latest,
			true,
			file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		for (const specifier of importSpecifiers(sourceFile)) {
			const resolved = await resolveRelative(file, specifier);
			if (resolved !== undefined) pending.push(resolved);
		}
	}
	return visited;
}

function importSpecifiers(sourceFile) {
	const values = [];
	const visit = (node) => {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			values.push(node.moduleSpecifier.text);
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length === 1 &&
			ts.isStringLiteral(node.arguments[0])
		) {
			values.push(node.arguments[0].text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return values;
}

async function resolveRelative(importer, specifier) {
	if (!specifier.startsWith('.')) return undefined;
	const base = path.resolve(path.dirname(importer), specifier);
	const candidates = path.extname(base)
		? [base]
		: [
				`${base}.ts`,
				`${base}.tsx`,
				`${base}.js`,
				`${base}.mjs`,
				path.join(base, 'index.ts'),
				path.join(base, 'index.tsx'),
			];
	for (const candidate of candidates) {
		try {
			await readFile(candidate);
			return candidate;
		} catch {
			// Try the next TypeScript resolution candidate.
		}
	}
	return undefined;
}

function summarize(graph) {
	return [...graph]
		.map((file) => path.relative(root, file))
		.filter((file) =>
			[
				'src/App.tsx',
				'src/rendererApp.tsx',
				'src/rendererRuntime.tsx',
				'src/shared/ResponsiveWorkspaceEntry.tsx',
				'src/shared/ResponsiveWorkspaceShell.tsx',
				'src/shared/ServerWorkspaceSurface.tsx',
				'src/web/main.tsx',
			].includes(file),
		)
		.sort();
}
