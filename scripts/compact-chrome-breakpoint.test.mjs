import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	isProjectTabBarCompact,
	PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH,
} from '../src/workspace/projectTabOverflow.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the breakpoint flips at 640px and is never guessed from zero width', () => {
	assert.equal(PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH, 640);
	assert.equal(isProjectTabBarCompact(640), true);
	assert.equal(isProjectTabBarCompact(641), false);
	assert.equal(isProjectTabBarCompact(390), true);
	// An unmeasured bar is not a compact bar; it is a bar with no answer yet.
	assert.equal(isProjectTabBarCompact(0), false);
});

test('one source decides compact chrome', async () => {
	const hook = await read('src/workspace/useCompactChrome.ts');
	assert.match(hook, /isProjectTabBarCompact\(element\.clientWidth\)/);

	// The shell observes once and hands the answer down.
	const app = await read('src/App.tsx');
	assert.match(
		app,
		/const isCompactChrome = useCompactChrome\(projectTabBarRef\)/,
	);
	// Called exactly once: the shell, and nowhere else.
	assert.equal(app.match(/useCompactChrome\(/g).length, 1);
	assert.doesNotMatch(app, /isProjectTabBarCompact/);

	// The strip takes the decision rather than re-deriving it, so the row and
	// the strip beneath it cannot disagree about which layout is live.
	const list = await read('src/workspace/ProjectTabList.tsx');
	assert.doesNotMatch(list, /isProjectTabBarCompact/);
	assert.match(list, /const compact = isCompactChrome;/);
});

test('no surface reaches for a second width source', async () => {
	for (const path of [
		'src/workspace/CompactChromeRow.tsx',
		'src/workspace/CompactSwitcher.tsx',
		'src/workspace/compactSwitcherModel.ts',
	]) {
		const source = await read(path);
		assert.doesNotMatch(source, /matchMedia|innerWidth|clientWidth/);
	}
	// The browser menu band reacts to the shell's stamped decision instead of
	// measuring the viewport itself.
	const web = await read('src/web/ConnectedWebRendererWorkspace.tsx');
	assert.doesNotMatch(web, /matchMedia|innerWidth/);
	const css = await read('src/web/connectedRendererWorkspace.css');
	assert.match(
		css,
		/data-terminay-compact-chrome="true"[\s\S]{0,120}?\.connected-web-menubar \{\s*display: none;/,
	);
	const app = await read('src/App.tsx');
	assert.match(
		app,
		/data-terminay-compact-chrome=\{isCompactChrome \? 'true' : 'false'\}/,
	);
});

test('the panel tab strip is hidden by the same flag, and nothing else is', async () => {
	const app = await read('src/App.tsx');
	assert.match(
		app,
		/workspace dockview-theme-dark\$\{isCompactChrome \? ' workspace--compact-chrome' : ''\}/,
	);
	const css = await read('src/App.css');
	assert.match(
		css,
		/\.workspace--compact-chrome \.dv-tabs-and-actions-container \{\n\s*display: none;\n\}/,
	);
	// Hiding tabs must not touch Dockview's layout or its stored state.
	assert.doesNotMatch(css, /\.workspace--compact-chrome \.dv-groupview/);
});

test('the flag and the reader registry actually reach the workspace', async () => {
	// Declaring the props and never passing them left the panel tab strip
	// visible at phone width and the preview registry empty in the real app.
	const app = await read('src/App.tsx');
	assert.match(app, /<ProjectWorkspace[\s\S]*?isCompactChrome=\{isCompactChrome\}/);
	assert.match(
		app,
		/<ProjectWorkspace[\s\S]*?sharedTerminalContextReaders=\{sharedTerminalContextReadersRef\}/,
	);
});

test('the compact row renders only below the breakpoint', async () => {
	const app = await read('src/App.tsx');
	assert.match(app, /\{isCompactChrome \? \(\s*<CompactChromeRow/);
	assert.match(app, /\{isCompactChrome && isCompactSwitcherOpen \? \(/);
});

test('the breadcrumb truncates the project before the terminal', async () => {
	const css = await read('src/App.css');
	const project = css.match(
		/\.compact-breadcrumb__project \{([\s\S]*?)\n\}/,
	)?.[1];
	const terminal = css.match(
		/\.compact-breadcrumb__terminal \{([\s\S]*?)\n\}/,
	)?.[1];
	assert.ok(project && terminal);
	// The project may shrink to nothing; the terminal keeps a floor, so the
	// name of what you are typing into survives.
	assert.match(project, /min-width: 0;/);
	assert.match(terminal, /min-width: 3\.5em;/);
	for (const rule of [project, terminal]) {
		assert.match(rule, /text-overflow: ellipsis;/);
	}
	// Icons give up width first.
	assert.match(
		css,
		/@media \(max-width: 380px\) \{\n\s*\.compact-chrome__icon \{\n\s*width: 27px;/,
	);
});

test('the filter is sized so iOS has no reason to zoom', async () => {
	const css = await read('src/App.css');
	const field = css.match(
		/\.compact-switcher__field input \{([\s\S]*?)\n\}/,
	)?.[1];
	assert.ok(field, 'the filter has a field rule');

	// iOS zooms when the COMPUTED size is under 16px, and has ignored
	// user-scalable=no since iOS 10 — the computed size is the only lever.
	const computed = field.match(/font-size: (\d+(?:\.\d+)?)px/)?.[1];
	assert.ok(computed !== undefined);
	assert.ok(
		Number(computed) >= 16,
		`computed font-size ${computed}px would still zoom`,
	);

	// …and it is scaled back so the reader sees the sheet's own type size.
	const scale = field.match(/transform: scale\((\d+(?:\.\d+)?)\)/)?.[1];
	assert.ok(scale !== undefined);
	const rendered = Number(computed) * Number(scale);
	assert.ok(
		Math.abs(rendered - 13.5) < 0.01,
		`renders at ${rendered}px, not the sheet's 13.5px`,
	);
	assert.match(field, /transform-origin: left top;/);

	// The wrapper owns the layout box, and the input fills it at the inverse
	// of the scale so it paints exactly inside it.
	const wrapper = css.match(
		/\.compact-switcher__field \{([\s\S]*?)\n\}/,
	)?.[1];
	assert.ok(wrapper);
	assert.match(wrapper, /position: relative;/);
	const width = Number(field.match(/width: (\d+(?:\.\d+)?)%/)?.[1]);
	assert.ok(Math.abs(width - 100 / Number(scale)) < 0.01, `width ${width}%`);
});

test('no document tries to forbid zoom instead', async () => {
	// A viewport declaration cannot stop the focus zoom on iOS, and pinning the
	// scale only costs pinch-zoom. The workspace document must not pretend.
	const workspaceDocument = await read('server.html');
	const viewport = workspaceDocument.match(
		/<meta[\s\S]*?name="viewport"[\s\S]*?content="([^"]+)"/,
	)?.[1];
	assert.ok(viewport);
	assert.doesNotMatch(viewport, /user-scalable=no/);
	assert.doesNotMatch(viewport, /maximum-scale/);
});

test('switcher rows stay tappable without padding out to nothing', async () => {
	const css = await read('src/App.css');
	const row = css.match(/\.compact-switcher__terminal \{([\s\S]*?)\n\}/)?.[1];
	assert.ok(row);
	// The floor keeps a row tappable; a row carrying a preview grows past it on
	// its own. Holding every row at the two-line height turned a terminal with
	// no preview into a tall empty box.
	const floor = Number(row.match(/min-height: (\d+)px;/)?.[1]);
	assert.ok(floor >= 36 && floor <= 40, `min-height ${floor}px`);
	const padding = Number(row.match(/padding: (\d+)px/)?.[1]);
	assert.ok(padding <= 6, `vertical padding ${padding}px`);
});

test('the switcher overlays the workspace rather than taking height from it', async () => {
	const css = await read('src/App.css');
	const scrim = css.match(/\.compact-switcher-scrim \{([\s\S]*?)\n\}/)?.[1];
	assert.ok(scrim);
	assert.match(scrim, /position: absolute;/);
	assert.match(scrim, /inset: 0;/);
});

test('the compact row carries the Command Bar between dashboard and breadcrumb', async () => {
	const row = await read('src/workspace/CompactChromeRow.tsx');
	const order = [
		...row.matchAll(
			/data-terminay-home-control(?==)|data-compact-command-bar(?==)|data-compact-breadcrumb(?==)|data-compact-connection(?==)/g,
		),
	].map((match) => match[0]);
	assert.deepEqual(order, [
		'data-terminay-home-control',
		'data-compact-command-bar',
		'data-compact-breadcrumb',
		'data-compact-connection',
	]);

	// It names itself; the glyph alone says nothing about what it opens.
	assert.match(row, /aria-label="Open command bar"/);
	// The command acts on the project in front, so the control says when there
	// is none rather than looking live and doing nothing.
	assert.match(row, /disabled=\{!isCommandBarAvailable\}/);
});

test('the Command Bar control takes the same dispatch as the accelerator', async () => {
	const app = await read('src/App.tsx');
	assert.match(
		app,
		/const openCompactCommandBar = useCallback\(\(\) => \{\s*void executeCommandOnActiveProject\('open-command-bar'\);/,
	);
	assert.match(
		app,
		/<CompactChromeRow[\s\S]*?onOpenCommandBar=\{openCompactCommandBar\}/,
	);
	assert.match(
		app,
		/<CompactChromeRow[\s\S]*?isCommandBarAvailable=\{!isHomeSelected && activeProject !== null\}/,
	);
	// One definition of what opening the Command Bar means: the control must not
	// reach past the command into the launcher's own state.
	assert.equal(app.match(/setIsMacroLauncherOpen\(true\)/g).length, 1);
});

test('an unavailable chrome control reads as unavailable', async () => {
	const css = await read('src/App.css');
	const rule = css.match(
		/\.compact-chrome__icon:disabled \{([\s\S]*?)\n\}/,
	)?.[1];
	assert.ok(rule, 'the disabled state has a rule');
	assert.match(rule, /opacity: 0\.35;/);
	assert.match(rule, /cursor: default;/);
	// And it must not light up under a hover it will not answer.
	assert.match(
		css,
		/\.compact-chrome__icon:disabled:hover \{[\s\S]*?background: none;/,
	);
});
