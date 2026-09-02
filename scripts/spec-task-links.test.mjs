import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const SPEC_DIRECTORIES = ['openspec/changes', 'openspec/specs'];
const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)]+)\)/gu;

async function markdownFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name, 'en'),
	)) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await markdownFiles(entryPath)));
		else if (entry.isFile() && entry.name.endsWith('.md')) files.push(entryPath);
	}
	return files;
}

test('OpenSpec change and capability documents contain no broken relative links', async () => {
	const broken = [];
	for (const directory of SPEC_DIRECTORIES) {
		for (const file of await markdownFiles(directory)) {
			const markdown = await readFile(file, 'utf8');
			for (const match of markdown.matchAll(MARKDOWN_LINK)) {
				const rawTarget = match[1].trim();
				if (
					rawTarget.length === 0 ||
					rawTarget.startsWith('#') ||
					/^(?:https?:|mailto:)/u.test(rawTarget)
				)
					continue;

				const relativeTarget = decodeURIComponent(rawTarget.split('#', 1)[0]);
				const absoluteTarget = path.resolve(path.dirname(file), relativeTarget);
				try {
					await access(absoluteTarget);
				} catch {
					const line = markdown.slice(0, match.index).split('\n').length;
					broken.push(`${file}:${line} -> ${rawTarget}`);
				}
			}
		}
	}

	assert.deepEqual(broken, []);
});
