import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
	CanonicalProjectPathResolver,
	FileServiceError,
	MDX_COMPILER_LIMITS,
	MdxCompiler,
} from '../dist/index.js';

const encoder = new TextEncoder();

function compilerFixture(extra = {}, options = {}) {
	const source = new Map([
		['/project/docs/page.mdx', "import Alert from '../Components/Alert.tsx'\nimport note from './note.md'\nimport util from '../lib/util.ts'\nimport view from '../lib/view.jsx'\nimport helper from '../lib/helper.js'\nimport data from '../data/info.json'\nimport '../styles/page.css'\nimport icon from '../Components/icon.png'\n\n# Hello\n\n<Alert>Safe browser bundle</Alert>"],
		['/project/docs/note.md', '# Note'],
		['/project/Components/Alert.tsx', "import icon from './icon.png'; export default function Alert({ children }) { return <aside><img src={icon}/>{children}</aside> }"],
		['/project/Components/icon.png', new Uint8Array([137, 80, 78, 71])],
		['/project/lib/util.ts', 'export default function util(): string { return "ok" }'],
		['/project/lib/view.jsx', 'export default function View() { return <span>view</span> }'],
		['/project/lib/helper.js', 'export default function helper() { return 1 }'],
		['/project/data/info.json', '{"ok":true}'],
		['/project/styles/page.css', 'aside { color: blue }'],
		['/project/node_modules/react/package.json', '{"main":"index.js"}'],
		['/project/node_modules/react/index.js', 'export default { createElement(type, props) { return { type, props } } }'],
		['/project/node_modules/react/jsx-runtime.js', 'export const Fragment = Symbol.for("fragment"); export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;'],
		['/project/node_modules/react-dom/client.js', 'export function createRoot() { return { render() {} } }'],
		['/project/vite.config.js', 'throw new Error("project build config must not load")'],
		...Object.entries(extra),
	]);
	const directories = new Set([
		'/project',
		'/project/docs',
		'/project/Components',
		'/project/lib',
		'/project/data',
		'/project/styles',
		'/project/node_modules',
		'/project/node_modules/react',
		'/project/node_modules/react-dom',
	]);
	const links = new Map(Object.entries(options.links ?? {}));
	const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
	const reads = [];
	const storage = {
		realpath(path) {
			if (links.has(path)) return links.get(path);
			if (!source.has(path) && !directories.has(path)) throw missing(path);
			return path;
		},
		stat(path) {
			if (source.has(path)) {
				const value = source.get(path);
				return { isFile: true, size: typeof value === 'string' ? encoder.encode(value).byteLength : value.byteLength };
			}
			if (directories.has(path)) return { isDirectory: true, size: 0 };
			throw missing(path);
		},
		lstat(path) {
			if (links.has(path)) return { isSymbolicLink: true };
			if (!source.has(path) && !directories.has(path)) throw missing(path);
			return { isSymbolicLink: false };
		},
		readDirectory() { return []; },
		async readRange(path, offset, length, signal) {
			reads.push(path);
			if (signal?.aborted) throw signal.reason;
			if (options.hang === path) {
				const { promise, reject } = Promise.withResolvers();
				signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				return promise;
			}
			const value = source.get(path);
			if (value === undefined) throw missing(path);
			return (typeof value === 'string' ? encoder.encode(value) : value).slice(offset, offset + length);
		},
	};
	return {
		compiler: new MdxCompiler(new CanonicalProjectPathResolver('/project', storage), storage),
		reads,
		storage,
		source,
	};
}

test('1.1 compiler uses esbuild and MDX without loading project build configuration', async () => {
	const { compiler, reads } = compilerFixture();
	await compiler.compile('docs/page.mdx');
	assert.equal(reads.some((path) => path.endsWith('vite.config.js')), false);
	assert.equal(MDX_COMPILER_LIMITS.maxSourceBytes > 0, true);
	assert.equal(MDX_COMPILER_LIMITS.maxOutputBytes > 0, true);
	assert.equal(MDX_COMPILER_LIMITS.maxDependencies > 0, true);
	assert.equal(MDX_COMPILER_LIMITS.maxDepth > 0, true);
	assert.equal(MDX_COMPILER_LIMITS.timeoutMs > 0, true);
	assert.equal(MDX_COMPILER_LIMITS.maxConcurrent > 0, true);
});

test('1.2 compiler accepts an entry path through a fake resolver and storage', async () => {
	const result = await compilerFixture().compiler.compile('docs/page.mdx');
	assert.equal(result.entryPath, 'docs/page.mdx');
	assert.ok(result.code.byteLength > 100);
});

test('1.3 resolves relative mdx md tsx ts jsx js json css and package imports', async () => {
	const result = await compilerFixture().compiler.compile('docs/page.mdx');
	const decoded = new TextDecoder().decode(result.code);
	assert.ok(result.dependencies.some((path) => path.endsWith('/Components/Alert.tsx')));
	assert.ok(result.dependencies.some((path) => path.endsWith('/docs/note.md')));
	assert.ok(result.dependencies.some((path) => path.endsWith('/lib/util.ts')));
	assert.ok(result.dependencies.some((path) => path.endsWith('/lib/view.jsx')));
	assert.ok(result.dependencies.some((path) => path.endsWith('/lib/helper.js')));
	assert.ok(result.dependencies.some((path) => path.endsWith('/data/info.json')));
	assert.ok(result.dependencies.some((path) => path.endsWith('/styles/page.css')));
	assert.ok(result.dependencies.some((path) => path.includes('/node_modules/react/')));
	assert.ok(decoded.includes('color: blue') || decoded.includes('aside'));
	assert.deepEqual(result.resources.map((resource) => resource.mimeType), ['image/png']);
});

test('1.4 rejects Node built-ins', async () => {
	await assert.rejects(
		() => compilerFixture({ '/project/docs/bad.mdx': "import fs from 'fs'\n\n# x" }).compiler.compile('docs/bad.mdx'),
		(error) => error instanceof FileServiceError && error.code === 'path_escape',
	);
});

test('1.4 rejects Electron imports', async () => {
	await assert.rejects(
		() => compilerFixture({ '/project/docs/bad.mdx': "import 'electron'\n\n# x" }).compiler.compile('docs/bad.mdx'),
		(error) => error instanceof FileServiceError && error.code === 'path_escape',
	);
});

test('1.4 rejects absolute paths', async () => {
	await assert.rejects(
		() => compilerFixture().compiler.compile('/etc/passwd'),
		(error) => error instanceof FileServiceError && error.code === 'invalid_path',
	);
	await assert.rejects(
		() => compilerFixture({ '/project/docs/bad.mdx': "import '/tmp/secret.js'\n\n# x" }).compiler.compile('docs/bad.mdx'),
		(error) => error instanceof FileServiceError && (error.code === 'path_escape' || error.code === 'invalid_path'),
	);
});

test('1.4 rejects escaped symlinks', async () => {
	await assert.rejects(
		() => compilerFixture(
			{
				'/project/docs/bad.mdx': "import Secret from './alias.tsx'\n\n# x",
				'/outside/secret.tsx': 'export default 1',
			},
			{ links: { '/project/docs/alias.tsx': '/outside/secret.tsx' }, extraDirectories: ['/outside'] },
		).compiler.compile('docs/bad.mdx'),
		(error) => error instanceof FileServiceError && (error.code === 'path_escape' || error.code === 'path_missing'),
	);
});

test('1.4 rejects dependencies outside the canonical project root', async () => {
	await assert.rejects(
		() => compilerFixture({ '/project/docs/bad.mdx': "import Secret from '../../../outside'\n\n# x" }).compiler.compile('docs/bad.mdx'),
		(error) => error instanceof FileServiceError && error.code === 'path_escape',
	);
});

test('1.4 rejects unsupported dynamic imports', async () => {
	await assert.rejects(
		() => compilerFixture({ '/project/docs/bad.mdx': "export const load = () => import('./note.md')\n\n# x" }).compiler.compile('docs/bad.mdx'),
		(error) => error instanceof FileServiceError && error.code === 'invalid_path' && /dynamic import/u.test(error.message),
	);
});

test('1.4 rejects missing files', async () => {
	await assert.rejects(
		() => compilerFixture({ '/project/docs/bad.mdx': "import Missing from './missing.tsx'\n\n# x" }).compiler.compile('docs/bad.mdx'),
		(error) => error instanceof FileServiceError && error.code === 'path_missing',
	);
});

test('1.5 enforces source byte and dependency bounds and checks cancellation around reads', async () => {
	const huge = `#\n${'x'.repeat(MDX_COMPILER_LIMITS.maxSourceBytes + 8)}`;
	await assert.rejects(
		() => compilerFixture({ '/project/docs/huge.mdx': huge }).compiler.compile('docs/huge.mdx'),
		(error) => error instanceof FileServiceError && /source exceeds/u.test(error.message),
	);
	const many = Array.from({ length: MDX_COMPILER_LIMITS.maxDependencies + 1 }, (_, index) => [
		`/project/lib/f${index}.js`,
		'export default 1',
	]);
	const imports = many.map(([path]) => `import '${path.replace('/project/lib/', './')}'`).join('\n');
	await assert.rejects(
		() => compilerFixture({
			'/project/docs/many.mdx': `${imports.replaceAll('./f', '../lib/f')}\n\n# x`,
			...Object.fromEntries(many),
		}).compiler.compile('docs/many.mdx'),
		(error) => error instanceof FileServiceError && /dependency limit/u.test(error.message),
	);
	const depthSource = { '/project/docs/deep.mdx': "import './d1.js'\n\n# x" };
	let previous = '/project/docs/d1.js';
	for (let index = 1; index <= MDX_COMPILER_LIMITS.maxDepth + 1; index += 1) {
		const next = `/project/docs/d${index + 1}.js`;
		depthSource[previous] = `import './d${index + 1}.js'\nexport default ${index}`;
		previous = next;
	}
	depthSource[previous] = 'export default 0';
	await assert.rejects(
		() => compilerFixture(depthSource).compiler.compile('docs/deep.mdx'),
		(error) => error instanceof FileServiceError && /depth limit/u.test(error.message),
	);
	const hanging = compilerFixture({ '/project/docs/slow.mdx': '# Slow' }, { hang: '/project/docs/slow.mdx' });
	const controller = new AbortController();
	const pending = hanging.compiler.compile('docs/slow.mdx', controller.signal);
	controller.abort();
	await assert.rejects(pending);
});

test('1.5 concurrent compilations wait for a named slot and honour cancellation', async () => {
	const first = compilerFixture({ '/project/docs/slow.mdx': '# Slow' }, { hang: '/project/docs/slow.mdx' });
	const second = compilerFixture({ '/project/docs/slow.mdx': '# Slow' }, { hang: '/project/docs/slow.mdx' });
	const third = compilerFixture();
	const a = new AbortController();
	const b = new AbortController();
	const held = [
		first.compiler.compile('docs/slow.mdx', a.signal),
		second.compiler.compile('docs/slow.mdx', b.signal),
	];
	await Promise.resolve();
	const waiting = new AbortController();
	const blocked = third.compiler.compile('docs/page.mdx', waiting.signal);
	await Promise.resolve();
	assert.equal(third.reads.length, 0);
	waiting.abort();
	await assert.rejects(blocked);
	a.abort();
	b.abort();
	await Promise.allSettled(held);
});


test('1.6 executes the compiled MDX bundle only in a JavaScript harness', async () => {
	const result = await compilerFixture().compiler.compile('docs/page.mdx');
	const sandbox = vm.createContext({
		document: { getElementById() { return { id: 'root' }; }, createElement() { return {}; }, head: { append() {} } },
		process: undefined,
		require: undefined,
		module: undefined,
	});
	vm.runInContext(new TextDecoder().decode(result.code), sandbox, { timeout: 1000 });
	assert.equal(sandbox.process, undefined);
	assert.equal(sandbox.require, undefined);
});
