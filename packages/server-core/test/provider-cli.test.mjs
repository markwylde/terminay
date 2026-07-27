import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AiServiceError,
	createProviderEnvironment,
	createServerAiProviderAdapters,
} from '../dist/index.js';

const target = {
	serverId: 'server-a',
	projectId: 'project-a',
	panelId: 'panel-a',
	sessionId: 'session-a',
};

function context() {
	return {
		target,
		text: 'build output',
		bytes: 12,
		truncated: false,
		currentTitle: 'Terminal',
		existingNote: '',
	};
}

function command(script) {
	return {
		command: process.execPath,
		listArgs: () => ['-e', script],
		generateArgs: () => ['-e', script],
	};
}

test('provider environment is bounded and adds PATH entries without exposing a mutable snapshot', () => {
	const environment = createProviderEnvironment(
		{ PATH: '/bin:/usr/bin', SAFE: 'value', OMIT: undefined },
		{
			additionalPathDirectories: ['/opt/provider', '/bin'],
		},
	);
	assert.equal(environment.SAFE, 'value');
	assert.equal(environment.OMIT, undefined);
	assert.equal(environment.PATH, '/bin:/usr/bin:/opt/provider');
	assert.throws(
		() => createProviderEnvironment({ BAD: 'contains\0nul' }),
		/invalid or oversized/,
	);
	assert.throws(
		() => createProviderEnvironment({ BAD: 'contains\nnewline' }),
		/invalid or oversized/,
	);
});

test('server-owned adapters discover models and keep credentials inside provider environment', async () => {
	const adapters = createServerAiProviderAdapters({
		cwd: process.cwd(),
		environment: {
			TERMINAY_CLAUDE_CODE_MODELS_JSON: JSON.stringify([
				{ id: 'sonnet', label: 'Claude Sonnet' },
			]),
		},
		credentialEnvironmentVariables: { codex: 'TERMINAY_TEST_PROVIDER_SECRET' },
		commands: {
			codex: {
				command: process.execPath,
				listArgs: () => [
					'-e',
					"process.stdout.write(JSON.stringify({models:[{slug:'fast',display_name:'Fast',priority:1},{slug:'hidden',visibility:'hide'}]}))",
				],
				generateArgs: ({ prompt }) => [
					'-e',
					`process.stdout.write(${JSON.stringify(prompt)})`,
				],
				parseModels: (stdout) =>
					JSON.parse(stdout)
						.models.filter((model) => model.visibility !== 'hide')
						.map((model) => ({ id: model.slug, label: model.display_name })),
			},
		},
	});
	const models = await adapters.codex.listModels({
		provider: 'codex',
		signal: new AbortController().signal,
		maxOutputBytes: 1024,
	});
	assert.deepEqual(models, [{ id: 'fast', label: 'Fast' }]);
	const claudeModels = await adapters['claude-code'].listModels({
		provider: 'claude-code',
		signal: new AbortController().signal,
		maxOutputBytes: 1024,
	});
	assert.deepEqual(claudeModels, [{ id: 'sonnet', label: 'Claude Sonnet' }]);

	const generated = await adapters.codex.generate({
		provider: 'codex',
		model: 'fast',
		target: 'title',
		context: context(),
		signal: new AbortController().signal,
		maxOutputBytes: 1024,
		withCredential: async (callback) =>
			callback(new TextEncoder().encode('server-secret')),
	});
	// The fake provider prints its inherited server-only environment value.
	assert.match(generated, /Current title: Terminal/);
});

test('provider adapter passes a vault credential only to the child environment', async () => {
	const adapters = createServerAiProviderAdapters({
		cwd: process.cwd(),
		environment: {},
		credentialEnvironmentVariables: { codex: 'TERMINAY_TEST_PROVIDER_SECRET' },
		commands: {
			codex: {
				...command(
					"process.stdout.write(process.env.TERMINAY_TEST_PROVIDER_SECRET || 'missing')",
				),
			},
		},
	});
	const seen = await adapters.codex.generate({
		provider: 'codex',
		model: 'fast',
		target: 'title',
		context: context(),
		signal: new AbortController().signal,
		maxOutputBytes: 1024,
		withCredential: async (callback) =>
			callback(new TextEncoder().encode('server-secret')),
	});
	assert.equal(seen, '[redacted]');
	assert.equal(JSON.stringify(adapters).includes('server-secret'), false);
});

test('Codex and Claude adapters keep provider-specific model and stream handling server-side', async () => {
	const adapters = createServerAiProviderAdapters({
		cwd: process.cwd(),
		environment: {},
		commands: {
			codex: {
				command: process.execPath,
				listArgs: () => [
					'-e',
					"process.stdout.write(JSON.stringify({models:[{slug:'codex-fast',display_name:'Codex Fast',visibility:'list'}]}))",
				],
				parseModels: (stdout) =>
					JSON.parse(stdout).models.map((model) => ({
						id: model.slug,
						label: model.display_name,
					})),
				generateArgs: () => ['-e', "process.stdout.write('Codex title')"],
			},
			'claude-code': {
				command: process.execPath,
				listArgs: () => [
					'-e',
					"process.stdout.write(JSON.stringify({models:[{id:'claude-sonnet',label:'Claude Sonnet'}]}))",
				],
				parseModels: (stdout) => JSON.parse(stdout).models,
				generateArgs: () => [
					'-e',
					"process.stdout.write(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Claude title'}]}}))",
				],
				parseOutput: (stdout) => JSON.parse(stdout).message.content[0].text,
			},
		},
	});
	const signal = new AbortController().signal;
	assert.deepEqual(
		await adapters.codex.listModels({
			provider: 'codex',
			signal,
			maxOutputBytes: 1024,
		}),
		[{ id: 'codex-fast', label: 'Codex Fast' }],
	);
	assert.deepEqual(
		await adapters['claude-code'].listModels({
			provider: 'claude-code',
			signal,
			maxOutputBytes: 1024,
		}),
		[{ id: 'claude-sonnet', label: 'Claude Sonnet' }],
	);
	assert.equal(
		await adapters.codex.generate({
			provider: 'codex',
			model: 'codex-fast',
			target: 'title',
			context: context(),
			signal,
			maxOutputBytes: 1024,
		}),
		'Codex title',
	);
	assert.equal(
		await adapters['claude-code'].generate({
			provider: 'claude-code',
			model: 'claude-sonnet',
			target: 'title',
			context: context(),
			signal,
			maxOutputBytes: 1024,
		}),
		'Claude title',
	);
});

test('provider timeout and oversized output remain typed server errors', async () => {
	const timeoutAdapters = createServerAiProviderAdapters({
		cwd: process.cwd(),
		environment: {},
		providerTimeoutMs: 20,
		commands: {
			codex: command('setTimeout(() => process.stdout.write("late"), 1000)'),
		},
	});
	await assert.rejects(
		timeoutAdapters.codex.generate({
			provider: 'codex',
			model: 'fast',
			target: 'title',
			context: context(),
			signal: new AbortController().signal,
			maxOutputBytes: 1024,
		}),
		(error) =>
			error instanceof AiServiceError && error.code === 'provider_timeout',
	);

	const outputAdapters = createServerAiProviderAdapters({
		cwd: process.cwd(),
		environment: {},
		maxOutputBytes: 16,
		commands: { codex: command('process.stdout.write("x".repeat(1000))') },
	});
	await assert.rejects(
		outputAdapters.codex.generate({
			provider: 'codex',
			model: 'fast',
			target: 'title',
			context: context(),
			signal: new AbortController().signal,
			maxOutputBytes: 16,
		}),
		(error) =>
			error instanceof AiServiceError &&
			error.code === 'provider_output_too_large',
	);
});

test('provider cancellation terminates the child and remains typed', async () => {
	const adapters = createServerAiProviderAdapters({
		cwd: process.cwd(),
		environment: {},
		commands: {
			codex: command('setTimeout(() => process.stdout.write("late"), 1000)'),
		},
	});
	const controller = new AbortController();
	const pending = adapters.codex.generate({
		provider: 'codex',
		model: 'fast',
		target: 'title',
		context: context(),
		signal: controller.signal,
		maxOutputBytes: 1024,
	});
	await new Promise((resolve) => setImmediate(resolve));
	controller.abort();
	await assert.rejects(
		pending,
		(error) =>
			error instanceof AiServiceError && error.code === 'provider_cancelled',
	);
});
