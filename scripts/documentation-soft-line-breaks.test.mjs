import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { build } from 'esbuild';

/**
 * A single newline inside a Markdown paragraph is a soft line break: it renders
 * as a space, and only a blank line starts a new paragraph. MDXEditor imports
 * that newline verbatim into the Lexical text node, and Lexical forces
 * `white-space: pre-wrap` on every editable root, so hand-wrapped Markdown
 * shows breaks the live preview beside it collapses away.
 *
 * CSS cannot correct it. Collapsing a newline while keeping the spaces Lexical
 * depends on is `white-space-collapse: preserve-spaces`, a value MDN documents
 * and no Chromium implements, so the declaration is dropped as invalid. The
 * correction happens on import instead, and these tests pin both halves of it:
 * the collapse itself, and the rule that reading a document is not editing it.
 */
let collapse;
after(async () => {
	await cleanup?.();
});
let cleanup;

async function loadCollapse() {
	if (collapse) return collapse;
	const directory = await mkdtemp(join(tmpdir(), 'terminay-soft-line-breaks-'));
	cleanup = () => rm(directory, { recursive: true, force: true });
	const outfile = join(directory, 'compat.mjs');
	await build({
		entryPoints: ['src/components/file-viewer/documentationMarkdownCompat.ts'],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		logLevel: 'silent',
	});
	({ collapseSoftLineBreaks: collapse } = await import(outfile));
	return collapse;
}

test('a soft line break becomes the space it stands for', async () => {
	const collapseSoftLineBreaks = await loadCollapse();
	assert.equal(
		collapseSoftLineBreaks('All detection is done by x,\npinned to 1.4.0.'),
		'All detection is done by x, pinned to 1.4.0.',
	);
	assert.equal(collapseSoftLineBreaks('one\ntwo\nthree'), 'one two three');
	assert.equal(collapseSoftLineBreaks('no breaks here'), 'no breaks here');
});

test('the wrap takes its surrounding whitespace with it', async () => {
	const collapseSoftLineBreaks = await loadCollapse();
	assert.equal(
		collapseSoftLineBreaks('item one\n  continues'),
		'item one continues',
	);
	assert.equal(collapseSoftLineBreaks('trailing \nspace'), 'trailing space');
	assert.equal(collapseSoftLineBreaks('tab\n\tindented'), 'tab indented');
});

test('whitespace that is not a wrap is left alone', async () => {
	const collapseSoftLineBreaks = await loadCollapse();
	assert.equal(collapseSoftLineBreaks('two  spaces'), 'two  spaces');
	assert.equal(collapseSoftLineBreaks('trailing space '), 'trailing space ');
});

test('the collapse runs on parsed text nodes, never on raw source', async () => {
	const plugins = await readFile(
		'src/components/file-viewer/documentationEditorPlugins.tsx',
		'utf8',
	);
	// An mdast `text` node is prose the parser has already separated from code,
	// tables, hard breaks, and list and quote markers. Reaching for the source
	// string instead would have to re-derive all of that with a regular
	// expression, and would get it wrong.
	assert.match(plugins, /testNode: 'text'/u);
	assert.match(plugins, /collapseSoftLineBreaks\(mdastNode\.value\)/u);
	// Import visitors match first to last and core registers its text visitor
	// before any plugin's, so ours has to go in front of the list.
	assert.match(plugins, /realm\.pub\(\s*importVisitors\$/u);
	assert.match(
		plugins,
		/softLineBreakTextVisitor[\s\S]*\.\.\.realm\.getValue/u,
	);
	assert.match(plugins, /softLineBreakPlugin\(\),\n\theadingsPlugin\(\)/u);
});

test('reading a document is not editing it', async () => {
	const editor = await readFile(
		'src/components/file-viewer/DocumentationEditor.tsx',
		'utf8',
	);
	// The editor reports its normalized parse of the document on load. Passing
	// that on would mark the file dirty and rewrite it on disk for having been
	// opened, which is the whole cost the collapse is meant not to have.
	assert.match(editor, /if \(initial\) return;/u);
	const handler = editor.slice(
		editor.indexOf('const handleChange'),
		editor.indexOf('const flush'),
	);
	assert.ok(
		handler.indexOf('if (initial) return;') < handler.indexOf('onChange(next)'),
		'the initial normalization must return before reaching onChange',
	);
});

test('no stylesheet tries to collapse whitespace instead', async () => {
	const css = await readFile(
		'src/components/file-viewer/fileViewer.css',
		'utf8',
	);
	assert.doesNotMatch(
		css,
		/white-space-collapse/u,
		'preserve-spaces is not implemented in Chromium; the fix is on import',
	);
});
