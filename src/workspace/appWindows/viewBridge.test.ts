import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AppViewBridge,
	type ViewBridgeContent,
	type ViewBridgeHost,
	type ViewHostContext,
} from './viewBridge.ts';

const context: ViewHostContext = {
	displayMode: 'pip',
	platform: 'desktop',
	touch: false,
	width: 440,
	maxHeight: 388,
	theme: 'dark',
	variables: { '--color-text-primary': '#fff' },
};

function setup(content: Partial<ViewBridgeContent> = {}, overrides: Partial<ViewBridgeHost> = {}) {
	// biome-ignore lint/suspicious/noExplicitAny: messages are inspected loosely
	const posted: any[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: calls are inspected loosely
	const calls: any[] = [];
	let current = context;
	const host: ViewBridgeHost = {
		post: (message) => posted.push(message),
		context: () => current,
		resized: (height) => calls.push(['resized', height]),
		sendMessage: async (text) => void calls.push(['sendMessage', text]),
		updateContext: async (text) => void calls.push(['updateContext', text]),
		viewRequest: async (method, params) => {
			calls.push(['viewRequest', method, params]);
			return { content: [{ type: 'text', text: 'ok' }] };
		},
		openLink: (url) => calls.push(['openLink', url]),
		requestDisplayMode: (mode) => {
			calls.push(['displayMode', mode]);
			return mode;
		},
		close: () => calls.push(['close']),
		...overrides,
	};
	const bridge = new AppViewBridge(
		{ html: '<p>view</p>', allow: '', source: 'mcp-app', toolInput: { shape: 'circle' }, tool: { name: 'draw' }, ...content },
		host,
	);
	const send = (method: string, params?: unknown, id?: number) =>
		bridge.handle({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }), ...(id === undefined ? {} : { id }) });
	return { bridge, posted, calls, send, setContext: (next: ViewHostContext) => { current = next; } };
}

test('the proxy is given the view document once, and never a second time', async () => {
	const { posted, send } = setup();
	await send('ui/notifications/sandbox-proxy-ready', {});
	assert.deepEqual(posted, [
		{ jsonrpc: '2.0', method: 'ui/notifications/sandbox-resource-ready', params: { html: '<p>view</p>', allow: '' } },
	]);
	await send('ui/notifications/sandbox-proxy-ready', {});
	assert.equal(posted.length, 1);
});

test('initialise answers with the host context, and the view then gets its tool input and result', async () => {
	const { posted, send } = setup({ toolResult: { content: [{ type: 'text', text: 'drawn' }] } });
	await send('ui/initialize', { protocolVersion: '2026-01-26' }, 1);
	const init = posted[0];
	assert.equal(init.id, 1);
	assert.equal(init.result.protocolVersion, '2026-01-26');
	assert.deepEqual(init.result.hostCapabilities, { openLinks: {}, logging: {}, serverTools: {}, serverResources: {} });
	assert.equal(init.result.hostContext.displayMode, 'pip');
	assert.equal(init.result.hostContext.platform, 'desktop');
	assert.deepEqual(init.result.hostContext.containerDimensions, { width: 440, maxHeight: 388 });
	assert.deepEqual(init.result.hostContext.toolInfo, { tool: { name: 'draw' } });
	assert.deepEqual(init.result.hostContext.styles.variables, { '--color-text-primary': '#fff' });
	// Nothing is sent to the view before it says it is initialised.
	assert.equal(posted.length, 1);
	await send('ui/notifications/initialized', {});
	assert.deepEqual(posted.slice(1), [
		{ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { shape: 'circle' } } },
		{ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'drawn' }] } },
	]);
});

test('a result that arrives later is delivered once; a failed call tells the view it was cancelled', async () => {
	const base = { html: '<p>view</p>', allow: '', source: 'mcp-app' as const };
	const late = setup();
	await late.send('ui/notifications/initialized', {});
	assert.equal(late.posted.length, 1);
	late.bridge.updateContent({ ...base, toolResult: { ok: true } });
	late.bridge.updateContent({ ...base, toolResult: { ok: true } });
	assert.deepEqual(late.posted.slice(1), [{ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { ok: true } }]);

	const failed = setup();
	await failed.send('ui/notifications/initialized', {});
	failed.bridge.updateContent({ ...base, toolCancelled: 'upstream failed' });
	failed.bridge.updateContent({ ...base, toolCancelled: 'upstream failed' });
	assert.deepEqual(failed.posted.slice(1), [{ jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled', params: { reason: 'upstream failed' } }]);
});

test('an agent-authored view is not told about tools and cannot call them', async () => {
	const { posted, calls, send } = setup({ source: 'agent', tool: undefined, toolInput: undefined });
	await send('ui/initialize', {}, 1);
	assert.deepEqual(posted[0].result.hostCapabilities, { openLinks: {}, logging: {} });
	await send('ui/notifications/initialized', {});
	assert.equal(posted.length, 1);
	await send('tools/call', { name: 'anything', arguments: {} }, 2);
	assert.equal(posted[1].error.code, -32601);
	assert.deepEqual(calls, []);
});

test('size reports reach the host only when they are sane', async () => {
	const { calls, send } = setup();
	await send('ui/notifications/size-changed', { width: 440, height: 262.4 });
	await send('ui/notifications/size-changed', { height: 0 });
	await send('ui/notifications/size-changed', { height: -5 });
	await send('ui/notifications/size-changed', { height: 'tall' });
	await send('ui/notifications/size-changed', { height: Number.POSITIVE_INFINITY });
	assert.deepEqual(calls, [['resized', 263]]);
});

test('a message is passed on as text and a refusal is reported to the view', async () => {
	const ok = setup();
	await ok.send('ui/message', { role: 'user', content: { type: 'text', text: 'Deploy api' } }, 3);
	assert.deepEqual(ok.calls, [['sendMessage', 'Deploy api']]);
	assert.deepEqual(ok.posted, [{ jsonrpc: '2.0', id: 3, result: {} }]);

	const refused = setup({}, { sendMessage: async () => { throw new Error('Window Messages is set to Never Allow'); } });
	await refused.send('ui/message', { role: 'user', content: { type: 'text', text: 'hi' } }, 4);
	assert.equal(refused.posted[0].error.code, -32000);
	assert.match(refused.posted[0].error.message, /Never Allow/u);

	const bad = setup();
	await bad.send('ui/message', { content: { type: 'image', data: 'x' } }, 5);
	await bad.send('ui/message', { content: { type: 'text', text: '' } }, 6);
	await bad.send('ui/message', { content: { type: 'text', text: 'x'.repeat(16 * 1024 + 1) } }, 7);
	assert.deepEqual(bad.calls, []);
	assert.deepEqual(bad.posted.map((message) => message.error.code), [-32602, -32602, -32602]);
});

test('model context is flattened to text, from blocks or structured content', async () => {
	const { calls, send } = setup();
	await send('ui/update-model-context', { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }, 1);
	await send('ui/update-model-context', { structuredContent: { region: 'eu' } }, 2);
	await send('ui/update-model-context', {}, 3);
	assert.deepEqual(calls, [['updateContext', 'one\ntwo'], ['updateContext', '{"region":"eu"}']]);
});

test('only http and https links are opened', async () => {
	const { posted, calls, send } = setup();
	await send('ui/open-link', { url: 'https://example.com/docs' }, 1);
	for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'terminay://x', 'not a url', 7])
		await send('ui/open-link', { url }, 2);
	assert.deepEqual(calls, [['openLink', 'https://example.com/docs']]);
	assert.equal(posted.filter((message) => message.error?.message === 'Invalid URL').length, 5);
});

test('an MCP App view reaches its own server through the host', async () => {
	const { posted, calls, send } = setup();
	await send('tools/call', { name: 'poll', arguments: {} }, 9);
	await send('resources/read', { uri: 'ui://diagrams/extra' }, 10);
	assert.deepEqual(calls, [
		['viewRequest', 'tools/call', { name: 'poll', arguments: {} }],
		['viewRequest', 'resources/read', { uri: 'ui://diagrams/extra' }],
	]);
	assert.deepEqual(posted[0], { jsonrpc: '2.0', id: 9, result: { content: [{ type: 'text', text: 'ok' }] } });
});

test('a display mode request is answered with the mode actually in effect', async () => {
	const { posted, send } = setup({}, { requestDisplayMode: () => 'pip' });
	await send('ui/request-display-mode', { mode: 'fullscreen' }, 1);
	assert.deepEqual(posted, [{ jsonrpc: '2.0', id: 1, result: { mode: 'pip' } }]);
});

test('only an agent-authored view may ask to be closed', async () => {
	const agent = setup({ source: 'agent' });
	await agent.send('ui/request-close', {}, 1);
	assert.deepEqual(agent.calls, [['close']]);
	const app = setup();
	await app.send('ui/request-close', {}, 1);
	assert.deepEqual(app.calls, []);
	assert.equal(app.posted[0].error.code, -32601);
});

test('an unknown method gets method-not-found and nothing else happens', async () => {
	const { posted, calls, send } = setup();
	await send('workspace/run-command', { command: 'rm -rf /' }, 1);
	await send('terminal.input', { data: 'x' }, 2);
	await send('ui/notifications/made-up', {});
	assert.deepEqual(calls, []);
	assert.deepEqual(posted.map((message) => message.error?.code), [-32601, -32601]);
});

test('anything that is not a JSON-RPC message is ignored', async () => {
	const { bridge, posted, calls } = setup();
	for (const junk of [null, 'ui/message', 42, [], { method: 'ui/message' }, { jsonrpc: '1.0', method: 'ping', id: 1 }, { jsonrpc: '2.0', method: 7, id: 1 }, { jsonrpc: '2.0', method: 'ping', id: {} }])
		await bridge.handle(junk);
	assert.deepEqual(posted, []);
	assert.deepEqual(calls, []);
});

test('the view is told when its container changes, once per change, and only after it initialised', async () => {
	const { bridge, posted, send, setContext } = setup();
	const narrow: ViewHostContext = { ...context, platform: 'mobile', touch: true, width: 390 };
	setContext(narrow);
	bridge.contextChanged();
	assert.equal(posted.length, 0);
	setContext(context);
	await send('ui/notifications/initialized', {});
	posted.length = 0;
	bridge.contextChanged();
	assert.equal(posted.length, 0);
	setContext(narrow);
	bridge.contextChanged();
	bridge.contextChanged();
	assert.equal(posted.length, 1);
	assert.equal(posted[0].method, 'ui/notifications/host-context-changed');
	assert.equal(posted[0].params.platform, 'mobile');
	assert.deepEqual(posted[0].params.containerDimensions, { width: 390, maxHeight: 388 });
	setContext({ ...narrow, displayMode: 'fullscreen', height: 640, maxHeight: undefined });
	bridge.contextChanged();
	assert.deepEqual(posted[1].params.containerDimensions, { width: 390, height: 640 });
});

test('teardown is announced to an initialised view', async () => {
	const { bridge, posted, send } = setup();
	bridge.teardown('closed');
	assert.equal(posted.length, 0);
	await send('ui/notifications/initialized', {});
	posted.length = 0;
	bridge.teardown('closed by user');
	assert.equal(posted[0].method, 'ui/resource-teardown');
	assert.deepEqual(posted[0].params, { reason: 'closed by user' });
	assert.equal(typeof posted[0].id, 'string');
});

test('links are opened one at a time, not in a burst', async () => {
	const { send, calls, posted } = setup();
	for (let index = 0; index < 5; index += 1) await send('ui/open-link', { url: `https://example.com/${index}` }, index);
	assert.deepEqual(calls, [['openLink', 'https://example.com/0']]);
	assert.equal(posted.filter((message) => message.error !== undefined).length, 4);
});
