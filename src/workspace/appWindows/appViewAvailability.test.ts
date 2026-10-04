import assert from 'node:assert/strict';
import test from 'node:test';
import { appViewProxyUrl, probeAppView } from './appViewAvailability.ts';

function environment() {
	const listeners = new Set<(event: { source: unknown; data: unknown }) => void>();
	const timers: (() => void)[] = [];
	const frame = {
		contentWindow: { proxy: true },
		attributes: {} as Record<string, string>,
		removed: false,
		src: '',
		style: { cssText: '' },
		setAttribute(name: string, value: string) { this.attributes[name] = value; },
		remove() { this.removed = true; },
	};
	return {
		frame,
		emit: (source: unknown, data: unknown) => { for (const listener of [...listeners]) listener({ source, data }); },
		expire: () => { for (const timer of timers.splice(0)) timer(); },
		listenerCount: () => listeners.size,
		env: {
			createFrame: () => frame,
			mount: () => {},
			onMessage: (listener: (event: { source: unknown; data: unknown }) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
			setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
			clearTimeout: () => {},
			proxyUrl: 'https://server.example/app-view.html',
		},
	};
}

test('the proxy sits beside the workspace document on every host', () => {
	assert.equal(appViewProxyUrl('file:///Applications/Terminay.app/ui/server.html'), 'file:///Applications/Terminay.app/ui/app-view.html');
	assert.equal(appViewProxyUrl('http://127.0.0.1:4317/'), 'http://127.0.0.1:4317/app-view.html');
	assert.equal(appViewProxyUrl('https://abc.terminay.com/v1/'), 'https://abc.terminay.com/v1/app-view.html');
});

test('a proxy that answers makes app windows available, and the probe cleans up', async () => {
	const { frame, emit, env, listenerCount } = environment();
	const probing = probeAppView(env);
	assert.equal(frame.attributes.sandbox, 'allow-scripts allow-forms');
	assert.equal(frame.src, 'https://server.example/app-view.html');
	emit(frame.contentWindow, { jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} });
	assert.equal(await probing, true);
	assert.equal(frame.removed, true);
	assert.equal(listenerCount(), 0);
});

test('a proxy that never answers makes app windows unavailable', async () => {
	const { frame, env, expire, listenerCount } = environment();
	const probing = probeAppView(env);
	expire();
	assert.equal(await probing, false);
	assert.equal(frame.removed, true);
	assert.equal(listenerCount(), 0);
});

test('a ready message from any other frame does not count', async () => {
	const { frame, emit, env, expire } = environment();
	const probing = probeAppView(env);
	emit({ someone: 'else' }, { method: 'ui/notifications/sandbox-proxy-ready' });
	emit(frame.contentWindow, { method: 'something-else' });
	emit(frame.contentWindow, null);
	expire();
	assert.equal(await probing, false);
});

test('a host that refuses to mount the frame is unavailable', async () => {
	const { env } = environment();
	assert.equal(await probeAppView({ ...env, mount: () => { throw new Error('blocked'); } }), false);
});
