import assert from 'node:assert/strict';
import test from 'node:test';
import {
	agentModelLabel,
	isGenericTerminalTitle,
	joinMetadata,
	meaningfulDisplayName,
	providerLabel,
	resolveAgentPresentation,
} from '../src/agents/agentPresentation.ts';

function root(overrides = {}) {
	return {
		active: true,
		activationTerminalSessionId: 'term-1',
		activeTools: [],
		agentId: 'a-1',
		entryId: 'e-1',
		inProcess: false,
		kind: 'root',
		lastEventKind: 'turn.started',
		lastEventSequence: 1,
		provider: 'terminay/claude-code',
		providerDisplayName: 'Claude Code',
		sessionId: 's-1',
		state: 'working',
		stateStartedAt: 0,
		terminalSessionId: 'term-1',
		unread: false,
		updatedAt: 0,
		...overrides,
	};
}

function subagent(overrides = {}) {
	return {
		...root(),
		agentId: 'a-2',
		entryId: 'e-2',
		inProcess: true,
		kind: 'subagent',
		parentAgentId: 'a-1',
		parentEntryId: 'e-1',
		terminalSessionId: null,
		...overrides,
	};
}

test('a provider with no display name is titled from its id', () => {
	assert.equal(
		providerLabel(root({ providerDisplayName: undefined, provider: 'acme/open-code' })),
		'Open Code',
	);
	assert.equal(providerLabel(root()), 'Claude Code');
});

test('placeholder display names say nothing and are discarded', () => {
	for (const displayName of ['default', 'Agent', 'SUBAGENT', 'Claude Code']) {
		assert.equal(meaningfulDisplayName(root({ displayName })), undefined);
	}
	assert.equal(meaningfulDisplayName(root({ displayName: 'Fix the parser' })), 'Fix the parser');
});

test('a workspace-given terminal name is generic; a chosen one is not', () => {
	assert.equal(isGenericTerminalTitle('Terminal'), true);
	assert.equal(isGenericTerminalTitle('terminal 12'), true);
	assert.equal(isGenericTerminalTitle('Server logs'), false);
	assert.equal(isGenericTerminalTitle(undefined), false);
});

test('metadata joins only what is present and not already said', () => {
	assert.equal(joinMetadata(['Claude Code', undefined, 'claude code', 'Opus']), 'Claude Code · Opus');
	assert.equal(joinMetadata([' ', undefined]), '');
});

test('a root falls back through title, terminal name, prompt, then provider', () => {
	assert.equal(resolveAgentPresentation(root()).name, 'Claude Code');
	assert.equal(
		resolveAgentPresentation(root(), { prompt: 'Isolate tenants' }).name,
		'Isolate tenants',
	);
	assert.equal(
		resolveAgentPresentation(root(), {
			prompt: 'Isolate tenants',
			terminalTitle: 'Tenant work',
		}).name,
		'Tenant work',
	);
	assert.equal(
		resolveAgentPresentation(root({ displayName: 'Audit CSP' }), {
			prompt: 'Isolate tenants',
			terminalTitle: 'Tenant work',
		}).name,
		'Audit CSP',
	);
});

test('a generic terminal name never becomes the agent title', () => {
	const presentation = resolveAgentPresentation(root(), {
		prompt: 'Isolate tenants',
		terminalTitle: 'Terminal 1',
	});
	assert.equal(presentation.name, 'Isolate tenants');
	assert.equal(presentation.metadata, 'Terminal 1 · Claude Code');
});

test('a root never repeats its own name in its metadata', () => {
	const presentation = resolveAgentPresentation(root(), {
		model: 'Opus 5',
		terminalTitle: 'Claude Code',
	});
	assert.equal(presentation.name, 'Claude Code');
	assert.equal(presentation.metadata, 'Opus 5');
});

test('a prompt that is already the name is not repeated beneath it', () => {
	const presentation = resolveAgentPresentation(root(), { prompt: 'Isolate tenants' });
	assert.equal(presentation.name, 'Isolate tenants');
	assert.equal(presentation.prompt, undefined);
});

test('a subagent is numbered when it has nothing else, and inherits nothing it shares', () => {
	assert.equal(
		resolveAgentPresentation(subagent(), {}, { siblingIndex: 2 }).name,
		'Subagent 3',
	);
	const shared = resolveAgentPresentation(
		subagent(),
		{ model: 'Opus 5' },
		{ parentProvider: 'terminay/claude-code', parentModel: 'Opus 5' },
	);
	assert.equal(shared.metadata, undefined);
	const differing = resolveAgentPresentation(
		subagent({ provider: 'terminay/grok', providerDisplayName: 'Grok' }),
		{ model: 'grok-4.6' },
		{ parentProvider: 'terminay/claude-code', parentModel: 'Opus 5' },
	);
	assert.equal(differing.metadata, 'Grok · grok-4.6');
});

test('a model label prefers the display name over the id', () => {
	assert.equal(agentModelLabel(root({ model: { id: 'claude-opus-5', displayName: 'Opus 5' } })), 'Opus 5');
	assert.equal(agentModelLabel(root({ model: { id: 'claude-opus-5' } })), 'claude-opus-5');
	assert.equal(agentModelLabel(root()), undefined);
});
