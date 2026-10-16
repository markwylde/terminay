import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowseRootFoldersResult } from '@terminay/client-core';
import {
	featureProjectRoot,
	resolveFeatureProjectRoot,
	resolveProjectFeatureAuthority,
	rootScopedFeatureAuthority,
} from '../shared/featureQueryAuthority.ts';
import { newProjectCreateRequest } from './projectCreationRequest.ts';
import {
	childFolderPath,
	chooserFocusMove,
	commitStartChoice,
	folderName,
	openProjectWithRoot,
	projectAwaitsStartChoice,
	projectHasNoRoot,
	recentFolderRows,
	startRefusalMessage,
} from './projectStart.ts';
import {
	folderSuggestions,
	RootFolderCompleter,
	splitTypedFolderPath,
	suggestionHighlightMove,
} from './rootFolderCompletion.ts';
import { RootFolderNavigator, type RootFolderListing } from './rootFolderNavigator.ts';
import { normalizeProjectRoot } from './useProjectEditor.ts';

type Project = Record<string, unknown>;

function project(id: string, fields: Project = {}): Project {
	return {
		id,
		serverId: 'server-a',
		name: id,
		root: `/work/${id}`,
		rootOrigin: 'explicit',
		viewId: 'view-1',
		panelIds: [],
		...fields,
	};
}

function snapshot(projects: Record<string, Project>) {
	return {
		serverId: 'server-a',
		revision: 4,
		cursor: '4',
		projects,
		views: {},
		viewOrder: [],
		panels: {},
		terminalSessions: {},
	} as never;
}

/** A refusal as the client carries it: a typed reason in its details. */
function refusal(reason: string, message = `refused: ${reason}`) {
	return Object.assign(new Error(message), {
		name: 'ClientError',
		code: 'conflict',
		details: { reason },
	});
}

test('a new project is created with no root, whatever rooted projects are open', () => {
	const request = newProjectCreateRequest({
		projectId: 'project-new',
		viewId: 'view-1',
		color: '#7c5cff',
		icon: '',
	});
	assert.equal('root' in request, false);
	assert.deepEqual(request, {
		projectId: 'project-new',
		viewId: 'view-1',
		color: '#7c5cff',
		icon: '',
	});
});

test('the disconnected creation path carries its sidebar and still no inherited root', () => {
	const request = newProjectCreateRequest({
		projectId: 'project-new',
		viewId: 'view-1',
		color: '#7c5cff',
		icon: '',
		sidebar: { isFileExplorerOpen: false } as never,
	});
	assert.equal('root' in request, false);
	assert.deepEqual(request.sidebar, { isFileExplorerOpen: false });
});

test('a project awaits its start choice only when the server says so', () => {
	const state = snapshot({
		waiting: project('waiting', { root: '', rootOrigin: 'none', start: 'awaiting-choice' }),
		homed: project('homed', { root: '', rootOrigin: 'none' }),
		rooted: project('rooted'),
	});
	assert.equal(projectAwaitsStartChoice(state, 'waiting'), true);
	assert.equal(projectAwaitsStartChoice(state, 'homed'), false);
	assert.equal(projectAwaitsStartChoice(state, 'rooted'), false);
	assert.equal(projectAwaitsStartChoice(null, 'waiting'), false);
	assert.equal(projectHasNoRoot(state, 'homed'), true);
	assert.equal(projectHasNoRoot(state, 'waiting'), false, 'awaiting is not started');
	assert.equal(projectHasNoRoot(state, 'rooted'), false);
});

test('a start choice that loses to another client shows the project as the server holds it', async () => {
	// The server took another client's folder first.
	let held = snapshot({
		p1: project('p1', { root: '', rootOrigin: 'none', start: 'awaiting-choice' }),
	});
	const calls: string[] = [];
	const store = {
		get snapshot() {
			return held;
		},
		async startProject() {
			calls.push('start');
			throw refusal('start_conflict', 'project start choice was already made');
		},
		async refresh() {
			calls.push('refresh');
			held = snapshot({ p1: project('p1', { root: '/work/won' }) });
			return held;
		},
	};
	const outcome = await commitStartChoice(store as never, 'p1', { kind: 'home' });
	assert.deepEqual(outcome, { kind: 'conflict' });
	assert.deepEqual(calls, ['start', 'refresh']);
	// The chooser is gone: the project is shown started, with the winner's root.
	assert.equal(projectAwaitsStartChoice(store.snapshot, 'p1'), false);
	assert.equal((store.snapshot as { projects: Record<string, Project> }).projects.p1.root, '/work/won');
});

test('a refused folder leaves the project awaiting and names why', async () => {
	const store = {
		async startProject() {
			throw refusal('path_missing');
		},
		async refresh() {
			throw new Error('not asked');
		},
	};
	const outcome = await commitStartChoice(store as never, 'p1', {
		kind: 'folder',
		path: '/gone',
	});
	assert.deepEqual(outcome, {
		kind: 'refused',
		message: 'That folder does not exist on the server.',
	});
	assert.equal(startRefusalMessage(refusal('not_directory')), 'That path is not a folder.');
	assert.equal(startRefusalMessage(new Error('server said no')), 'server said no');
});

test('an accepted start choice hands back the server result', async () => {
	const result = { projectId: 'p1', root: '', rootOrigin: 'none', revision: 5, cursor: '5' };
	const store = {
		async startProject(request: unknown) {
			assert.deepEqual(request, { projectId: 'p1', choice: { kind: 'home' } });
			return result;
		},
		async refresh() {
			throw new Error('not asked');
		},
	};
	assert.deepEqual(await commitStartChoice(store as never, 'p1', { kind: 'home' }), {
		kind: 'started',
		result,
	});
});

test('recent folders are named by their last segment, bounded, and keep unavailability', () => {
	const entries = Array.from({ length: 60 }, (_, index) => ({
		path: `/srv/projects/app-${index}`,
		usedAt: 1_000 - index,
		available: index !== 1,
	}));
	const rows = recentFolderRows({ revision: 3, entries });
	assert.equal(rows.length, 50);
	assert.deepEqual(rows[0], { path: '/srv/projects/app-0', name: 'app-0', available: true });
	assert.equal(rows[1].available, false);
	assert.deepEqual(recentFolderRows(null), []);
	assert.equal(folderName('/srv/projects/app/'), 'app');
	assert.equal(folderName('/'), '/');
	assert.equal(folderName('C:\\Users\\mark\\code'), 'code');
	assert.equal(childFolderPath('/', 'srv'), '/srv');
	assert.equal(childFolderPath('/srv', 'app'), '/srv/app');
	assert.equal(childFolderPath('C:\\Users', 'mark'), 'C:\\Users\\mark');
});

test('arrow keys walk the chooser controls in order and stop at either end', () => {
	// Open a folder, Home directory, then each recent entry and its Forget.
	const count = 6;
	assert.equal(chooserFocusMove('ArrowDown', 0, count), 1);
	assert.equal(chooserFocusMove('ArrowRight', 2, count), 3, 'a row to its Forget');
	assert.equal(chooserFocusMove('ArrowLeft', 3, count), 2, 'Forget back to its row');
	assert.equal(chooserFocusMove('ArrowUp', 0, count), 0);
	assert.equal(chooserFocusMove('ArrowDown', count - 1, count), count - 1);
	assert.equal(chooserFocusMove('End', 0, count), count - 1);
	assert.equal(chooserFocusMove('Home', 4, count), 0);
	assert.equal(chooserFocusMove('ArrowDown', -1, count), 0, 'from outside, the first');
	assert.equal(chooserFocusMove('Enter', 1, count), null, 'Enter activates natively');
	assert.equal(chooserFocusMove('ArrowDown', 0, 0), null);
});

function folder(path: string, names: string[], extra: Partial<BrowseRootFoldersResult> = {}): BrowseRootFoldersResult {
	return { path, entries: names.map((name) => ({ name })), truncated: false, ...extra };
}

test('the folder browser starts at home, enters, goes up, and takes a typed path', async () => {
	const asked: Array<string | undefined> = [];
	const tree: Record<string, BrowseRootFoldersResult> = {
		'/home/mark': folder('/home/mark', ['code', 'notes'], { parent: '/home' }),
		'/home/mark/code': folder('/home/mark/code', ['terminay'], { parent: '/home/mark' }),
		'/home': folder('/home', ['mark'], { parent: '/' }),
		'/srv': folder('/srv', [], { parent: '/' }),
	};
	const listings: RootFolderListing[] = [];
	const navigator = new RootFolderNavigator(
		async (path) => {
			asked.push(path);
			const answer = tree[path ?? '/home/mark'];
			if (answer === undefined) throw refusal('path_missing');
			return answer;
		},
		(listing) => listings.push(listing),
	);
	await navigator.open();
	assert.equal(asked[0], undefined, 'home is the server default');
	assert.equal(navigator.listing.state, 'ready');
	await navigator.open(childFolderPath('/home/mark', 'code'));
	assert.deepEqual(navigator.listing, { state: 'ready', folder: tree['/home/mark/code'] });
	await navigator.open('/home');
	await navigator.open('/srv');
	assert.deepEqual(asked, [undefined, '/home/mark/code', '/home', '/srv']);
	assert.equal(listings.filter((listing) => listing.state === 'loading').length, 4);
});

test('the folder browser shows an error in place of the listing and keeps where it was', async () => {
	const navigator = new RootFolderNavigator(
		async (path) => {
			if (path === '/root') throw refusal('unreadable');
			return folder('/home/mark', ['code'], { parent: '/home' });
		},
		() => {},
	);
	await navigator.open();
	await navigator.open('/root');
	const listing = navigator.listing;
	assert.equal(listing.state, 'error');
	assert.equal(listing.state === 'error' && listing.message, 'The server cannot read that folder.');
	assert.equal(listing.state === 'error' && listing.previous?.path, '/home/mark');
});

test('the folder browser keeps the truncation marker and drops a stale answer', async () => {
	let release: (value: BrowseRootFoldersResult) => void = () => {};
	const slow = new Promise<BrowseRootFoldersResult>((resolve) => {
		release = resolve;
	});
	const navigator = new RootFolderNavigator(async (path) => {
		if (path === '/slow') return slow;
		return folder('/big', ['a', 'b'], { truncated: true });
	}, () => {});
	const leaving = navigator.open('/slow');
	await navigator.open('/big');
	release(folder('/slow', ['late']));
	await leaving;
	const listing = navigator.listing;
	assert.equal(listing.state, 'ready');
	assert.equal(listing.state === 'ready' && listing.folder.path, '/big');
	assert.equal(listing.state === 'ready' && listing.folder.truncated, true);
});

function featureContext(projects: Record<string, Project>) {
	const counted = () => new Proxy({}, { get: () => () => { throw new Error('a query reached a client'); } });
	return {
		serverId: 'server-a',
		applicationClient: counted(),
		fileObservationClient: counted(),
		fileViewerClient: counted(),
		documentationClient: counted(),
		gitClient: counted(),
		recordingsClient: counted(),
		workspaceSnapshotStore: { snapshot: snapshot(projects) },
	} as never;
}

test('a project with no root folder hands its Explorer, watches, Git, and Documentation no client', () => {
	const availability = resolveProjectFeatureAuthority(
		featureContext({ homed: project('homed', { root: '', rootOrigin: 'none' }) }),
		'homed',
	);
	assert.equal(availability.state, 'available', 'terminals, agents, and recordings still work');
	assert.deepEqual(resolveFeatureProjectRoot(availability, ''), { state: 'no-root' });
	assert.equal(rootScopedFeatureAuthority(availability), undefined);
	assert.equal(featureProjectRoot(availability, ''), '');
});

test('setting a root takes a project out of no-root mode', () => {
	const before = resolveProjectFeatureAuthority(
		featureContext({ homed: project('homed', { root: '', rootOrigin: 'none' }) }),
		'homed',
	);
	// What the projection holds once project.root.update has been applied.
	const after = resolveProjectFeatureAuthority(
		featureContext({ homed: project('homed', { root: '/work/chosen', rootOrigin: 'explicit' }) }),
		'homed',
	);
	assert.equal(rootScopedFeatureAuthority(before), undefined);
	assert.deepEqual(resolveFeatureProjectRoot(after, ''), { state: 'rooted', root: '/work/chosen' });
	assert.notEqual(rootScopedFeatureAuthority(after), undefined);
	assert.equal(rootScopedFeatureAuthority(after)?.scope.projectRoot, '/work/chosen');
});

test('a typed root is never completed with another project folder', () => {
	assert.equal(normalizeProjectRoot('~/code', ''), '~/code');
	assert.equal(normalizeProjectRoot('~', ''), '~');
	assert.equal(normalizeProjectRoot('', ''), '', 'an empty field keeps no root');
	assert.equal(normalizeProjectRoot(' /srv/app ', ''), '/srv/app');
	assert.equal(normalizeProjectRoot('~/code', '/home/mark'), '/home/mark/code');
});

test('a recent folder another shown project has as its root opens that project', () => {
	const state = snapshot({
		waiting: project('waiting', { root: '', rootOrigin: 'none', start: 'awaiting-choice' }),
		rooted: project('rooted', { root: '/work/app' }),
		homed: project('homed', { root: '', rootOrigin: 'none' }),
		elsewhere: project('elsewhere', { root: '/work/other' }),
	});
	const shown = ['waiting', 'rooted', 'homed'];
	assert.equal(openProjectWithRoot(state, '/work/app', 'waiting', shown), 'rooted');
	// A folder no shown project has starts the waiting project there.
	assert.equal(openProjectWithRoot(state, '/work/new', 'waiting', shown), undefined);
	// A project in another window is not this window's to show.
	assert.equal(openProjectWithRoot(state, '/work/other', 'waiting', shown), undefined);
	// A no-root project never matches, and nor does the waiting project itself.
	assert.equal(openProjectWithRoot(state, '', 'waiting', shown), undefined);
	assert.equal(openProjectWithRoot(state, '/work/app', 'rooted', ['rooted']), undefined);
	assert.equal(openProjectWithRoot(null, '/work/app', 'waiting', shown), undefined);
});

test('a typed path completes from its parent folder and the start of its last name', () => {
	assert.deepEqual(splitTypedFolderPath('/Users/mark/Doc'), { parent: '/Users/mark', prefix: 'Doc' });
	assert.deepEqual(splitTypedFolderPath('/Users/mark/'), { parent: '/Users/mark', prefix: '' });
	assert.deepEqual(splitTypedFolderPath('/Us'), { parent: '/', prefix: 'Us' });
	assert.deepEqual(splitTypedFolderPath('C:\\Us'), { parent: 'C:\\', prefix: 'Us' });
	assert.deepEqual(splitTypedFolderPath('~/co'), { parent: '~/', prefix: 'co' });
	assert.equal(splitTypedFolderPath('Documents'), null);
	assert.equal(splitTypedFolderPath(''), null);

	const folder = {
		path: '/Users/mark',
		parent: '/Users',
		entries: [{ name: 'Desktop' }, { name: 'Documents' }, { name: 'docs' }, { name: 'Downloads' }],
		truncated: false,
	};
	assert.deepEqual(folderSuggestions(folder, 'Doc'), [
		{ name: 'Documents', path: '/Users/mark/Documents' },
		{ name: 'docs', path: '/Users/mark/docs' },
	]);
	assert.equal(folderSuggestions(folder, '').length, 4);
	assert.equal(folderSuggestions(folder, '', 2).length, 2);
	assert.deepEqual(folderSuggestions(folder, 'zz'), []);
});

test('the arrow keys move round the suggestions, and other keys do not', () => {
	assert.equal(suggestionHighlightMove('ArrowDown', -1, 3), 0);
	assert.equal(suggestionHighlightMove('ArrowDown', 2, 3), 0);
	assert.equal(suggestionHighlightMove('ArrowUp', -1, 3), 2);
	assert.equal(suggestionHighlightMove('ArrowUp', 1, 3), 0);
	assert.equal(suggestionHighlightMove('Tab', 0, 3), null);
	assert.equal(suggestionHighlightMove('ArrowDown', -1, 0), null);
});

test('completion asks for a parent once, drops a stale answer, and suggests nothing for a missing one', async () => {
	const tree: Record<string, BrowseRootFoldersResult> = {
		'/home/mark': { path: '/home/mark', parent: '/home', entries: [{ name: 'code' }, { name: 'config' }, { name: 'notes' }], truncated: false },
		'/srv': { path: '/srv', parent: '/', entries: [{ name: 'cache' }], truncated: false },
	};
	const asked: (string | undefined)[] = [];
	const pending: Array<() => void> = [];
	const seen: string[][] = [];
	const completer = new RootFolderCompleter(
		(path) => {
			asked.push(path);
			return new Promise((resolve, reject) => {
				pending.push(() => {
					const answer = tree[path ?? ''];
					if (answer === undefined) reject(refusal('path_missing'));
					else resolve(answer);
				});
			});
		},
		(suggestions) => seen.push(suggestions.map((suggestion) => suggestion.name)),
		0,
	);
	const settle = async () => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		for (const answer of pending.splice(0)) answer();
		await new Promise((resolve) => setTimeout(resolve, 5));
	};

	completer.update('/home/mark/co');
	await settle();
	assert.deepEqual(seen.at(-1), ['code', 'config']);
	// Typing on inside the same folder filters what is already listed.
	completer.update('/home/mark/con');
	assert.deepEqual(seen.at(-1), ['config']);
	assert.deepEqual(asked, ['/home/mark']);

	// A slower answer for a parent already left never lands.
	completer.update('/srv/c');
	await new Promise((resolve) => setTimeout(resolve, 5));
	completer.update('/home/mark/n');
	assert.deepEqual(seen.at(-1), ['notes']);
	await settle();
	assert.deepEqual(seen.at(-1), ['notes']);

	completer.update('/missing/x');
	await settle();
	assert.deepEqual(seen.at(-1), []);
	completer.update('no-parent');
	assert.deepEqual(seen.at(-1), []);
	completer.dispose();
});
