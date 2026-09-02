import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const progressImagePattern = /docs\/spec-progress\.svg(?:\?v=(\d+))?/;
const progressVersionPattern = /\sdata-cache-version="(\d+)"/;

function subdirectoryFiles(directory, fileName, { exclude = [] } = {}) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			if (!entry.isDirectory() || exclude.includes(entry.name)) return [];
			const path = join(directory, entry.name, fileName);
			return existsSync(path) ? [path] : [];
		})
		.sort((left, right) => left.localeCompare(right, 'en'));
}

export function parseChecklist(markdown) {
	let checked = 0;
	let remaining = 0;
	let fenceCharacter = null;

	for (const line of markdown.split(/\r?\n/)) {
		const fence = line.match(/^\s*(`{3,}|~{3,})/);
		if (fence) {
			const character = fence[1][0];
			fenceCharacter =
				fenceCharacter === character ? null : (fenceCharacter ?? character);
			continue;
		}
		if (fenceCharacter !== null) continue;

		const checkbox = line.match(/^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\](?:\s+|$)/);
		if (!checkbox) continue;
		if (checkbox[1].toLowerCase() === 'x') checked += 1;
		else remaining += 1;
	}

	return { checked, remaining };
}

export function collectSpecStats(root = repositoryRoot) {
	const changesRoot = join(root, 'openspec', 'changes');
	const activeTaskFiles = subdirectoryFiles(changesRoot, 'tasks.md', {
		exclude: ['archive'],
	});
	const archivedTaskFiles = subdirectoryFiles(
		join(changesRoot, 'archive'),
		'tasks.md',
	);
	const featureFiles = subdirectoryFiles(
		join(root, 'openspec', 'specs'),
		'spec.md',
	);
	const checklist = [...activeTaskFiles, ...archivedTaskFiles].reduce(
		(total, file) => {
			const parsed = parseChecklist(readFileSync(file, 'utf8'));
			return {
				checked: total.checked + parsed.checked,
				remaining: total.remaining + parsed.remaining,
			};
		},
		{ checked: 0, remaining: 0 },
	);
	const total = checklist.checked + checklist.remaining;

	return {
		...checklist,
		total,
		percentage:
			total === 0 ? 100 : Math.round((checklist.checked / total) * 100),
		activePlans: activeTaskFiles.length,
		archivedPlans: archivedTaskFiles.length,
		featureSpecs: featureFiles.length,
	};
}

function metricCard({ x, value, label, accent, fill, stroke }) {
	const valueText = String(value);
	const valueSize = valueText.length > 5 ? 26 : valueText.length > 3 ? 30 : 34;
	return `<g transform="translate(${x} 54)">
      <rect width="146" height="82" rx="16" fill="${fill}" stroke="${stroke}"/>
      <text x="20" y="38" fill="${accent}" font-size="${valueSize}" font-weight="750">${valueText}</text>
      <text x="20" y="64" fill="#8b949e" font-size="12" font-weight="700" letter-spacing="1.8">${label}</text>
    </g>`;
}

export function generateProgressSvg(stats, { cacheVersion } = {}) {
	const completedWidth = Number(((1080 * stats.percentage) / 100).toFixed(2));
	const progressRing =
		stats.percentage > 0
			? `<circle r="54" fill="none" stroke="url(#progress)" stroke-width="12" stroke-linecap="round" pathLength="100" stroke-dasharray="${stats.percentage} 100" transform="rotate(-90)"/>`
			: '';
	const versionAttribute =
		cacheVersion === undefined ? '' : ` data-cache-version="${cacheVersion}"`;
	const cards = [
		[164, stats.checked, 'DONE', '#7ee2a8', '#0f211b', '#1f5f46'],
		[326, stats.remaining, 'REMAINING', '#ffd8a8', '#211a13', '#5d4225'],
		[488, stats.total, 'TOTAL', '#e6edf3', '#12171d', '#30363d'],
		[676, stats.activePlans, 'ACTIVE PLANS', '#d2a8ff', '#1a1424', '#4c3569'],
		[838, stats.archivedPlans, 'ARCHIVED', '#79c0ff', '#0f1c27', '#274d69'],
		[
			1000,
			stats.featureSpecs,
			'FEATURE SPECS',
			'#ffa198',
			'#251514',
			'#65302d',
		],
	]
		.map(([x, value, label, accent, fill, stroke]) =>
			metricCard({ x, value, label, accent, fill, stroke }),
		)
		.join('\n  ');

	return `<svg xmlns="http://www.w3.org/2000/svg"${versionAttribute} width="1280" height="224" viewBox="0 0 1280 224" role="img" aria-labelledby="title description" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-variant-numeric="tabular-nums">
  <title id="title">Terminay specification progress</title>
  <desc id="description">${stats.percentage}% complete. ${stats.checked} done, ${stats.remaining} remaining, ${stats.total} total checklist items.</desc>
  <defs>
    <linearGradient id="progress" x1="0" x2="1"><stop offset="0" stop-color="#33d17a"/><stop offset="1" stop-color="#58a6ff"/></linearGradient>
    <filter id="shadow" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="7" stdDeviation="9" flood-color="#000" flood-opacity=".28"/></filter>
  </defs>
  <rect x="1" y="1" width="1278" height="222" rx="24" fill="#0b0f14" stroke="#21262d"/>
  <g transform="translate(82 111)">
    <circle r="54" fill="#0d1117" stroke="#21262d" stroke-width="12"/>
    ${progressRing}
    <text y="-1" text-anchor="middle" dominant-baseline="middle" fill="#f0f6fc" font-size="28" font-weight="800">${stats.percentage}%</text>
    <text y="26" text-anchor="middle" fill="#8b949e" font-size="10" font-weight="700" letter-spacing="1.5">COMPLETE</text>
  </g>
  <text x="164" y="31" fill="#f0f6fc" font-size="16" font-weight="750">Specification progress</text>
  <text x="344" y="31" fill="#6e7681" font-size="12">generated from openspec/changes</text>
  ${cards}
  <g filter="url(#shadow)"><rect x="164" y="164" width="1080" height="12" rx="6" fill="#1b2128"/><rect x="164" y="164" width="${completedWidth}" height="12" rx="6" fill="url(#progress)"/></g>
  <text x="164" y="204" fill="#8b949e" font-size="12">${stats.checked} of ${stats.total} checklist items complete</text>
  <text x="1244" y="204" text-anchor="end" fill="#8b949e" font-size="12">${stats.activePlans} active · ${stats.archivedPlans} archived · ${stats.featureSpecs} feature specs</text>
</svg>
`;
}

export function updateProgressImageVersion(readme, version) {
	if (!Number.isSafeInteger(version) || version < 0)
		throw new TypeError('Progress image version must be a Unix timestamp.');
	if (!progressImagePattern.test(readme))
		throw new Error(
			'README does not contain the specification progress image.',
		);
	return readme.replace(
		progressImagePattern,
		`docs/spec-progress.svg?v=${version}`,
	);
}

export function writeProgressArtifacts({
	root = repositoryRoot,
	outputPath = join(root, 'docs', 'spec-progress.svg'),
	readmePath = join(root, 'README.md'),
	timestamp = Math.floor(Date.now() / 1000),
	updateReadme = false,
} = {}) {
	if (!Number.isSafeInteger(timestamp) || timestamp < 0)
		throw new TypeError('Progress image timestamp must be a Unix timestamp.');
	const stats = collectSpecStats(root);
	const previousSvg = existsSync(outputPath)
		? readFileSync(outputPath, 'utf8')
		: null;
	const previousVersion = Number(
		previousSvg?.match(progressVersionPattern)?.[1] ?? timestamp,
	);
	let cacheVersion = previousVersion;
	let nextSvg = generateProgressSvg(stats, { cacheVersion });
	const svgChanged = previousSvg !== nextSvg;
	if (svgChanged) {
		if (previousSvg !== null)
			cacheVersion = Math.max(timestamp, previousVersion + 1);
		nextSvg = generateProgressSvg(stats, { cacheVersion });
		mkdirSync(dirname(outputPath), { recursive: true });
		writeFileSync(outputPath, nextSvg, 'utf8');
	}

	let readmeChanged = false;
	if (updateReadme) {
		const readme = readFileSync(readmePath, 'utf8');
		const nextReadme = updateProgressImageVersion(readme, cacheVersion);
		readmeChanged = nextReadme !== readme;
		if (readmeChanged) writeFileSync(readmePath, nextReadme, 'utf8');
	}
	return { stats, svgChanged, readmeChanged, cacheVersion };
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const result = writeProgressArtifacts({
		updateReadme: process.argv.includes('--update-readme'),
	});
	console.log(
		`Generated ${relative(repositoryRoot, join(repositoryRoot, 'docs', 'spec-progress.svg'))}: ${result.stats.checked}/${result.stats.total} complete (${result.stats.percentage}%).`,
	);
	if (result.readmeChanged)
		console.log(
			`Updated README progress cache key to v=${result.cacheVersion}.`,
		);
}
