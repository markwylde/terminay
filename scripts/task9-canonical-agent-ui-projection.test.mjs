import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, terminalActivityOverview] = await Promise.all([
	readFile('src/App.tsx', 'utf8'),
	readFile('src/workspace/TerminalActivityOverview.tsx', 'utf8'),
]);

test('connected Desktop agent UI projects the canonical server snapshot into terminal panels', () => {
	assert.match(
		app,
		/const agentStatusClient = terminalClientContext\?\.agentStatusClient;[\s\S]*?if \(agentStatusClient === undefined\)[\s\S]*?subscribeServerAgentSnapshots\(\s*agentStatusClient,\s*acceptSnapshot,\s*\)/s,
	);
	assert.match(
		app,
		/aggregateAgentStatusForTerminal\(agentStatusSnapshot, sessionId\)[\s\S]*?panel\.api\.updateParameters\(\{[\s\S]*?agentState: nextState,[\s\S]*?agentNeedsAttention: nextNeedsAttention,[\s\S]*?agentUnread: nextUnread,/s,
	);
	assert.match(
		app,
		/const agentStatusClient = terminalClientContext\?\.agentStatusClient;[\s\S]*?agentStatusClient\s*\.refresh\(\)/s,
	);
	assert.match(
		app,
		/serverAgentStatusClient\.mergeSessionScope\(\[[\s\S]*?panelSessionMapRef\.current\.values\(\)/s,
	);
});

test('header activity derives agent entries from the canonical panel projection', () => {
	assert.match(
		app,
		/const agentState = panel\.params\?\.agentState;[\s\S]*?settings\.agentIntegration\.enabled && sessionId && agentState[\s\S]*?isAgentStatus: true,/s,
	);
	assert.match(
		terminalActivityOverview,
		/items\.map\(\(item\) => \{[\s\S]*?terminalOverviewStateToAgentState\(item\.state\)[\s\S]*?<AgentStatusIndicator[\s\S]*?state=\{state\}/s,
	);
});
