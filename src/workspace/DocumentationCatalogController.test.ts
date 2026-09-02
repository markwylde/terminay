import assert from 'node:assert/strict';
import test from 'node:test';
import type {
	DocumentationCatalog,
	DocumentationClient,
	FileObservationClient,
	FileWatchEvent,
	FileWatchHandle,
} from '@terminay/client-core';
import { DocumentationCatalogController } from './DocumentationCatalogController.ts';

function catalog(
	documents: DocumentationCatalog['documents'],
	extra: Partial<DocumentationCatalog> = {},
): DocumentationCatalog {
	return {
		revision: extra.revision ?? `r-${documents.map((document) => document.relativePath).join(',')}`,
		scannedEntries: documents.length,
		scannedFiles: documents.length,
		partial: extra.partial ?? false,
		observationCapability: extra.observationCapability ?? 'watching',
		folders: extra.folders ?? [],
		documents,
		...extra,
	};
}

function document(relativePath: string, title = relativePath): DocumentationCatalog['documents'][number] {
	return {
		kind: 'document',
		relativePath,
		extension: relativePath.endsWith('.mdx') ? 'mdx' : 'md',
		title,
		titleSource: 'filename',
	};
}

function fakeClient(
	responses: Array<DocumentationCatalog | Error>,
): DocumentationClient & { readonly calls: unknown[] } {
	const calls: unknown[] = [];
	return {
		calls,
		async catalog(_projectId, request) {
			calls.push(request ?? {});
			const next = responses.shift();
			if (next instanceof Error) throw next;
			if (next === undefined) throw new Error('unexpected catalog request');
			return next;
		},
	} as DocumentationClient & { readonly calls: unknown[] };
}

test('ordinary watch events coalesce one refresh and keep the last good tree', async () => {
	const timers: Array<{ id: number; callback: () => void }> = [];
	let nextId = 1;
	const client = fakeClient([
		catalog([document('README.md')]),
		catalog([document('README.md'), document('guide.md', 'Guide')]),
	]);
	const controller = new DocumentationCatalogController({
		client,
		projectId: 'project-a',
		scopeKey: '/project',
		delayMs: 20,
		setTimeoutFn: (callback) => {
			const id = nextId++;
			timers.push({ id, callback });
			return id;
		},
		clearTimeoutFn: (id) => {
			const index = timers.findIndex((timer) => timer.id === id);
			if (index >= 0) timers.splice(index, 1);
		},
	});
	controller.refresh('immediate');
	await Promise.resolve();
	assert.equal(controller.snapshot.catalog?.documents.length, 1);
	controller.handleWatchEvent({ kind: 'changed' });
	controller.handleWatchEvent({ kind: 'created' });
	assert.equal(timers.length, 1);
	assert.equal(controller.snapshot.catalog?.documents[0].relativePath, 'README.md');
	timers[0]?.callback();
	await Promise.resolve();
	assert.equal(controller.snapshot.catalog?.documents.length, 2);
	controller.dispose();
});

test('overflow or resync fetches a fresh catalog without knownRevision', async () => {
	const client = fakeClient([
		catalog([document('README.md')], { revision: 'r1' }),
		catalog([document('other.md')], { revision: 'r2' }),
	]);
	const controller = new DocumentationCatalogController({
		client,
		projectId: 'project-a',
		scopeKey: '/project',
		delayMs: 5,
		setTimeoutFn: (callback) => {
			callback();
			return 1;
		},
		clearTimeoutFn() {},
	});
	controller.refresh('immediate');
	await Promise.resolve();
	controller.handleWatchEvent({ kind: 'resync' });
	await Promise.resolve();
	assert.deepEqual(client.calls[1], {});
	assert.equal(controller.snapshot.catalog?.documents[0].relativePath, 'other.md');
	controller.dispose();
});

test('stale catalog responses are rejected', async () => {
	let resolveSlow: ((value: DocumentationCatalog) => void) | undefined;
	let calls = 0;
	const client = {
		async catalog() {
			calls += 1;
			if (calls === 1) {
				return new Promise<DocumentationCatalog>((resolve) => {
					resolveSlow = resolve;
				});
			}
			return catalog([document('fresh.md')], { revision: 'fresh' });
		},
	} as unknown as DocumentationClient;
	const controller = new DocumentationCatalogController({
		client,
		projectId: 'project-a',
		scopeKey: '/project',
	});
	controller.refresh('immediate');
	controller.refresh('fresh');
	await Promise.resolve();
	resolveSlow?.(catalog([document('stale.md')], { revision: 'stale' }));
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(controller.snapshot.catalog?.documents[0].relativePath, 'fresh.md');
	controller.dispose();
});

test('dispose cancels timers and watch subscriptions', async () => {
	const stopped: string[] = [];
	let timeoutId: number | undefined;
	const observationClient = {
		async startWatch() {
			return { subscriptionId: 'watch-1', projectId: 'project-a', resource: '', cursor: 0 };
		},
		async readWatch() {
			return { subscriptionId: 'watch-1', cursor: 0, events: [], resyncRequired: false };
		},
		async stopWatch(id: string) {
			stopped.push(id);
		},
		async subscribeWatch(_handle: FileWatchHandle, _listener: (event: FileWatchEvent) => void) {
			return () => {
				stopped.push('unsubscribe');
			};
		},
	} as unknown as FileObservationClient;
	const controller = new DocumentationCatalogController({
		client: fakeClient([catalog([document('README.md')])]),
		observationClient,
		projectId: 'project-a',
		scopeKey: '/project',
		setTimeoutFn: (_callback) => {
			timeoutId = 7;
			return 7;
		},
		clearTimeoutFn: (id) => {
			if (id === timeoutId) timeoutId = undefined;
		},
	});
	await controller.start();
	controller.handleWatchEvent({ kind: 'changed' });
	assert.equal(timeoutId, 7);
	controller.dispose();
	assert.equal(timeoutId, undefined);
	assert.deepEqual(stopped, ['unsubscribe', 'watch-1']);
});

test('refresh failure keeps the last good tree and recovers', async () => {
	const client = fakeClient([
		catalog([document('README.md')]),
		new Error('temporary failure'),
		catalog([document('README.md'), document('guide.md')]),
	]);
	const controller = new DocumentationCatalogController({
		client,
		projectId: 'project-a',
		scopeKey: '/project',
	});
	controller.refresh('immediate');
	await Promise.resolve();
	controller.refresh('fresh');
	await Promise.resolve();
	assert.equal(controller.snapshot.catalog?.documents.length, 1);
	assert.equal(controller.snapshot.error, 'temporary failure');
	controller.refresh('fresh');
	await Promise.resolve();
	assert.equal(controller.snapshot.catalog?.documents.length, 2);
	assert.equal(controller.snapshot.error, undefined);
	controller.dispose();
});

test('expansion and selection survive a catalog refresh', async () => {
	const controller = new DocumentationCatalogController({
		client: fakeClient([
			catalog([document('docs/guide.md')], {
				folders: [{ kind: 'folder', relativePath: 'docs', title: 'Docs' }],
			}),
			catalog([document('docs/guide.md'), document('docs/api.md')], {
				folders: [{ kind: 'folder', relativePath: 'docs', title: 'Docs' }],
			}),
		]),
		projectId: 'project-a',
		scopeKey: '/project',
		expandedFolderIds: ['docs'],
	});
	controller.refresh('immediate');
	await Promise.resolve();
	controller.select('docs/guide.md');
	controller.refresh('fresh');
	await Promise.resolve();
	assert.equal(controller.snapshot.selectedPath, 'docs/guide.md');
	assert.equal(controller.snapshot.expandedFolders.has('docs'), true);
	controller.dispose();
});
