import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(
	join(tmpdir(), 'terminay-terminal-focus-interaction-'),
);
const outputPath = join(outputDirectory, 'terminalFocusInteraction.mjs');

await build({
	bundle: true,
	entryPoints: ['src/components/terminalFocusInteraction.ts'],
	format: 'esm',
	outfile: outputPath,
	platform: 'node',
});

const {
	shouldClaimCreatedTerminalFocus,
	shouldRestoreTerminalFocusAfterWindowActivation,
} = await import(pathToFileURL(outputPath).href);
const terminalPanelSource = await readFile(
	'src/components/TerminalPanel.tsx',
	'utf8',
);

test.after(async () => {
	await rm(outputDirectory, { force: true, recursive: true });
});

test('window activation restores only the terminal clicked in the fresh activation window', () => {
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_000),
		true,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_599),
		true,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_600),
		false,
	);
});

test('stale, future, malformed, and non-positive activation windows cannot steal split-terminal focus', () => {
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 999),
		false,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_601),
		false,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(Number.NaN, 1_000),
		false,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, Infinity),
		false,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_001, 0),
		false,
	);
});

test('touch tap bridges iOS focus without taking over xterm gestures', () => {
	assert.doesNotMatch(terminalPanelSource, /activatePanelFromPointer/u);
	assert.doesNotMatch(
		terminalPanelSource,
		/root\.addEventListener\('pointerdown', [^)]*setActive/u,
	);
	assert.doesNotMatch(
		terminalPanelSource,
		/root\.addEventListener\('pointerdown', activatePanelFromPointer\)/u,
	);
	assert.doesNotMatch(terminalPanelSource, /pointerFocusGesture/u);
	assert.match(
		terminalPanelSource,
		/shouldFocusTerminalForTouchPointer\(event\.pointerType\)/u,
	);
	assert.match(
		terminalPanelSource,
		/root\.addEventListener\('pointerdown', handleTouchPointerDown\)/u,
	);
	assert.match(
		terminalPanelSource,
		/root\.addEventListener\('pointermove', handleTouchPointerMove\)/u,
	);
	assert.match(
		terminalPanelSource,
		/root\.addEventListener\('pointerup', handleTouchPointerUp\)/u,
	);
	assert.match(
		terminalPanelSource,
		/root\.addEventListener\('pointercancel', handleTouchPointerCancel\)/u,
	);
	assert.match(
		terminalPanelSource,
		/root\.addEventListener\(\s*'touchstart',\s*handleTouchStart/u,
	);
	assert.match(
		terminalPanelSource,
		/root\.addEventListener\(\s*'touchmove',\s*handleTouchMove/u,
	);
	assert.match(
		terminalPanelSource,
		/root\.addEventListener\(\s*'touchend',\s*handleTouchEnd/u,
	);
	assert.match(
		terminalPanelSource,
		/root\.addEventListener\(\s*'touchcancel',\s*handleTouchCancel/u,
	);

	const handlerBody = (name) => {
		const match = terminalPanelSource.match(
			new RegExp(
				`const ${name} = \\([^)]*\\) => \\{([\\s\\S]*?)\\n\\t\\t\\};`,
				'u',
			),
		);
		assert.ok(match, `missing ${name}`);
		return match[1];
	};

	const tapHandlers = [
		'handleTouchPointerDown',
		'handleTouchPointerMove',
		'handleTouchPointerUp',
		'handleTouchPointerCancel',
		'handleTouchStart',
		'handleTouchMove',
		'handleTouchEnd',
		'handleTouchCancel',
	];
	for (const name of tapHandlers) {
		const body = handlerBody(name);
		assert.doesNotMatch(body, /preventDefault/u);
		assert.doesNotMatch(body, /stopPropagation/u);
	}

	const pointerUpBody = handlerBody('handleTouchPointerUp');
	assert.match(pointerUpBody, /tapSession\.pointerUp\(event\)/u);
	assert.match(pointerUpBody, /focusTerminalFromTouch\(\)/u);
	assert.doesNotMatch(
		pointerUpBody,
		/setTimeout|queueMicrotask|requestAnimationFrame|Promise/u,
	);
	const touchEndBody = handlerBody('handleTouchEnd');
	assert.match(touchEndBody, /tapSession\.pointerUp\(point\)/u);
	assert.match(touchEndBody, /focusTerminalFromTouch\(\)/u);
	assert.doesNotMatch(
		touchEndBody,
		/setTimeout|queueMicrotask|requestAnimationFrame|Promise/u,
	);

	assert.doesNotMatch(
		handlerBody('handleTouchPointerDown'),
		/focusTerminalFromTouch/u,
	);
	assert.doesNotMatch(
		handlerBody('handleTouchPointerMove'),
		/focusTerminalFromTouch/u,
	);
	assert.doesNotMatch(
		handlerBody('handleTouchPointerCancel'),
		/focusTerminalFromTouch/u,
	);
	assert.doesNotMatch(
		handlerBody('handleTouchStart'),
		/focusTerminalFromTouch/u,
	);
	assert.doesNotMatch(
		handlerBody('handleTouchMove'),
		/focusTerminalFromTouch/u,
	);
	assert.doesNotMatch(
		handlerBody('handleTouchCancel'),
		/focusTerminalFromTouch/u,
	);
	assert.match(
		handlerBody('handleTouchStart'),
		/shouldFocusTerminalForTouchStart/u,
	);
	assert.match(
		handlerBody('handleTouchMove'),
		/shouldFocusTerminalForTouchStart/u,
	);
	assert.match(
		handlerBody('handleTouchEnd'),
		/shouldFocusTerminalForTouchStart/u,
	);
	assert.match(
		handlerBody('handleTouchCancel'),
		/shouldFocusTerminalForTouchStart/u,
	);

	const focusFromTouch = handlerBody('focusTerminalFromTouch');
	assert.match(focusFromTouch, /terminal\.focus\(\)/u);
	assert.match(focusFromTouch, /announceTerminalFocus\(\)/u);
	for (const name of tapHandlers) {
		assert.doesNotMatch(handlerBody(name), /announceTerminalFocus/u);
	}
});

test('created terminals reclaim focus from project and terminal creation chrome', () => {
	assert.equal(shouldClaimCreatedTerminalFocus(null), true);
	assert.equal(shouldClaimCreatedTerminalFocus({ nodeName: 'BODY' }), true);
	assert.equal(
		shouldClaimCreatedTerminalFocus({
			nodeName: 'BUTTON',
			closest: (selector) =>
				selector.includes('terminay-add-tab-button') ? {} : null,
		}),
		true,
	);
	assert.equal(
		shouldClaimCreatedTerminalFocus({
			nodeName: 'BUTTON',
			closest: (selector) => (selector.includes('project-tab-add') ? {} : null),
		}),
		true,
	);
	assert.equal(
		shouldClaimCreatedTerminalFocus({
			nodeName: 'INPUT',
			closest: () => null,
		}),
		false,
	);
	assert.match(
		terminalPanelSource,
		/shouldClaimCreatedTerminalFocus\(activeElement\)/u,
	);
});
