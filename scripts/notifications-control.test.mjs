import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(
	join(process.cwd(), '.notifications-test-'),
);

async function bundleComponent(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react'],
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return require(outputPath);
}

const {
	TerminalActivityOverview,
	buildTerminalActivityOverview,
	notificationsButtonLabel,
} = await bundleComponent(
	'src/workspace/TerminalActivityOverview.tsx',
	'notifications.cjs',
);
const { ProjectTabActivityDot } = await bundleComponent(
	'src/workspace/ProjectTabActivityDot.tsx',
	'project-dot.cjs',
);

test.after(() => rm(testDirectory, { force: true, recursive: true }));

const noop = () => {};

function item(title, state, overrides = {}) {
	return {
		color: '#888',
		emoji: '',
		panelId: `panel-${title}`,
		projectEmoji: '',
		projectId: 'project-1',
		projectTitle: 'Alpha',
		sessionId: `session-${title}`,
		state,
		isAgentStatus: false,
		title,
		...overrides,
	};
}

function control(items, isOpen = true) {
	const overview = buildTerminalActivityOverview(items);
	return renderToStaticMarkup(
		React.createElement(TerminalActivityOverview, {
			activityMenuRef: { current: null },
			isOpen,
			notifications: overview.notifications,
			onActivate: noop,
			onDismiss: noop,
			onDismissAll: noop,
			onToggle: noop,
		}),
	);
}

function dot(badge) {
	return renderToStaticMarkup(
		React.createElement(ProjectTabActivityDot, { badge }),
	);
}

test('notifications are attention then finished; working is left out', () => {
	const overview = buildTerminalActivityOverview([
		item('busy', 'recent'),
		item('finished', 'unviewed'),
		item('agent-done', 'done'),
		item('bell', 'attention'),
		item('agent-working', 'working'),
		item('agent-waiting', 'waiting'),
	]);
	assert.deepEqual(
		overview.notifications.map((entry) => entry.title),
		['agent-waiting', 'bell', 'agent-done', 'finished'],
	);
	assert.equal('working' in overview, false);
	assert.equal(overview.notificationCount, 4);
});

test('the control is present with no badge when nothing is listed', () => {
	const closed = control([], false);
	assert.match(closed, /class="terminal-activity-button"/);
	assert.match(closed, /aria-label="Notifications"/);
	assert.doesNotMatch(closed, /notifications-count/);

	const open = control([]);
	assert.match(open, /No notifications/);
	assert.doesNotMatch(open, /Clear all/);
	assert.doesNotMatch(open, />Working</);
});

test('working terminals are neither counted nor listed', () => {
	const markup = control([item('a', 'recent'), item('b', 'working')]);
	assert.doesNotMatch(markup, /notifications-count/);
	assert.match(markup, /No notifications/);
	assert.doesNotMatch(markup, />Working</);
	assert.doesNotMatch(markup, /terminal-activity-menu__row/);
	assert.doesNotMatch(markup, /terminal-activity-menu__dismiss/);
	assert.doesNotMatch(markup, /Clear all/);
});

test('one red number counts attention plus finished', () => {
	const markup = control([
		item('a', 'attention'),
		item('b', 'unviewed'),
		item('c', 'done'),
		item('d', 'recent'),
	]);
	assert.equal(markup.match(/class="notifications-count"/g)?.length, 1);
	assert.match(markup, /class="notifications-count" data-digits="1"[^>]*>3</);
	assert.match(markup, /aria-label="Notifications, 3 notifications"/);
	assert.equal(notificationsButtonLabel(1), 'Notifications, 1 notification');
});

test('the count keeps one circle size and caps at 99+', () => {
	const many = (count) =>
		Array.from({ length: count }, (_, index) => item(`t${index}`, 'unviewed'));
	assert.match(control(many(12), false), /data-digits="2"[^>]*>12</);
	assert.match(control(many(120), false), /data-digits="3"[^>]*>99\+</);
});

test('each notification can be dismissed and working terminals have no row', () => {
	const markup = control([
		item('needs-you', 'attention'),
		item('finished', 'unviewed'),
		item('busy', 'recent'),
	]);
	assert.equal(markup.match(/terminal-activity-menu__dismiss/g)?.length, 2);
	assert.match(markup, /aria-label="Dismiss needs-you"/);
	assert.match(markup, /aria-label="Dismiss finished"/);
	assert.doesNotMatch(markup, /aria-label="Dismiss busy"/);
	assert.match(markup, /Clear all/);
	assert.ok(markup.indexOf('needs-you') < markup.indexOf('finished'));
	assert.doesNotMatch(markup, /busy/);
});

test('a row reads as a notification: what happened, where, and how long ago', () => {
	const now = Date.now();
	const markup = control([
		item('Terminal 1', 'done', {
			isAgentStatus: true,
			projectTitle: 'Project 2',
			since: now - 23_000,
		}),
		item('Build', 'unviewed', { since: now - 2 * 60 * 60_000 }),
		item('Advert', 'waiting', { isAgentStatus: true }),
	]);
	assert.match(
		markup,
		/Agent finished<\/span>[\s\S]*?Terminal 1<\/span>[\s\S]*?Project 2<\/span>[\s\S]*?23 seconds ago/,
	);
	assert.match(markup, /Command finished<\/span>[\s\S]*?2 hours ago/);
	assert.match(markup, /Agent is waiting for you/);
	// A row whose time is unknown simply has no age line.
	assert.equal(markup.match(/terminal-activity-menu__age/g)?.length, 2);
});

test('newer notifications come first within the same urgency', () => {
	const now = Date.now();
	const overview = buildTerminalActivityOverview([
		item('older', 'unviewed', { since: now - 60_000 }),
		item('newer', 'unviewed', { since: now - 1_000 }),
		item('urgent', 'attention', { since: now - 600_000 }),
	]);
	assert.deepEqual(
		overview.notifications.map((entry) => entry.title),
		['urgent', 'newer', 'older'],
	);
});

test('dismiss controls report the row they belong to', async () => {
	const source = await readFile(
		'src/workspace/TerminalActivityOverview.tsx',
		'utf8',
	);
	assert.match(source, /onClick=\{\(\) => onDismiss\(item\)\}/);
	assert.match(source, /onClick=\{onDismissAll\}/);
});

test('the project dot is the terminal tab indicator, with no number', () => {
	const working = dot({ count: 2, state: 'recent' });
	assert.match(working, /agent-status-indicator--working/);
	assert.match(working, /agent-status-indicator--small/);
	assert.match(working, /project-tab-activity-dot--recent/);
	assert.match(working, /aria-label="2 terminals, working"/);
	assert.doesNotMatch(working, />2</);

	assert.match(
		dot({ count: 1, state: 'attention' }),
		/agent-status-indicator--blocked/,
	);
	assert.match(
		dot({ count: 1, state: 'unviewed' }),
		/agent-status-indicator--done[\s\S]*aria-label="1 terminal, finished"/,
	);
});

test('the project dot is absent with nothing to show', () => {
	assert.equal(dot(undefined), '');
	assert.equal(dot({ count: 0, state: 'unviewed' }), '');
});

test('the project dot leads the title on tabs and switcher rows', async () => {
	const [tabs, menu, compact] = await Promise.all([
		readFile('src/workspace/ProjectTabList.tsx', 'utf8'),
		readFile('src/workspace/ProjectSwitcherMenu.tsx', 'utf8'),
		readFile('src/workspace/CompactSwitcher.tsx', 'utf8'),
	]);
	assert.equal(
		tabs.match(
			/<ProjectTabActivityDot[\s\S]{0,90}?\/>\s*<span className="project-tab-title">/g,
		)?.length,
		2,
	);
	assert.match(
		menu,
		/<ProjectTabActivityDot badge=\{badge\} \/>\s*<span className="project-switcher-menu__title">/,
	);
	// A compact switcher header says it in words instead: a second dot beside
	// its colour swatch read as a pair.
	assert.doesNotMatch(compact, /ProjectTabActivityDot/);
	assert.match(compact, /<CompactSwitcherSummary project=\{project\} \/>/);
});

test('dismissal is the acknowledgement tab selection reports, without selecting', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	assert.match(app, /acknowledgeTerminal: markTerminalActivityViewed,/);
	assert.match(
		app,
		/const dismissNotification = useCallback\([\s\S]{0,200}?\?\.acknowledgeTerminal\(item\.sessionId\);/,
	);
	const dismiss = app.slice(
		app.indexOf('const dismissNotification'),
		app.indexOf('const dismissAllNotifications'),
	);
	assert.doesNotMatch(dismiss, /activateProject|activateTerminal\(/);
});
