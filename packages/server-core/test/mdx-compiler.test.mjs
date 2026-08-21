import assert from 'node:assert/strict';
import test from 'node:test';
import { CanonicalProjectPathResolver, FileServiceError, MdxCompiler } from '../dist/index.js';

function compilerFixture() {
	const encoder = new TextEncoder();
	const source = new Map([
		['/project/docs/page.mdx', "import Alert from '../Components/Alert.tsx'\n\n# Hello\n\n<Alert>Safe browser bundle</Alert>"],
		['/project/Components/Alert.tsx', "import icon from './icon.png'; export default function Alert({ children }) { return <aside><img src={icon}/>{children}</aside> }"],
		['/project/Components/icon.png', new Uint8Array([137, 80, 78, 71])],
		['/project/node_modules/react/package.json', '{"main":"index.js"}'],
		['/project/node_modules/react/index.js', 'export default { createElement(type, props) { return { type, props } } }'],
		['/project/node_modules/react/jsx-runtime.js', 'export const Fragment = Symbol.for("fragment"); export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;'],
		['/project/node_modules/react-dom/client.js', 'export function createRoot() { return { render() {} } }'],
	]);
	const directories = new Set(['/project', '/project/docs', '/project/Components', '/project/node_modules', '/project/node_modules/react', '/project/node_modules/react-dom']);
	const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
	const storage = {
		realpath(path) { if (!source.has(path) && !directories.has(path)) throw missing(path); return path; },
		stat(path) { if (source.has(path)) return { isFile: true, size: encoder.encode(source.get(path)).byteLength }; if (directories.has(path)) return { isDirectory: true, size: 0 }; throw missing(path); },
		lstat(path) { if (!source.has(path) && !directories.has(path)) throw missing(path); return { isSymbolicLink: false }; },
		readDirectory() { return []; },
		readRange(path, offset, length) { const value = source.get(path); if (value === undefined) throw missing(path); return (typeof value === 'string' ? encoder.encode(value) : value).slice(offset, offset + length); },
	};
	return new MdxCompiler(new CanonicalProjectPathResolver('/project', storage), storage);
}

test('MdxCompiler bundles an MDX document and project TSX component without executing it in Node', async () => {
	const result = await compilerFixture().compile('docs/page.mdx');
	assert.ok(result.code.byteLength > 100);
	assert.ok(new TextDecoder().decode(result.code).includes('createRoot'));
	assert.ok(result.dependencies.some((path) => path.endsWith('/Components/Alert.tsx')));
	assert.deepEqual(result.resources.map((resource) => [resource.resourceId, resource.mimeType, [...resource.bytes]]), [['asset-1', 'image/png', [137, 80, 78, 71]]]);
});

test('MdxCompiler rejects traversal and Node/Electron imports before host execution', async () => {
	await assert.rejects(() => compilerFixture().compile('../outside.mdx'), (error) => error instanceof FileServiceError && error.code === 'invalid_path');
});
