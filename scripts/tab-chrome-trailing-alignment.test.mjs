import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const rule = (css, selector) => {
	const start = css.indexOf(`\n${selector} {`);
	assert.notEqual(start, -1, `missing rule for ${selector}`);
	const end = css.indexOf('}', start);
	assert.notEqual(end, -1, `unterminated rule for ${selector}`);
	return css.slice(start, end);
};

test('the compact title block yields its project before its folder', async () => {
	const css = await read('src/App.css');
	// No chevron competes for the trailing edge; the folder line gives up its
	// project first, so the worktree the keystrokes land in stays readable.
	assert.equal(css.indexOf('\n.compact-breadcrumb__chevron {'), -1);
	assert.match(rule(css, '.compact-breadcrumb__project'), /flex: 0 1000 auto;/);
	assert.match(rule(css, '.compact-title__folder'), /flex: 0 1 auto;/);
});

test('a panel tab closes at the same inset its title opens at', async () => {
	const css = await read('src/App.css');
	// 4px of container inset plus the close button's own 5px around the glyph
	// reads level with the title's 10px at the leading edge.
	assert.match(rule(css, '.terminal-tab-content'), /padding: 0 4px 0 10px;/);

	const close = rule(css, '.terminal-tab-close');
	assert.match(close, /width: 20px;/);
	assert.match(close, /height: 20px;/);
	assert.doesNotMatch(close, /margin-right: (?!0;)/);

	// The 20px box is drawn around a 10px glyph; the pair is what balances the
	// tab, so neither half may move on its own.
	const chrome = await read('src/components/DockTabChrome.tsx');
	const button = chrome.slice(chrome.indexOf('className="terminal-tab-close"'));
	assert.match(button, /width="10"/);
	assert.match(button, /height="10"/);
});
