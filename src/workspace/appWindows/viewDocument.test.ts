import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildViewDocument,
	inertJsonLiteral,
	viewAllowAttribute,
	viewContentSecurityPolicy,
} from './viewDocument.ts';

const directive = (policy: string, name: string): string | undefined =>
	policy
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name} `));

test('an agent-authored view may load from and connect to any https origin', () => {
	const policy = viewContentSecurityPolicy({ kind: 'agent' });
	assert.equal(directive(policy, 'default-src'), "default-src 'none'");
	assert.equal(directive(policy, 'script-src'), "script-src 'unsafe-inline' https: blob:");
	assert.equal(directive(policy, 'connect-src'), 'connect-src https: wss:');
	assert.equal(directive(policy, 'object-src'), "object-src 'none'");
	assert.equal(directive(policy, 'form-action'), "form-action 'none'");
	// Whatever an agent passes as csp is ignored: its policy is fixed.
	assert.equal(
		viewContentSecurityPolicy({ kind: 'agent' }, { connectDomains: ['https://x.example'] }),
		policy,
	);
});

test('an MCP App with declared domains gets exactly those origins', () => {
	const policy = viewContentSecurityPolicy(
		{ kind: 'mcp-app' },
		{
			connectDomains: ['https://api.example', 'wss://live.example:8443'],
			resourceDomains: ['https://cdn.example'],
			frameDomains: ['https://embed.example'],
		},
	);
	assert.equal(directive(policy, 'connect-src'), 'connect-src https://api.example wss://live.example:8443');
	assert.equal(directive(policy, 'script-src'), "script-src 'unsafe-inline' https://cdn.example");
	assert.equal(directive(policy, 'img-src'), 'img-src data: blob: https://cdn.example');
	assert.equal(directive(policy, 'frame-src'), 'frame-src https://embed.example');
	assert.equal(directive(policy, 'base-uri'), "base-uri 'none'");
});

test('an MCP App that declares nothing may reach nothing', () => {
	const policy = viewContentSecurityPolicy({ kind: 'mcp-app' });
	assert.equal(directive(policy, 'connect-src'), "connect-src 'none'");
	assert.equal(directive(policy, 'frame-src'), "frame-src 'none'");
	assert.equal(directive(policy, 'script-src'), "script-src 'unsafe-inline'");
	assert.equal(directive(policy, 'img-src'), 'img-src data: blob:');
});

test('a declared value cannot inject a directive, a keyword, or another scheme', () => {
	const policy = viewContentSecurityPolicy(
		{ kind: 'mcp-app' },
		{
			connectDomains: [
				"https://ok.example; script-src *",
				"'unsafe-eval'",
				'*',
				'http://plain.example',
				'https://ok.example',
				'data:',
				'https://a.example https://b.example',
				'https://*.wild.example',
			],
		},
	);
	assert.equal(
		directive(policy, 'connect-src'),
		'connect-src https://ok.example https://*.wild.example',
	);
	assert.equal(policy.split('script-src').length, 2);
});

test('the policy is the first thing in the document, ahead of the author’s markup', () => {
	const built = buildViewDocument({
		html: '<html><head><script>window.early = 1</script></head><body>hi</body></html>',
		source: { kind: 'mcp-app' },
	});
	const meta = built.html.indexOf('http-equiv="Content-Security-Policy"');
	assert.ok(meta > 0 && meta < built.html.indexOf('window.early'));
	assert.ok(built.html.startsWith('<!doctype html><meta'));
	// An MCP App speaks the protocol itself: nothing else is injected.
	assert.equal(built.html.includes('window, \'terminay\''), false);
	assert.equal(built.html.includes('<style>'), false);
});

test('an existing doctype stays first so the view is not in quirks mode', () => {
	const built = buildViewDocument({
		html: '  <!DOCTYPE html>\n<html><body>hi</body></html>',
		source: { kind: 'mcp-app' },
	});
	assert.ok(built.html.startsWith('  <!DOCTYPE html><meta http-equiv'));
	assert.equal(built.html.match(/<!doctype/giu)?.length, 1);
});

test('an agent-authored view gets the bootstrap before its own content', () => {
	const built = buildViewDocument({ html: '<h1>Hello world</h1>', source: { kind: 'agent' } });
	const bootstrap = built.html.indexOf("'terminay'");
	assert.ok(bootstrap > 0 && bootstrap < built.html.indexOf('<h1>Hello world</h1>'));
	assert.match(built.html, /ui\/initialize/u);
	assert.match(built.html, /ui\/notifications\/size-changed/u);
	assert.match(built.html, /sendMessage/u);
	assert.equal(built.allow, '');
});

test('the policy attribute cannot be closed by a declared value', () => {
	const built = buildViewDocument({
		html: '<p>x</p>',
		source: { kind: 'mcp-app' },
		csp: { connectDomains: ['https://ok.example"><script>alert(1)</script>'] },
	});
	assert.equal(built.html.includes('<script>alert(1)</script>'), false);
});

test('only an MCP App may be granted the permissions its resource asked for', () => {
	assert.equal(
		viewAllowAttribute({ kind: 'mcp-app' }, { clipboardWrite: {}, camera: {}, usb: {} }),
		'camera; clipboard-write',
	);
	assert.equal(viewAllowAttribute({ kind: 'mcp-app' }, undefined), '');
	assert.equal(viewAllowAttribute({ kind: 'agent' }, { camera: {} }), '');
});

test("window data reaches an agent-authored document as a value and never as markup or code", () => {
	const hostile = {
		markup: '</script><script>alert(1)</script><!--',
		separators: 'a\u2028b\u2029c',
		entity: '&lt;',
		__proto__: { polluted: true },
		nested: [1, { deep: 'x' }],
	};
	const literal = inertJsonLiteral(hostile);
	assert.ok(literal !== undefined);
	for (const forbidden of ['<', '>', '&', '\u2028', '\u2029'])
		assert.ok(!literal.includes(forbidden), `literal contains ${JSON.stringify(forbidden)}`);
	// Evaluated as script, it is exactly the value that was given.
	const value = new Function(`return ${literal}`)() as typeof hostile;
	assert.deepEqual(JSON.parse(JSON.stringify(value)), JSON.parse(JSON.stringify(hostile)));
	assert.equal(({} as { polluted?: boolean }).polluted, undefined);
	assert.equal(Object.getPrototypeOf(value), Object.prototype);

	const built = buildViewDocument({
		html: '<!doctype html><script>document.title = String(window.terminay.data.nested.length)</script>',
		source: { kind: 'agent' },
		data: hostile,
	});
	// The data is in scope of the bootstrap, ahead of the author's script.
	const dataAt = built.html.indexOf('const terminayData=JSON.parse(');
	assert.ok(dataAt > 0);
	assert.ok(dataAt < built.html.indexOf('document.title'));
	// Nothing in the data closed the bootstrap's script element early.
	assert.ok(!built.html.includes('<script>alert(1)'));
	assert.equal(built.html.split('</script>').length, buildViewDocument({ html: '<!doctype html><script>document.title = String(window.terminay.data.nested.length)</script>', source: { kind: 'agent' } }).html.split('</script>').length);
});

test('a document without data, and an MCP App view, get no data in scope', () => {
	assert.ok(!buildViewDocument({ html: '<p>x</p>', source: { kind: 'agent' } }).html.includes('terminayData='));
	assert.ok(!buildViewDocument({ html: '<p>x</p>', source: { kind: 'mcp-app' }, data: { a: 1 } }).html.includes('terminayData'));
	assert.equal(inertJsonLiteral(undefined), undefined);
	assert.equal(inertJsonLiteral(() => 1), undefined);
	assert.equal(inertJsonLiteral(null), 'JSON.parse("null")');
});

test('an agent-authored view is told whether a message may carry files, and an MCP App view is not', () => {
	const offered = buildViewDocument({ html: '<p>x</p>', source: { kind: 'agent' }, attachments: true }).html;
	assert.ok(offered.includes('const terminayAttachments=true;'));
	const both = buildViewDocument({ html: '<p>x</p>', source: { kind: 'agent' }, attachments: true, data: { a: 1 } }).html;
	assert.ok(both.includes('const terminayData=JSON.parse('));
	assert.ok(both.includes('const terminayAttachments=true;'));
	assert.ok(!buildViewDocument({ html: '<p>x</p>', source: { kind: 'agent' } }).html.includes('terminayAttachments=true'));
	assert.ok(!buildViewDocument({ html: '<p>x</p>', source: { kind: 'agent' }, attachments: false }).html.includes('terminayAttachments=true'));
	assert.ok(!buildViewDocument({ html: '<p>x</p>', source: { kind: 'mcp-app' }, attachments: true }).html.includes('terminayAttachments'));
});

test('a previewed project file may reach nothing and cannot widen that', () => {
	const expected =
		"default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; " +
		"img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; " +
		"frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; webrtc 'block'";
	assert.equal(viewContentSecurityPolicy({ kind: 'file' }), expected);
	// Declared origins belong to an MCP App's resource; a file has none to give.
	assert.equal(
		viewContentSecurityPolicy(
			{ kind: 'file' },
			{
				resourceDomains: ['https://cdn.example.com'],
				connectDomains: ['https://api.example.com'],
				frameDomains: ['https://frames.example.com'],
				baseUriDomains: ['https://base.example.com'],
			},
		),
		expected,
	);
	assert.equal(
		viewAllowAttribute({ kind: 'file' }, { camera: {}, microphone: {}, clipboardWrite: {} }),
		'',
	);
});

test('a previewed project file gets the policy first, its own link handling, and no mirror loader', () => {
	const built = buildViewDocument({
		html: '<!DOCTYPE html><html><head><title>t</title></head><body>hi</body></html>',
		source: { kind: 'file' },
		permissions: { camera: {} },
	});
	assert.equal(built.allow, '');
	assert.ok(
		built.html.startsWith(
			'<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'',
		),
	);
	assert.ok(built.html.includes("method: 'ui/open-link'"));
	assert.ok(built.html.includes("terminayPreview: 'ready'"));
	// A relative link would resolve against the workspace's own origin.
	assert.ok(built.html.includes('if (!/^https?:\\/\\//i.test(raw)) return;'));
	assert.equal(built.html.includes('terminayMirror'), false);
	assert.ok(built.html.endsWith('<body>hi</body></html>'));
});
