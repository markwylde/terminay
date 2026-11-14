import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	DEGRADED_TERMINAL_MESSAGE,
	degradedTerminalBanner,
} from './degradedTerminalBanner.ts';

test('a session whose temporary directory is unusable says so, in exactly these words', () => {
	const markup = renderToStaticMarkup(
		degradedTerminalBanner('tmp-unusable', () => {}),
	);
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

test('it is the workspace error bar, with its dismiss button', () => {
	const markup = renderToStaticMarkup(
		degradedTerminalBanner('tmp-unusable', () => {}),
	);
	assert.match(markup, /^<div class="error-banner" data-degraded="tmp-unusable">/u);
	assert.match(markup, /class="error-banner__dismiss"/u);
	assert.doesNotMatch(markup, /tabindex|aria-modal|role="alert"/u);
});

test('no flag, or one this build does not know, shows nothing', () => {
	assert.equal(degradedTerminalBanner(undefined, () => {}), null);
	assert.equal(degradedTerminalBanner('something-else', () => {}), null);
});

test('the terminal panel shows the banner from its attachment, at its top', () => {
	const panel = readFileSync(
		new URL('./TerminalPanel.tsx', import.meta.url),
		'utf8',
	);
	assert.match(panel, /setDegraded\(attachment\.degraded\)/u);
	assert.match(
		panel,
		/ref=\{containerRef\}[\s\S]{0,80}>\s*\{degradedTerminalBanner\(degraded, dismissDegraded\)\}/u,
	);
});
