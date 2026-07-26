import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.agent-ui-test-'));

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

const { AgentStatusIndicator } = await bundleComponent(
	'src/components/AgentStatusIndicator.tsx',
	'agent-status-indicator.cjs',
);
const { AgentsSidebar } = await bundleComponent(
	'src/components/AgentsSidebar.tsx',
	'agents-sidebar.cjs',
);
const { reorderSidebarPanelIds } = await bundleComponent(
	'src/components/sidebar/SidebarPanelStack.tsx',
	'sidebar-panel-stack.cjs',
);
const { DockTabChrome } = await bundleComponent(
	'src/components/DockTabChrome.tsx',
	'dock-tab-chrome.cjs',
);

test.after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

test('status indicator uses operational RAG semantics and hides idle by default', () => {
	assert.equal(
		renderToStaticMarkup(
			React.createElement(AgentStatusIndicator, { state: 'idle' }),
		),
		'',
	);

	const working = renderToStaticMarkup(
		React.createElement(AgentStatusIndicator, { state: 'working' }),
	);
	assert.match(working, /agent-status-indicator--working/);
	assert.match(working, /aria-label="Agent working"/);

	const waiting = renderToStaticMarkup(
		React.createElement(AgentStatusIndicator, { state: 'waiting' }),
	);
	assert.match(waiting, /agent-status-indicator--waiting/);
	assert.match(waiting, /aria-label="Agent waiting for input"/);
	const waitingAttention = renderToStaticMarkup(
		React.createElement(AgentStatusIndicator, {
			state: 'waiting',
			needsAttention: true,
		}),
	);
	assert.match(waitingAttention, /aria-label="Agent waiting for input"/);

	const done = renderToStaticMarkup(
		React.createElement(AgentStatusIndicator, { state: 'done' }),
	);
	assert.match(done, /agent-status-indicator--done/);
	assert.doesNotMatch(done, /agent-status-indicator--attention/);
});

test('dock tabs render canonical agent state without removing ordinary activity state', () => {
	const markup = renderToStaticMarkup(
		React.createElement(DockTabChrome, {
			title: 'Agent terminal',
			panelId: 'panel-1',
			isActive: false,
			activityState: 'unviewed',
			agentState: 'done',
			closeAriaLabel: 'Close terminal',
			onClose: () => {},
		}),
	);

	assert.match(markup, /data-terminal-activity="unviewed"/);
	assert.match(markup, /agent-status-indicator--done/);
	assert.match(markup, />Agent terminal</);
});

test('dock tabs can distinguish fallback terminal activity from agent status', () => {
	const markup = renderToStaticMarkup(
		React.createElement(DockTabChrome, {
			title: 'Plain terminal',
			panelId: 'panel-2',
			isActive: false,
			agentState: 'blocked',
			agentNeedsAttention: true,
			agentStatusLabel: 'Terminal needs attention',
			closeAriaLabel: 'Close terminal',
			onClose: () => {},
		}),
	);
	assert.match(markup, /aria-label="Terminal needs attention"/);
});

test('sidebar filters by project, nests subagents, and keeps unread separate from RAG color', () => {
	const rootEntry = {
		entryId: 'root-entry',
		kind: 'root',
		provider: 'codex',
		agentId: 'root',
		sessionId: 'session',
		activationTerminalSessionId: 'terminal',
		displayName: 'Lead agent',
		state: 'done',
		stateStartedAt: 10,
		updatedAt: 10,
		lastEventKind: 'agent.done',
		lastEventSequence: 2,
		active: false,
		activeTools: [],
		unread: true,
		terminalSessionId: 'terminal',
		inProcess: false,
	};
	const childEntry = {
		entryId: 'child-entry',
		kind: 'subagent',
		provider: 'codex',
		agentId: 'child',
		sessionId: 'session',
		activationTerminalSessionId: 'terminal',
		displayName: 'Researcher',
		state: 'working',
		stateStartedAt: 8,
		updatedAt: 8,
		lastEventKind: 'subagent.started',
		lastEventSequence: 1,
		active: true,
		activeTools: [],
		unread: false,
		terminalSessionId: null,
		inProcess: true,
		parentAgentId: 'root',
		parentEntryId: 'root-entry',
	};
	const otherProjectEntry = {
		...rootEntry,
		entryId: 'other-root-entry',
		agentId: 'other-root',
		displayName: 'Other project agent',
	};

	const markup = renderToStaticMarkup(
		React.createElement(AgentsSidebar, {
			projectId: 'project-a',
			agents: [
				{
					entry: childEntry,
					projectId: 'project-a',
					model: 'gpt-5',
					prompt: 'Research the implementation',
				},
				{
					entry: rootEntry,
					projectId: 'project-a',
					model: 'gpt-5',
					prompt: 'Implement the feature',
				},
				{ entry: otherProjectEntry, projectId: 'project-b' },
			],
			onActivateTerminal: () => {},
		}),
	);

	assert.match(markup, /Lead agent/);
	assert.match(markup, /Researcher/);
	assert.doesNotMatch(markup, /Other project agent/);
	assert.match(markup, /agents-sidebar__row--unread/);
	assert.match(markup, /agent-status-indicator--done/);
	assert.doesNotMatch(markup, /agent-status-indicator--attention/);
	assert.ok(markup.indexOf('Lead agent') < markup.indexOf('Researcher'));
	assert.match(markup, /Collapse 1 subagent for Lead agent/);
	assert.match(markup, /Research the implementation/);
});

test('sidebar panel ordering supports before and after moves without losing panels', () => {
	assert.deepEqual(
		reorderSidebarPanelIds(
			['explorer', 'agents', 'git'],
			'agents',
			'git',
			'after',
		),
		['explorer', 'git', 'agents'],
	);
	assert.deepEqual(
		reorderSidebarPanelIds(
			['explorer', 'git', 'agents'],
			'agents',
			'explorer',
			'before',
		),
		['agents', 'explorer', 'git'],
	);
});
