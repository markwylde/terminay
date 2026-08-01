import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

export async function compareAppScreenshots({
	electronPng,
	webPng,
	electronState,
	webState,
}) {
	const [electronImage, webImage] = await Promise.all([
		readPng(electronPng),
		readPng(webPng),
	]);
	const semanticFields = [
		'componentIdentity',
		'workspaceRevision',
		'projectId',
		'viewId',
		'panelId',
		'panelKind',
		'terminalSessionId',
		'viewportWidth',
		'viewportHeight',
		'deviceScaleFactor',
	];
	assert.equal(
		electronState.componentIdentity,
		'src/App.tsx#App/ProjectWorkspace/Dockview@1',
	);
	for (const field of semanticFields) {
		assert.deepEqual(
			webState[field],
			electronState[field],
			`semantic mismatch: ${field}`,
		);
	}
	assert.equal(
		electronImage.width,
		webImage.width,
		'screenshot width mismatch',
	);
	assert.equal(
		electronImage.height,
		webImage.height,
		'screenshot height mismatch',
	);

	let differingPixels = 0;
	const pixelCount = electronImage.width * electronImage.height;
	for (let offset = 0; offset < electronImage.data.length; offset += 4) {
		if (
			electronImage.data[offset] !== webImage.data[offset] ||
			electronImage.data[offset + 1] !== webImage.data[offset + 1] ||
			electronImage.data[offset + 2] !== webImage.data[offset + 2] ||
			electronImage.data[offset + 3] !== webImage.data[offset + 3]
		) {
			differingPixels++;
		}
	}
	const differingRatio = differingPixels / pixelCount;
	assert.equal(
		differingRatio,
		0,
		`App-owned screenshot pixels differ: ${differingPixels}/${pixelCount}`,
	);
	return { pixelCount, differingPixels, differingRatio };
}

if (
	process.argv[1] !== undefined &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	const args = parseArgs(process.argv.slice(2));
	for (const name of [
		'electron-png',
		'web-png',
		'electron-state',
		'web-state',
	]) {
		if (args[name] === undefined) {
			throw new Error(`Missing --${name} acceptance artifact.`);
		}
	}
	const [electronState, webState] = await Promise.all([
		readJson(args['electron-state']),
		readJson(args['web-state']),
	]);
	const result = await compareAppScreenshots({
		electronPng: args['electron-png'],
		webPng: args['web-png'],
		electronState,
		webState,
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function readJson(file) {
	return JSON.parse(await readFile(file, 'utf8'));
}

async function readPng(file) {
	return PNG.sync.read(await readFile(file));
}

function parseArgs(values) {
	const parsed = {};
	for (let index = 0; index < values.length; index += 2) {
		const key = values[index]?.replace(/^--/u, '');
		const value = values[index + 1];
		if (!key || !value)
			throw new Error('Acceptance arguments must be --name value pairs.');
		parsed[key] = value;
	}
	return parsed;
}
