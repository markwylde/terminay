import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	collectSpecStats,
	generateProgressSvg,
	parseChecklist,
	writeProgressArtifacts,
} from './generate-spec-progress.mjs';

function fixture(task = '- [ ] one\n') {
	const root = mkdtempSync(join(tmpdir(), 'terminay-spec-progress-'));
	for (const directory of ['tasks', 'tasks_completed', 'features'])
		mkdirSync(join(root, 'specs', directory), { recursive: true });
	writeFileSync(join(root, 'specs', 'tasks', 'active.md'), task);
	writeFileSync(join(root, 'specs', 'features', 'one.md'), '# One\n');
	writeFileSync(
		join(root, 'README.md'),
		'[![Specification progress](docs/spec-progress.svg)](specs/README.md)\n',
	);
	return root;
}

test('parseChecklist counts tasks and ignores fenced examples', () => {
	assert.deepEqual(
		parseChecklist(
			'- [ ] open\n- [x] done\n```md\n- [ ] example\n```\n1. [X] ordered\n',
		),
		{ checked: 2, remaining: 1 },
	);
});

test('collectSpecStats combines active and archived task plans', () => {
	const root = fixture('- [ ] one\n- [x] two\n');
	writeFileSync(
		join(root, 'specs', 'tasks_completed', 'done.md'),
		'- [x] three\n',
	);
	writeFileSync(join(root, 'specs', 'tasks', 'AGENTS.md'), '- [ ] ignored\n');
	assert.deepEqual(collectSpecStats(root), {
		checked: 2,
		remaining: 1,
		total: 3,
		percentage: 67,
		activePlans: 1,
		archivedPlans: 1,
		featureSpecs: 1,
	});
});

test('generateProgressSvg is accessible and self-contained', () => {
	const svg = generateProgressSvg({
		checked: 3,
		remaining: 9,
		total: 12,
		percentage: 25,
		activePlans: 2,
		archivedPlans: 4,
		featureSpecs: 13,
	});
	assert.match(svg, /^<svg /);
	assert.match(svg, /role="img"/);
	assert.match(svg, /Terminay specification progress/);
	assert.match(svg, /3 of 12 checklist items complete/);
	assert.doesNotMatch(svg, /<script/);
});

test('zero percent does not draw a progress ring cap', () => {
	const svg = generateProgressSvg({
		checked: 0,
		remaining: 1,
		total: 1,
		percentage: 0,
		activePlans: 1,
		archivedPlans: 0,
		featureSpecs: 1,
	});
	assert.doesNotMatch(svg, /stroke-dasharray="0 100"/);
});

test('artifact generation adds and preserves a cache key on no-op runs', () => {
	const root = fixture();
	const first = writeProgressArtifacts({
		root,
		timestamp: 1784978870,
		updateReadme: true,
	});
	const second = writeProgressArtifacts({
		root,
		timestamp: 1784978999,
		updateReadme: true,
	});
	assert.equal(first.svgChanged, true);
	assert.equal(first.readmeChanged, true);
	assert.equal(second.svgChanged, false);
	assert.equal(second.readmeChanged, false);
	assert.match(
		readFileSync(join(root, 'README.md'), 'utf8'),
		/spec-progress\.svg\?v=1784978870/,
	);
});

test('progress changes refresh the SVG and README cache key', () => {
	const root = fixture();
	writeProgressArtifacts({ root, timestamp: 1784978870, updateReadme: true });
	writeFileSync(join(root, 'specs', 'tasks', 'active.md'), '- [x] one\n');
	const result = writeProgressArtifacts({
		root,
		timestamp: 1784978999,
		updateReadme: true,
	});
	assert.equal(result.svgChanged, true);
	assert.equal(result.readmeChanged, true);
	assert.match(
		readFileSync(join(root, 'docs', 'spec-progress.svg'), 'utf8'),
		/1 of 1 checklist items complete/,
	);
	assert.match(
		readFileSync(join(root, 'README.md'), 'utf8'),
		/spec-progress\.svg\?v=1784978999/,
	);
});
