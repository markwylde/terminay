import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(
	fileURLToPath(new URL('../../../tests/fixtures/documentation-project', import.meta.url)),
);

test('fixture project has nested Markdown, YAML titles, MDX import, asset, form, and ignored dir', async () => {
	const readme = await readFile(path.join(root, 'README.md'), 'utf8');
	const guide = await readFile(path.join(root, 'docs/guide.mdx'), 'utf8');
	const nested = await readFile(path.join(root, 'docs/nested/deep.md'), 'utf8');
	const callout = await readFile(path.join(root, 'components/Callout.tsx'), 'utf8');
	const logo = await readFile(path.join(root, 'assets/logo.svg'), 'utf8');
	const ignored = await readFile(path.join(root, 'node_modules/ignored.md'), 'utf8');
	assert.match(readme, /title: Documentation Fixture/);
	assert.match(guide, /title: Getting Started/);
	assert.match(guide, /import \{ Callout \}/);
	assert.match(guide, /<form /);
	assert.match(guide, /fetch\('https:\/\/example.test\/status'\)/);
	assert.match(nested, /title: Nested Notes/);
	assert.match(callout, /export function Callout/);
	assert.match(logo, /svg/);
	assert.match(ignored, /must not appear/);
});
