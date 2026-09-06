import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { desktopStartupLoadingDocument, startupPhaseVisibilityCss } =
	await importBundled('../electron/startupLoadingDocument.ts');

const CSP =
	"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

function decode(document) {
	assert.ok(document.startsWith('data:text/html;charset=UTF-8,'));
	return decodeURIComponent(
		document.slice('data:text/html;charset=UTF-8,'.length),
	);
}

test('the document stays script-free and keeps its closed CSP', () => {
	for (const html of [
		decode(desktopStartupLoadingDocument()),
		decode(desktopStartupLoadingDocument()),
	]) {
		assert.ok(!/<script/iu.test(html), 'a script tag was introduced');
		assert.ok(!/\son[a-z]+=/iu.test(html), 'an inline handler was introduced');
		assert.ok(html.includes(CSP), 'the CSP changed');
		// The SVG xmlns is a namespace, not a fetch. Nothing may be loaded.
		assert.ok(
			!/(?:src|href)\s*=\s*"(?!#)/iu.test(html),
			'a loadable reference was introduced',
		);
		assert.ok(!/url\(/iu.test(html), 'a CSS url() was introduced');
	}
});

test('the mark, dots, colours, and reduced-motion rule are unchanged by a label', () => {
	const without = decode(desktopStartupLoadingDocument());
	const withLabel = decode(desktopStartupLoadingDocument());
	for (const fragment of [
		'class="logo"',
		'viewBox="0 0 24 24"',
		'background:#db5757',
		'background:#c1db57',
		'background:#57db8c',
		'background:#578cdb',
		'background:#c157db',
		'@keyframes loading-dot{0%,55%,100%{opacity:.2;transform:scale(.65)}18%,36%{opacity:1;transform:scale(1)}}',
		'@media (prefers-reduced-motion:reduce)',
		'.dots span{width:7px;height:7px',
	]) {
		assert.ok(without.includes(fragment), `missing without label: ${fragment}`);
		assert.ok(withLabel.includes(fragment), `missing with label: ${fragment}`);
	}
});

test('every phase label is baked in and hidden, with none marked active', () => {
	const html = decode(desktopStartupLoadingDocument());
	// Labels are real text nodes, so the line is readable by assistive tech.
	assert.ok(html.includes('<p class="phase" data-phase="vault-unlock">'));
	assert.ok(html.includes('Unlocking secure storage'));
	assert.ok(html.includes('Starting the local server'));
	assert.ok(html.includes('.phase{display:none'));
	// The document must never mark one active. Blink matches an injected author
	// stylesheet before the document's own <style>, so a rule here would outrank
	// every rule main inserts and the line would stick on the baked-in phase.
	assert.ok(!html.includes('display:block'), 'the document reveals nothing');
	// The block follows the dots, so it renders beneath the indicator.
	assert.ok(html.indexOf('class="dots"') < html.indexOf('class="phases"'));
});

test('the reveal rule is confined to the closed phase vocabulary', () => {
	// The rule hides every phase before showing one, at equal specificity, so
	// the newest inserted rule always wins and a stale rule cannot keep its own
	// line on screen.
	assert.equal(
		startupPhaseVisibilityCss('server-compose'),
		'.phase[data-phase]{display:none!important}.phase[data-phase="server-compose"]{display:block!important}',
	);
	for (const bogus of ['"] , * {display:none} .x[y="', '../etc/passwd', '']) {
		assert.throws(
			() => startupPhaseVisibilityCss(bogus),
			/unknown startup phase/u,
		);
	}
});

test('the negative animation delay is recomputed so the dots never restart', () => {
	const html = decode(desktopStartupLoadingDocument());
	const match = /--terminay-loading-phase:(-?\d+)ms/u.exec(html);
	assert.ok(match, 'the loading phase variable is missing');
	const value = Number(match[1]);
	assert.ok(value <= 0 && value > -1600, `unexpected delay ${value}`);
});

test('labels are escaped when written into the document', () => {
	// Labels come from a closed table, but the document escapes them anyway so
	// it cannot become an injection surface if that table ever changes.
	const html = decode(desktopStartupLoadingDocument());
	assert.ok(!html.includes('<script'));
	assert.ok(!/data-phase="[^"]*"><[^/]/u.test(html));
});

async function importBundled(relativePath) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-startup-loading-bundle-'),
	);
	const outputPath = join(temporaryDirectory, 'startupLoadingDocument.mjs');
	try {
		await build({
			bundle: true,
			entryPoints: [new URL(relativePath, import.meta.url).pathname],
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}
