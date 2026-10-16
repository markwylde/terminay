import assert from 'node:assert/strict';
import test from 'node:test';
import {
	onboardingSuggestions,
	pixelDockLabel,
	pixelMessages,
	pixelNeedsAttention,
	providerForChoice,
} from './pixelModel.ts';

const chat = (entries: unknown[], extra: Record<string, unknown> = {}) =>
	({
		id: 'c1',
		title: 'Pixel',
		providerId: 'p',
		providerName: 'Claude Code',
		reach: { kind: 'workspace' },
		status: 'idle',
		revision: 9,
		pendingApprovals: 0,
		createdAt: 0,
		order: entries.map((entry) => (entry as { id: string }).id),
		entries,
		...extra,
	}) as never;

test('entries become balloon messages, with activity as lines', () => {
	const messages = pixelMessages(
		chat([
			{
				id: 'u',
				kind: 'user',
				text: 'what is my build doing?',
				createdAt: 1,
				revision: 1,
			},
			{
				id: 'a',
				kind: 'assistant',
				createdAt: 2,
				revision: 2,
				parts: [
					{
						type: 'activity',
						callId: 'x',
						text: 'Reading build',
						state: 'completed',
					},
					{ type: 'text', text: 'It is ' },
					{ type: 'text', text: 'compiling.' },
				],
			},
			{
				id: 'n',
				kind: 'notice',
				tone: 'error',
				text: 'Codex is not signed in.',
				createdAt: 3,
				revision: 3,
			},
		]),
	);
	assert.deepEqual(
		messages.map((message) => [message.role, message.text]),
		[
			['user', 'what is my build doing?'],
			['assistant', '✓ Reading build\nIt is compiling.'],
			['assistant', 'Codex is not signed in.'],
		],
	);
});

test('a reply with nothing in it yet is left to the typing dots', () => {
	assert.deepEqual(
		pixelMessages(
			chat([
				{ id: 'a', kind: 'assistant', parts: [], createdAt: 1, revision: 1 },
			]),
		),
		[],
	);
});

test('a pending approval offers the three choices, a decided one records the outcome', () => {
	const pending = pixelMessages(
		chat([
			{
				id: 'p',
				kind: 'approval',
				approvalId: 'apr',
				statement: 'Pixel (Claude Code) wants to run `npm test` in api',
				groupLabel: 'Full Terminal Management',
				details: [{ label: 'Command', value: 'npm test' }],
				state: 'pending',
				createdAt: 1,
				revision: 1,
			},
		]),
	)[0];
	assert.equal(
		pending?.text,
		'Pixel (Claude Code) wants to run `npm test` in api\nCommand: npm test',
	);
	assert.deepEqual(
		pending?.actions?.map((action) => action.label),
		['Allow One Time', 'Allow This Session', 'Decline'],
	);
	const decided = pixelMessages(
		chat([
			{
				id: 'p',
				kind: 'approval',
				approvalId: 'apr',
				statement: 'Pixel wants to run x',
				groupLabel: 'g',
				details: [],
				state: 'declined',
				createdAt: 1,
				revision: 2,
			},
		]),
	)[0];
	assert.equal(decided?.actions, undefined);
	assert.match(decided?.text ?? '', /→ Declined$/);
});

test('attention follows pending approvals', () => {
	assert.equal(pixelNeedsAttention(chat([], { pendingApprovals: 1 })), true);
	assert.equal(pixelNeedsAttention(undefined), false);
	assert.match(pixelDockLabel('attention'), /needs your answer/);
});

test('onboarding offers only the agents this server can run', () => {
	const providers = [
		{ id: 'c', displayName: 'Claude Code', available: true },
		{
			id: 'x',
			displayName: 'Codex',
			available: false,
			reason: 'not_installed' as const,
		},
	];
	assert.deepEqual(onboardingSuggestions(providers), ['Claude Code']);
	assert.equal(providerForChoice(providers, ' claude code ')?.id, 'c');
	assert.equal(providerForChoice(providers, 'Codex'), undefined);
});

test('the first-click greeting says why no agent can be chosen', async () => {
	const { onboardingGreeting } = await import('./pixelModel.ts');
	assert.match(onboardingGreeting([{ id: 'c', displayName: 'Claude Code', available: true }]), /Which agent/);
	assert.match(onboardingGreeting([]), /still looking/);
	assert.equal(
		onboardingGreeting([
			{ id: 'c', displayName: 'Claude Code', available: false, reason: 'not_signed_in', detail: 'Run `claude` to sign in.' },
			{ id: 'x', displayName: 'Codex', available: false, reason: 'not_installed' },
		]),
		"Hi! I'm Pixel. I need Claude Code or Codex on this server. Claude Code is not signed in. Run `claude` to sign in. Codex is not installed.",
	);
});
