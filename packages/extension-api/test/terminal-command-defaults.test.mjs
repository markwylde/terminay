import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	EXTENSION_LIMITS,
	createAgentExtensionHarness,
	defineExtension,
	defineTerminalCommandDefault,
	isTerminalCommandDefaultArgs,
	isTerminalCommandName,
	validManifestFixture,
	validateExtensionManifest,
	validateTerminalCommandDefaultContribution,
	validateTerminalCommandDefaultResolution,
} from '../dist/index.js';

const id = validManifestFixture.id;
const defaultId = `${id}/echo-defaults`;
const sourceId = `${id}/agents`;
const defaultsManifest = Object.freeze({
	...validManifestFixture,
	permissions: ['terminal-command-defaults'],
	contributes: {
		terminalCommandDefaults: [{ id: defaultId, command: 'echo-agent' }],
	},
});
const harnessManifest = Object.freeze({
	...validManifestFixture,
	permissions: ['terminal-command-defaults', 'agent-observation'],
	contributes: {
		agentSessionSources: [
			{
				id: sourceId,
				displayName: 'Agents',
				harnesses: [{ id: 'echo', displayName: 'Echo' }],
			},
		],
		terminalCommandDefaults: [
			{
				id: defaultId,
				command: 'echo-agent',
				harness: { source: sourceId, harness: 'echo' },
			},
		],
	},
});
const unsupported = defineTerminalCommandDefault({
	async resolve() {
		return { applies: false, reason: 'unsupported' };
	},
});

test('a command-default-only package passes contribution validation', () => {
	assert.equal(validateExtensionManifest(defaultsManifest).ok, true);
});

test('a command default may name a harness its package declares', () => {
	assert.equal(validateExtensionManifest(harnessManifest).ok, true);
});

test('terminal command defaults require terminal-command-defaults', () => {
	const result = validateExtensionManifest({
		...defaultsManifest,
		permissions: [],
	});
	assert.equal(result.ok, false);
	assert.ok(
		result.issues.some(
			(issue) =>
				issue.code === 'missing_permission' &&
				/terminal-command-defaults/.test(issue.message),
		),
	);
});

test('a command default cannot name a harness its package does not declare', () => {
	const result = validateExtensionManifest({
		...harnessManifest,
		contributes: {
			...harnessManifest.contributes,
			terminalCommandDefaults: [
				{
					id: defaultId,
					command: 'echo-agent',
					harness: { source: sourceId, harness: 'other' },
				},
			],
		},
	});
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((issue) => issue.code === 'undeclared_harness'));
});

test('command default declarations are namespaced, closed, and name a plain command', () => {
	assert.equal(
		validateTerminalCommandDefaultContribution(
			{ id: defaultId, command: 'codex' },
			id,
		).ok,
		true,
	);
	assert.equal(
		validateTerminalCommandDefaultContribution(
			{ id: 'other.ext/echo', command: 'codex' },
			id,
		).ok,
		false,
	);
	assert.equal(
		validateTerminalCommandDefaultContribution(
			{ id: defaultId, command: 'codex', args: ['--x'] },
			id,
		).ok,
		false,
	);
	for (const command of [
		'cd',
		'CD',
		'eval',
		'source',
		'function',
		'foreach',
		'string',
		'param',
		'',
		'-codex',
		'co dex',
		'co;dex',
		'a/b',
		'$x',
		'x'.repeat(65),
	])
		assert.equal(
			validateTerminalCommandDefaultContribution({ id: defaultId, command }, id)
				.ok,
			false,
			command,
		);
});

test('command names are plain words that no supported shell reserves', () => {
	for (const name of [
		'codex',
		'claude',
		'my-agent',
		'agent.v2',
		'_x',
		'9lives',
	])
		assert.equal(isTerminalCommandName(name), true, name);
	for (const name of [
		'cd',
		'exec',
		'command',
		'builtin',
		'then',
		'end',
		'and',
		'set_color',
		'try',
		'.',
		'..',
		'x y',
	])
		assert.equal(isTerminalCommandName(name), false, name);
});

test('arguments are bounded flags with no control characters', () => {
	assert.equal(isTerminalCommandDefaultArgs(['--no-daemon']), true);
	assert.equal(
		isTerminalCommandDefaultArgs(['--model=a b', '-c', "--x='$(y)';z"]),
		true,
	);
	assert.equal(isTerminalCommandDefaultArgs([]), false);
	assert.equal(isTerminalCommandDefaultArgs(['exec']), false);
	assert.equal(isTerminalCommandDefaultArgs(['--a\nb']), false);
	assert.equal(isTerminalCommandDefaultArgs(['--a\u001eb']), false);
	assert.equal(isTerminalCommandDefaultArgs(['--a\u0085b']), false);
	assert.equal(
		isTerminalCommandDefaultArgs([
			`-${'x'.repeat(EXTENSION_LIMITS.commandDefaultArgLength)}`,
		]),
		false,
	);
	assert.equal(
		isTerminalCommandDefaultArgs(
			Array(EXTENSION_LIMITS.commandDefaultArgs + 1).fill('-x'),
		),
		false,
	);
});

test('a resolution reports flags or a bounded reason and nothing else', () => {
	assert.deepEqual(
		validateTerminalCommandDefaultResolution({
			applies: true,
			args: ['--no-daemon'],
			command: 'rm',
		}).value,
		{ applies: true, args: ['--no-daemon'] },
	);
	assert.equal(
		validateTerminalCommandDefaultResolution({ applies: true, args: ['exec'] })
			.ok,
		false,
	);
	assert.equal(
		validateTerminalCommandDefaultResolution({ applies: 'yes' }).ok,
		false,
	);
	assert.equal(
		validateTerminalCommandDefaultResolution({ applies: false, reason: 'nope' })
			.ok,
		false,
	);
	const long = validateTerminalCommandDefaultResolution({
		applies: false,
		reason: 'unsupported',
		detail: 'x'.repeat(5000),
	});
	assert.equal(
		long.value.detail.length,
		EXTENSION_LIMITS.commandDefaultDetailLength,
	);
});

test('a declared command default registers and resolves through the harness', async () => {
	const harness = await createAgentExtensionHarness(
		defineExtension({
			activate(context) {
				context.subscriptions.add(
					context.terminals.registerCommandDefault(
						defaultId,
						defineTerminalCommandDefault({
							async resolve() {
								return { applies: true, args: ['--no-daemon'] };
							},
						}),
					),
				);
			},
		}),
		{ manifest: defaultsManifest },
	);
	assert.deepEqual(harness.registeredCommandDefaultIds(), [defaultId]);
	assert.deepEqual(await harness.resolveCommandDefault(defaultId), {
		applies: true,
		args: ['--no-daemon'],
	});
	await harness.dispose();
});

test('registering an undeclared command default is refused', async () => {
	await assert.rejects(
		createAgentExtensionHarness(
			defineExtension({
				activate(context) {
					context.terminals.registerCommandDefault(
						`${id}/undeclared`,
						unsupported,
					);
				},
			}),
			{ manifest: defaultsManifest },
		),
		/undeclared/,
	);
});

test('registering a command default twice is refused', async () => {
	await assert.rejects(
		createAgentExtensionHarness(
			defineExtension({
				activate(context) {
					context.terminals.registerCommandDefault(defaultId, unsupported);
					context.terminals.registerCommandDefault(defaultId, unsupported);
				},
			}),
			{ manifest: defaultsManifest },
		),
		/Duplicate/,
	);
});

test('registering a command default after deactivation is refused', async () => {
	let saved;
	const harness = await createAgentExtensionHarness(
		defineExtension({
			activate(context) {
				saved = context;
			},
		}),
		{ manifest: defaultsManifest },
	);
	await harness.release('disable');
	assert.throws(
		() => saved.terminals.registerCommandDefault(defaultId, unsupported),
		/deactivated/,
	);
});

test("the README's command default example passes manifest validation", async () => {
	const readme = await readFile(
		new URL('../README.md', import.meta.url),
		'utf8',
	);
	const section = readme.slice(readme.indexOf('## Terminal command defaults'));
	const start = section.indexOf('```json') + '```json'.length;
	const example = JSON.parse(
		section.slice(start, section.indexOf('```', start)),
	);
	const result = validateExtensionManifest({
		...validManifestFixture,
		id: 'com.example.agents',
		...example,
	});
	assert.equal(result.ok, true, JSON.stringify(result.issues));
});
