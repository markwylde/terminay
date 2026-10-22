import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowseRootFoldersResult } from '@terminay/client-core';
import {
	acceptStep,
	activeFolder,
	deleteSegment,
	type FolderFieldState,
	folderFieldKey,
	folderFieldState,
	ghostText,
	longestCommonPrefix,
	moveHighlight,
	openTarget,
	parentValue,
	RootFolderCompleter,
	shownFolders,
	splitTypedFolderPath,
	tabStep,
	visibleFolders,
} from './rootFolderCompletion.ts';

// The prototype's tree: what the server would list for each typed parent.
const HOME = '/Users/mark';
function folder(path: string, names: string[], extra: Partial<BrowseRootFoldersResult> = {}): BrowseRootFoldersResult {
	return { path, entries: names.map((name) => ({ name })), truncated: false, ...extra };
}
const tree: Record<string, BrowseRootFoldersResult> = {
	'~/': folder(HOME, ['.cache', '.cargo', '.config', 'Desktop', 'Documents', 'Downloads', 'Music'], { parent: '/Users' }),
	'~/Documents': folder(`${HOME}/Documents`, ['Invoices', 'Notes', 'Projects', 'Taxes'], { parent: HOME }),
	'~/Documents/Projects': folder(`${HOME}/Documents/Projects`, ['dotfiles', 'mwpet', 'pagednet', 'terminay', 'terminay-extensions', 'terminay-site'], { parent: `${HOME}/Documents` }),
	'~/Documents/Projects/terminay': folder(`${HOME}/Documents/Projects/terminay`, ['terminay'], { parent: `${HOME}/Documents/Projects` }),
	'C:\\Users': folder('C:\\Users', ['mark', 'Public'], { parent: 'C:\\' }),
};
const listed = (typed: string) => {
	const split = splitTypedFolderPath(typed);
	return split === null ? undefined : tree[split.parent];
};

/** Tab from a typed value, as the browser does, failing on anything but a
 * new state. */
function tab(state: FolderFieldState, backwards = false): FolderFieldState {
	const next = tabStep(state, listed(state.value), backwards);
	assert.equal(next.kind, 'state', `Tab from ${state.value}`);
	return next.kind === 'state' ? next.state : state;
}

test('hidden folders are listed only once the typed segment starts with a dot', () => {
	const home = tree['~/'].entries;
	assert.deepEqual(visibleFolders(home, ''), ['Desktop', 'Documents', 'Downloads', 'Music']);
	assert.deepEqual(visibleFolders(home, 'do'), ['Documents', 'Downloads']);
	assert.deepEqual(visibleFolders(home, '.c'), ['.cache', '.cargo', '.config']);
	assert.deepEqual(visibleFolders(home, '.'), ['.cache', '.cargo', '.config']);
});

test('the common prefix ignores case and keeps the first name', () => {
	assert.equal(longestCommonPrefix(['terminay', 'terminay-site', 'Terminal']), 'termina');
	assert.equal(longestCommonPrefix(['Documents', 'docs']), 'Doc');
	assert.equal(longestCommonPrefix([]), '');
});

test('Tab completes a unique folder', () => {
	assert.equal(tab(folderFieldState('~/Documents/Proj')).value, '~/Documents/Projects/');
	assert.equal(tab(folderFieldState('~/Documents/Projects/mw')).value, '~/Documents/Projects/mwpet/');
});

test('Tab fills the common prefix, then cycles, and Shift+Tab goes back', () => {
	let state = tab(folderFieldState('~/Documents/Projects/t'));
	assert.equal(state.value, '~/Documents/Projects/terminay');
	assert.equal(state.cycle, null);
	state = tab(state);
	assert.equal(state.value, '~/Documents/Projects/terminay/');
	assert.deepEqual(shownFolders(state, undefined), ['terminay', 'terminay-extensions', 'terminay-site']);
	assert.equal(activeFolder(state), 0);
	state = tab(state);
	assert.equal(state.value, '~/Documents/Projects/terminay-extensions/');
	state = tab(state, true);
	assert.equal(state.value, '~/Documents/Projects/terminay/');
	state = tab(state, true);
	assert.equal(state.value, '~/Documents/Projects/terminay-site/', 'Shift+Tab wraps');
	assert.equal(state.cycle?.original, '~/Documents/Projects/terminay');
});

test('Shift+Tab starts a cycle from the last match', () => {
	assert.equal(tab(folderFieldState('~/Do'), true).value, '~/Downloads/');
});

test('Tab with nothing to match says so and leaves the field', () => {
	const none = tabStep(folderFieldState('~/zz'), listed('~/zz'));
	assert.deepEqual(none, { kind: 'message', message: `Nothing in ${HOME} starts with “zz”.` });
	assert.deepEqual(tabStep(folderFieldState('Documents'), undefined), {
		kind: 'message',
		message: 'Start the path with / or ~.',
	});
	assert.deepEqual(tabStep(folderFieldState('~/Documents/Notes/'), undefined), { kind: 'pending' });
	assert.equal(tab(folderFieldState('~')).value, '~/');
});

test('the ghost shows what Tab would add, and → takes it', () => {
	assert.equal(ghostText(folderFieldState('~/Documents/Projects/termi'), listed('~/Documents/Projects/termi')), 'nay');
	assert.equal(ghostText(folderFieldState('~/Documents/Pro'), listed('~/Documents/Pro')), 'jects/');
	assert.equal(ghostText(folderFieldState('~/Documents/'), listed('~/Documents/')), '', 'no ghost before typing');
	assert.equal(ghostText(folderFieldState('~/zz'), listed('~/zz')), '');
	const termi = folderFieldState('~/Documents/Projects/termi');
	assert.equal(acceptStep(termi, listed(termi.value))?.value, '~/Documents/Projects/terminay');
	assert.equal(acceptStep(folderFieldState('~/Documents/'), listed('~/Documents/')), null);
});

test('the arrows highlight in turn and wrap, and Tab or → goes into the highlight', () => {
	let state = folderFieldState('~/Documents/');
	const count = shownFolders(state, listed(state.value)).length;
	state = moveHighlight(state, count, 1);
	state = moveHighlight(state, count, 1);
	assert.equal(state.highlight, 1);
	assert.equal(ghostText(state, listed(state.value)), 'Notes/');
	assert.equal(tab(state).value, '~/Documents/Notes/');
	assert.equal(acceptStep(state, listed(state.value))?.value, '~/Documents/Notes/');
	assert.equal(moveHighlight(folderFieldState('~/'), count, -1).highlight, count - 1);
	assert.equal(moveHighlight({ ...state, highlight: count - 1 }, count, 1).highlight, 0);
});

test('Enter opens the highlight, the named folder, or the only match', () => {
	const target = (value: string, highlight = -1) =>
		openTarget({ value, highlight, cycle: null }, listed(value));
	assert.equal(target('~/Documents/Projects/mw'), '~/Documents/Projects/mwpet');
	assert.equal(target('~/Documents/Projects/'), '~/Documents/Projects/');
	assert.equal(target('~/Documents/Projects/terminay'), '~/Documents/Projects/terminay', 'an exact name among several');
	assert.equal(target('~/Documents/Projects/t'), null, 'several matches name nothing');
	assert.equal(target('~/Documents/Projects/', 1), '~/Documents/Projects/mwpet');
	assert.equal(openTarget(folderFieldState('~/Documents/Notes/'), undefined), null, 'not listed yet');
	const big = folder('/big', ['a'], { truncated: true });
	assert.equal(openTarget(folderFieldState('/big/unlisted'), big), '/big/unlisted', 'the server checks an unlisted name');
});

test('Esc has a cycle to undo', () => {
	const cycling = tab(folderFieldState('~/Do'));
	assert.equal(cycling.value, '~/Documents/');
	assert.equal(cycling.cycle?.original, '~/Do');
});

test('deleting a segment and going to the parent keep the typed style', () => {
	assert.equal(deleteSegment('~/Documents/Projects/'), '~/Documents/');
	assert.equal(deleteSegment('~/Documents/Proj'), '~/Documents/');
	assert.equal(deleteSegment('~/', '/Users'), '/Users/');
	assert.equal(deleteSegment('/'), '/');
	assert.equal(deleteSegment('C:\\Users\\mark\\'), 'C:\\Users\\');
	assert.equal(deleteSegment('C:\\'), 'C:\\');
	assert.equal(parentValue('~/Documents/Projects/'), '~/Documents/');
	assert.equal(parentValue('~/Documents/Pro'), '~/');
	assert.equal(parentValue('~/', '/Users'), '/Users/');
});

test('Windows paths complete with backslashes', () => {
	assert.equal(tab(folderFieldState('C:\\Users\\ma')).value, 'C:\\Users\\mark\\');
	assert.equal(ghostText(folderFieldState('C:\\Users\\P'), listed('C:\\Users\\P')), 'ublic\\');
});

test('keys map to what the field does on each platform', () => {
	const key = (k: string, mods: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}, mac = true) =>
		folderFieldKey({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods }, mac);
	assert.equal(key('Tab'), 'complete');
	assert.equal(key('Tab', { shiftKey: true }), 'complete-back');
	assert.equal(key('ArrowDown'), 'next');
	assert.equal(key('ArrowUp'), 'previous');
	assert.equal(key('ArrowUp', { metaKey: true }), 'parent');
	assert.equal(key('ArrowUp', { altKey: true }, false), 'parent');
	assert.equal(key('ArrowUp', { altKey: true }), null, 'Alt+↑ is not the parent on macOS');
	assert.equal(key('Backspace', { altKey: true }), 'delete-segment');
	assert.equal(key('Backspace', { ctrlKey: true }, false), 'delete-segment');
	assert.equal(key('Backspace'), null, 'plain Backspace edits text');
	assert.equal(key('w', { ctrlKey: true }), 'delete-segment');
	assert.equal(key('w', { ctrlKey: true }, false), null, 'Ctrl+W closes, off macOS');
	assert.equal(key('ArrowRight'), 'accept');
	assert.equal(key('ArrowRight', { shiftKey: true }), null);
	assert.equal(key('Enter'), 'open');
	assert.equal(key('Escape'), 'escape');
	assert.equal(key('a'), null);
});

test('the completer lists a parent once, remembers it, and redraws only for the parent typed now', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const asked: string[] = [];
	const answers = new Map<string, (ok: boolean) => void>();
	let changes = 0;
	const completer = new RootFolderCompleter(
		(path) => {
			asked.push(path ?? '');
			return new Promise((resolve, reject) => {
				answers.set(path ?? '', (ok) => (ok ? resolve(folder(path ?? '', ['code'])) : reject(new Error('missing'))));
			});
		},
		() => {
			changes += 1;
		},
		(error) => (error as Error).message,
		150,
	);
	const settle = () => new Promise((resolve) => setImmediate(resolve));

	completer.update('/home/mark/co');
	assert.deepEqual(completer.listingFor('/home/mark/co'), { state: 'loading' });
	completer.update('/home/mark/cod');
	t.mock.timers.tick(150);
	assert.deepEqual(asked, ['/home/mark'], 'one ask after the pause');
	completer.update('/home/mark/c');
	t.mock.timers.tick(150);
	assert.deepEqual(asked, ['/home/mark'], 'not asked twice while answering');
	answers.get('/home/mark')?.(true);
	await settle();
	assert.equal(changes, 1);
	assert.equal(completer.listingFor('/home/mark/x')?.state, 'ready');

	// Flush asks at once; an answer for a parent already left draws nothing.
	completer.update('/srv/x');
	completer.flush();
	assert.deepEqual(asked, ['/home/mark', '/srv']);
	completer.update('/home/mark/');
	answers.get('/srv')?.(false);
	await settle();
	assert.equal(changes, 1, 'the /srv answer is kept but not drawn');
	assert.deepEqual(completer.listingFor('/srv/x'), { state: 'error', message: 'missing' });
	assert.equal(completer.listingFor('no-parent'), undefined);

	completer.remember('~/', folder(HOME, ['Documents']));
	completer.update('~/Doc');
	completer.flush();
	assert.equal(asked.length, 2, 'a remembered parent is not asked for');
	completer.dispose();
});
