import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const TASK_DIRECTORIES = ['specs/tasks', 'specs/tasks_completed'];
const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)]+)\)/gu;

test('active and completed task documents contain no broken relative links', async () => {
	const broken = [];
	for (const directory of TASK_DIRECTORIES) {
		const names = (await readdir(directory))
			.filter(name => name.endsWith('.md'))
			.sort();
		for (const name of names) {
			const file = path.join(directory, name);
			const markdown = await readFile(file, 'utf8');
			for (const match of markdown.matchAll(MARKDOWN_LINK)) {
				const rawTarget = match[1].trim();
				if (
					rawTarget.length === 0 ||
					rawTarget.startsWith('#') ||
					/^(?:https?:|mailto:)/u.test(rawTarget)
				) continue;

				const relativeTarget = decodeURIComponent(rawTarget.split('#', 1)[0]);
				const absoluteTarget = path.resolve(directory, relativeTarget);
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
