import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildHtmlPreviewDocument,
	type HtmlPreviewCache,
	type HtmlPreviewLimits,
	resolveReference,
	scanTags,
} from './htmlPreviewDocument.ts';

const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

/** A project as the server would serve it: paths it has, and paths it refuses. */
function project(files: Record<string, string | Uint8Array>) {
	const requested: string[] = [];
	let reading = 0;
	let mostAtOnce = 0;
	const read = async (path: string, maxBytes: number) => {
		requested.push(path);
		reading += 1;
		mostAtOnce = Math.max(mostAtOnce, reading);
		await new Promise((resolve) => setImmediate(resolve));
		reading -= 1;
		const file = files[path];
		if (file === undefined) throw new Error(`refused: ${path}`);
		const bytes = (typeof file === 'string' ? Buffer.from(file, 'utf8') : Buffer.from(file)).subarray(
			0,
			maxBytes,
		);
		return { base64: bytes.toString('base64'), byteLength: bytes.byteLength };
	};
	return { read, requested, mostAtOnce: () => mostAtOnce };
}

async function build(
	html: string,
	files: Record<string, string | Uint8Array>,
	options: { baseDirectory?: string; limits?: Partial<HtmlPreviewLimits>; cache?: HtmlPreviewCache } = {},
) {
	const source = project(files);
	const built = await buildHtmlPreviewDocument({
		html,
		baseDirectory: options.baseDirectory ?? 'site',
		read: source.read,
		...(options.limits === undefined ? {} : { limits: options.limits }),
		...(options.cache === undefined ? {} : { cache: options.cache }),
	});
	// What the page's own markup became, without the policy and script put first.
	const body = built.html.slice(built.html.indexOf('</script>') + '</script>'.length);
	return { ...built, body, ...source };
}

const cssUrl = (css: string): string => `data:text/css;charset=utf-8,${encodeURIComponent(css)}`;

test('a reference resolves against the file folder, the project root, or not at all', () => {
	assert.deepEqual(resolveReference('style.css', 'site'), { kind: 'project', path: 'site/style.css', fragment: '' });
	assert.deepEqual(resolveReference('./img/a%20b.png?v=2#x', 'site'), { kind: 'project', path: 'site/img/a b.png', fragment: '#x' });
	assert.deepEqual(resolveReference('../shared/x.css', 'site/pages'), { kind: 'project', path: 'site/shared/x.css', fragment: '' });
	assert.deepEqual(resolveReference('/assets/x.js', 'site/pages'), { kind: 'project', path: 'assets/x.js', fragment: '' });
	assert.deepEqual(resolveReference('x.css', ''), { kind: 'project', path: 'x.css', fragment: '' });
	assert.deepEqual(resolveReference('../../outside/secret.css', 'site'), { kind: 'escape' });
	assert.deepEqual(resolveReference('/../secret.css', 'site'), { kind: 'escape' });
	assert.deepEqual(resolveReference('a/%2e%2e/%2e%2e/%2e%2e/x.css', 'site'), { kind: 'escape' });
	assert.deepEqual(resolveReference('a%2f..%2f..%2fx.css', 'site'), { kind: 'escape' });
	for (const external of ['https://cdn.example.com/x.js', 'HTTP://example.com/x.css', '//cdn.example.com/x.js', 'wss://example.com'])
		assert.deepEqual(resolveReference(external, 'site'), { kind: 'external' }, external);
	for (const nothing of ['', '  ', '#top', 'data:image/png;base64,AAAA', 'blob:abc', 'javascript:void 0', 'mailto:a@example.com'])
		assert.deepEqual(resolveReference(nothing, 'site'), { kind: 'none' }, nothing);
});

test('the scanner finds start tags and skips comments and text that only looks like markup', () => {
	const tags = scanTags(
		'<!doctype html><!-- <img src="no.png"> --><p class=a>x < y</p>' +
			'<script>if (a < b) document.write("<img src=no.png>")</script>' +
			'<IMG SRC=\'yes.png\' alt="a > b" hidden><br/>',
	);
	assert.deepEqual(tags.map((tag) => tag.name), ['p', 'script', 'img', 'br']);
	const image = tags[2];
	assert.deepEqual(image?.attributes.map((attribute) => [attribute.name, attribute.raw]), [
		['src', 'yes.png'],
		['alt', 'a > b'],
		['hidden', undefined],
	]);
});

test('every kind of project reference in the markup is inlined', async () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
	const pngUrl = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
	const built = await build(
		'<!doctype html><html><head>' +
			'<link rel="stylesheet" href="style.css" integrity="sha256-abc">' +
			'<link rel="icon" href=favicon.ico>' +
			'<link rel="preload" href="style.css" as="style">' +
			'<script src="./app.js" defer></script>' +
			'</head><body>' +
			'<img src="img/logo.png" srcset="img/logo.png 1x, img/logo@2x.png 2x">' +
			'<picture><source srcset="img/logo.png"></picture>' +
			'<video src="/media/clip.mp4" poster="img/logo.png"></video>' +
			'<audio src="sound.mp3"></audio>' +
			'<video><track src="subs.vtt"></video>' +
			'<svg><image href="img/logo.png" /></svg>' +
			'<input type="image" src="img/logo.png">' +
			'<div style="background: url(&quot;img/logo.png&quot;)"></div>' +
			'</body></html>',
		{
			'site/style.css': 'body{color:red}',
			'site/favicon.ico': png,
			'site/app.js': 'document.title = "</script>ran"',
			'site/img/logo.png': png,
			'site/img/logo@2x.png': png,
			'media/clip.mp4': png,
			'site/sound.mp3': png,
			'site/subs.vtt': 'WEBVTT',
		},
	);
	assert.equal(built.incomplete, false);
	assert.equal(built.allow, '');
	const { body } = built;
	assert.ok(body.includes(`<link rel="stylesheet" href="${cssUrl('body{color:red}')}" integrity="">`));
	assert.ok(body.includes(`<link rel="icon" href="data:image/x-icon;base64,${Buffer.from(png).toString('base64')}">`));
	// Not a reference the page renders from; left as written.
	assert.ok(body.includes('<link rel="preload" href="style.css" as="style">'));
	// A script is carried as a URL, so its text cannot close the element early.
	assert.ok(body.includes(`<script src="data:text/javascript;base64,${base64('document.title = "</script>ran"')}" defer></script>`));
	assert.ok(body.includes(`<img src="${pngUrl}" srcset="${pngUrl} 1x, ${pngUrl} 2x">`));
	assert.ok(body.includes(`<source srcset="${pngUrl}">`));
	assert.ok(body.includes(`<video src="data:video/mp4;base64,${Buffer.from(png).toString('base64')}" poster="${pngUrl}">`));
	assert.ok(body.includes('<audio src="data:audio/mpeg;base64,'));
	assert.ok(body.includes(`<track src="data:text/vtt;base64,${base64('WEBVTT')}">`));
	assert.ok(body.includes(`<image href="${pngUrl}" />`));
	assert.ok(body.includes(`<input type="image" src="${pngUrl}">`));
	assert.ok(body.includes(`<div style="background: url(&quot;${pngUrl}&quot;)"></div>`));
	assert.deepEqual([...new Set(built.requested)].sort(), [
		'media/clip.mp4',
		'site/app.js',
		'site/favicon.ico',
		'site/img/logo.png',
		'site/img/logo@2x.png',
		'site/sound.mp3',
		'site/style.css',
		'site/subs.vtt',
	]);
	// One read per file however often the page names it.
	assert.equal(built.requested.filter((path) => path === 'site/img/logo.png').length, 1);
});

test('the policy and link handling come before anything the page wrote', async () => {
	const built = await build('<!doctype html><title>t</title><p>hi</p>', {});
	assert.ok(built.html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\''));
	assert.ok(built.html.includes("connect-src 'none'"));
	assert.ok(built.html.includes("method: 'ui/open-link'"));
	assert.equal(built.body, '<title>t</title><p>hi</p>');
});

test('external references are left for the policy to refuse, and reported', async () => {
	const html =
		'<link rel="stylesheet" href="https://cdn.example.com/x.css">' +
		'<script src="//cdn.example.com/x.js"></script>' +
		'<img src="data:image/png;base64,AAAA"><a href="https://example.com">out</a>';
	const built = await build(html, {});
	assert.equal(built.body, html);
	assert.deepEqual(built.requested, []);
	assert.equal(built.incomplete, true);
	// A link to follow and an image already inline are not missing resources.
	const quiet = await build('<img src="data:image/png;base64,AAAA"><a href="https://example.com">out</a>', {});
	assert.equal(quiet.incomplete, false);
});

test('stylesheets inline what they refer to, relative to their own folder', async () => {
	const font = new Uint8Array([1, 2, 3]);
	const fontUrl = `data:font/woff2;base64,${Buffer.from(font).toString('base64')}`;
	const built = await build(
		'<link rel=stylesheet href="css/main.css"><style>@import "css/theme.css" screen; .a{background:url(img/a.svg#mark)}</style>',
		{
			'site/css/main.css': '@import url("./theme.css");\n@font-face{src:url(../fonts/f.woff2) format("woff2")}',
			'site/css/theme.css': '.t{background:url(\'../img/a.svg\')}',
			'site/fonts/f.woff2': font,
			'site/img/a.svg': '<svg/>',
		},
	);
	assert.equal(built.incomplete, false);
	const svgUrl = `data:image/svg+xml;base64,${base64('<svg/>')}`;
	const theme = `.t{background:url("${svgUrl}")}`;
	const main = `@import url("${cssUrl(theme)}");\n@font-face{src:url("${fontUrl}") format("woff2")}`;
	assert.ok(built.body.includes(`href="${cssUrl(main)}"`));
	assert.ok(
		built.body.includes(
			`<style>@import url("${cssUrl(theme)}") screen; .a{background:url("${svgUrl}#mark")}</style>`,
		),
	);
});

test('an import cycle and an import chain past the depth bound stop without failing the page', async () => {
	const cycle = await build('<link rel="stylesheet" href="a.css">', {
		'site/a.css': '@import "b.css"; .a{}',
		'site/b.css': '@import "a.css"; .b{}',
	});
	assert.equal(cycle.incomplete, true);
	assert.ok(cycle.body.includes(encodeURIComponent(encodeURIComponent('@import "a.css"; .b{}'))));

	const chain: Record<string, string> = {};
	for (let depth = 0; depth <= 6; depth += 1) chain[`site/c${depth}.css`] = `@import "c${depth + 1}.css"; .c${depth}{}`;
	const deep = await build('<link rel="stylesheet" href="c0.css">', chain);
	assert.equal(deep.incomplete, true);
	// The linked sheet and four levels of import are read; the fifth is not.
	assert.deepEqual(deep.requested.sort(), ['site/c0.css', 'site/c1.css', 'site/c2.css', 'site/c3.css', 'site/c4.css']);
	const within = await build('<link rel="stylesheet" href="c3.css">', { ...chain, 'site/c7.css': '.end{}' });
	assert.equal(within.incomplete, false);
});

test('a refused or missing file leaves that one reference and the rest of the page is built', async () => {
	const built = await build(
		'<link rel="stylesheet" href="../../outside/secret.css"><link rel="stylesheet" href="missing.css">' +
			'<img src="notes.txt"><img src="ok.png"><p>still here</p>',
		{ 'site/ok.png': new Uint8Array([1]), 'site/notes.txt': 'not an image' },
	);
	assert.equal(built.incomplete, true);
	assert.ok(built.body.includes('<link rel="stylesheet" href="../../outside/secret.css">'));
	assert.ok(built.body.includes('<link rel="stylesheet" href="missing.css">'));
	assert.ok(built.body.includes('<img src="notes.txt">'));
	assert.ok(built.body.includes('<img src="data:image/png;base64,AQ==">'));
	assert.ok(built.body.includes('<p>still here</p>'));
	// A path out of the project is never asked for, and neither is a file of the wrong kind.
	assert.deepEqual(built.requested.sort(), ['site/missing.css', 'site/ok.png']);
});

test('each bound stops further resources and says so', async () => {
	const files = { 'site/a.png': new Uint8Array(10), 'site/b.png': new Uint8Array(10), 'site/c.png': new Uint8Array(10) };
	const page = '<img src="a.png"><img src="b.png"><img src="c.png">';

	const count = await build(page, files, { limits: { maxResources: 2 } });
	assert.equal(count.incomplete, true);
	assert.deepEqual(count.requested.sort(), ['site/a.png', 'site/b.png']);
	assert.ok(count.body.endsWith('<img src="c.png">'));

	const total = await build(page, files, { limits: { maxTotalBytes: 25 } });
	assert.equal(total.incomplete, true);
	assert.equal((total.body.match(/data:image\/png/gu) ?? []).length, 2);
	assert.equal((total.body.match(/src="[abc]\.png"/gu) ?? []).length, 1);

	const each = await build(page, { ...files, 'site/b.png': new Uint8Array(11) }, { limits: { maxResourceBytes: 10 } });
	assert.equal(each.incomplete, true);
	assert.ok(each.body.includes('<img src="b.png">'));
	assert.equal((each.body.match(/data:image\/png/gu) ?? []).length, 2);

	const many: Record<string, Uint8Array> = {};
	for (let index = 0; index < 20; index += 1) many[`site/${index}.png`] = new Uint8Array(1);
	const busy = await build(Object.keys(many).map((path) => `<img src="/${path}">`).join(''), many, {
		limits: { readConcurrency: 3 },
	});
	assert.equal(busy.incomplete, false);
	assert.equal(busy.mostAtOnce(), 3);

	const within = await build(page, files);
	assert.equal(within.incomplete, false);
});

test('what would re-root the page, narrow its policy, or navigate it is removed', async () => {
	const built = await build(
		'<head><base href="https://example.com/"><META HTTP-EQUIV="Refresh" content="0;url=https://example.com">' +
			'<meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><meta charset="utf-8">' +
			'<meta name="viewport" content="width=device-width"></head><img src="a.png">',
		{ 'site/a.png': new Uint8Array([1]) },
	);
	assert.equal(
		built.body,
		'<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><img src="data:image/png;base64,AQ==">',
	);
});

test('a second build reads nothing it already has, and asks again for what was missing', async () => {
	const cache: HtmlPreviewCache = new Map();
	const files: Record<string, string> = { 'site/style.css': '.a{}' };
	const source = project(files);
	const page = '<link rel="stylesheet" href="style.css"><script src="late.js"></script>';
	const input = { baseDirectory: 'site', read: source.read, cache };
	const first = await buildHtmlPreviewDocument({ html: page, ...input });
	assert.equal(first.incomplete, true);
	assert.deepEqual(source.requested.sort(), ['site/late.js', 'site/style.css']);
	files['site/late.js'] = '1';
	const second = await buildHtmlPreviewDocument({ html: `${page}<p>edited</p>`, ...input });
	assert.equal(second.incomplete, false);
	assert.deepEqual(source.requested.sort(), ['site/late.js', 'site/late.js', 'site/style.css']);
	const third = await buildHtmlPreviewDocument({ html: `${page}<p>again</p>`, ...input });
	assert.equal(third.incomplete, false);
	assert.equal(source.requested.length, 3);
});
