import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(
	join(tmpdir(), 'terminay-terminal-mouse-report-coords-'),
);
const outputPath = join(outputDirectory, 'terminalMouseReportCoords.mjs');

await build({
	bundle: true,
	entryPoints: ['src/components/terminalMouseReportCoords.ts'],
	format: 'esm',
	outfile: outputPath,
	platform: 'node',
});

const { sanitizeMouseReportCoords, suppressNonFiniteMouseReportCoords } =
	await import(pathToFileURL(outputPath).href);

test.after(async () => {
	await rm(outputDirectory, { force: true, recursive: true });
});

const finite = { col: 4, row: 2, x: 40, y: 20 };

test('finite mouse report coords pass through', () => {
	assert.equal(sanitizeMouseReportCoords(finite), finite);
	assert.equal(sanitizeMouseReportCoords(undefined), undefined);
});

test('non-finite mouse report coords are dropped so SGR cannot stringify NaN', () => {
	assert.equal(
		sanitizeMouseReportCoords({ col: Number.NaN, row: 1, x: 0, y: 0 }),
		undefined,
	);
	assert.equal(
		sanitizeMouseReportCoords({ col: 1, row: Number.NaN, x: 0, y: 0 }),
		undefined,
	);
	assert.equal(
		sanitizeMouseReportCoords({ col: 1, row: 1, x: Number.NaN, y: 0 }),
		undefined,
	);
	assert.equal(
		sanitizeMouseReportCoords({
			col: 1,
			row: 1,
			x: 0,
			y: Number.POSITIVE_INFINITY,
		}),
		undefined,
	);
});

test('SGR encoding of unsanitized NaN coords is the garbage the prompt showed', () => {
	const unsanitized = `\x1b[<64;${Number.NaN};${Number.NaN}M`;
	assert.equal(unsanitized, '\x1b[<64;NaN;NaNM');
	assert.equal(
		sanitizeMouseReportCoords({
			col: Number.NaN,
			row: Number.NaN,
			x: Number.NaN,
			y: Number.NaN,
		}),
		undefined,
	);
});

test('terminal mouse coords reports are sanitized at the coords seam', () => {
	const reports = [];
	const terminal = {
		_core: {
			_mouseCoordsService: {
				getMouseReportCoords(event, element) {
					reports.push({ event, element });
					return event === 'finite'
						? finite
						: { col: Number.NaN, row: 0, x: 0, y: 0 };
				},
			},
		},
	};
	const restore = suppressNonFiniteMouseReportCoords(terminal);
	assert.deepEqual(
		terminal._core._mouseCoordsService.getMouseReportCoords('finite', 'screen'),
		finite,
	);
	assert.equal(
		terminal._core._mouseCoordsService.getMouseReportCoords(
			'inertia',
			'screen',
		),
		undefined,
	);
	restore();
	assert.equal(
		terminal._core._mouseCoordsService.getMouseReportCoords('inertia', 'screen')
			.col,
		Number.NaN,
	);
	assert.deepEqual(reports, [
		{ event: 'finite', element: 'screen' },
		{ event: 'inertia', element: 'screen' },
		{ event: 'inertia', element: 'screen' },
	]);
});
