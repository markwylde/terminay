import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	DEGRADED_TERMINAL_MESSAGE,
	degradedTerminalBanner,
} from './degradedTerminalBanner.ts';

test('a session whose temporary directory is unusable says so, in exactly these words', () => {
	const markup = renderToStaticMarkup(degradedTerminalBanner('tmp-unusable'));
	assert.match(markup, /role="status"/u);
	assert.ok(
		markup.includes(
			'This terminal&#x27;s temporary directory is no longer usable. New terminals are not affected.',
		),
		markup,
	);
	assert.equal(
		DEGRADED_TERMINAL_MESSAGE,
		"This terminal's temporary directory is no longer usable. New terminals are not affected.",
	);
});

test('the notice blocks nothing: no control, no focus, no input handling', () => {
	const markup = renderToStaticMarkup(degradedTerminalBanner('tmp-unusable'));
	assert.doesNotMatch(markup, /<button|<input|tabindex|aria-modal|role="alert"/u);
	const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
	const rule = css.slice(css.indexOf('.terminal-degraded-notice {'));
	assert.match(
		rule.slice(0, rule.indexOf('}')),
		/pointer-events: none;/u,
		'clicks reach the terminal through the notice',
	);
});

test('no flag, or one this build does not know, shows nothing', () => {
	assert.equal(degradedTerminalBanner(undefined), null);
	assert.equal(degradedTerminalBanner('something-else'), null);
});

test('the terminal panel shows the notice from its attachment', () => {
	const panel = readFileSync(
		new URL('./TerminalPanel.tsx', import.meta.url),
		'utf8',
	);
	assert.match(panel, /setDegraded\(attachment\.degraded\)/u);
	assert.match(panel, /\{degradedTerminalBanner\(degraded\)\}/u);
});
