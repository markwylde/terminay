import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
	BotAgentProcess,
	BotMemories,
	BotService,
	BotSessionStore,
	BotStore,
} from '../../dist/botService/index.js';
export const agent = {
	id: 'fake.agent',
	displayName: 'Fake',
	imageInstall: { npm: ['fake-acp@1.0.0'] },
	acpCommand: { executable: 'fake-acp', args: [] },
	autonomousOnly: false,
	credentialSecrets: [
		{
			environmentVariable: 'FAKE_KEY',
			kind: 'api-key',
			authenticateMethodId: 'api-key',
			label: 'Fake',
			help: 'Fake',
		},
	],
};
export function credential(secret = 'secret', released = () => {}) {
	return {
		environment: { FAKE_KEY: secret },
		authenticateMethodId: 'api-key',
		redact: (value) => value.split(secret).join('[redacted]'),
		release: released,
		stream: () => {
			let pending = '';
			return {
				push(chunk) {
					pending += chunk;
					let boundary = Math.max(0, pending.length - secret.length + 1);
					const start = pending.indexOf(secret);
					if (
						start >= 0 &&
						start < boundary &&
						start + secret.length > boundary
					)
						boundary = start;
					const result = pending
						.slice(0, boundary)
						.split(secret)
						.join('[redacted]');
					pending = pending.slice(boundary);
					return result;
				},
				finish() {
					const result = pending.split(secret).join('[redacted]');
					pending = '';
					return result;
				},
			};
		},
	};
}
export function memoryHelper() {
	const files = new Map();
	const changes = new EventEmitter();
	const writes = [];
	let references = 0;
	return {
		files,
		writes,
		changes,
		get references() {
			return references;
		},
		async acquire() {
			references++;
			return {
				async list() {
					return [...files].map(([name, f]) => ({
						name,
						type: 'file',
						modifiedAt: f.at,
					}));
				},
				async readText(path, max) {
					const f = files.get(path.slice(9));
					if (!f) throw new Error('not found');
					if (Buffer.byteLength(f.text) > max) throw new Error('too big');
					return f.text;
				},
				async writeText(path, contents) {
					writes.push(path);
					files.set(path.slice(9), { text: contents, at: Date.now() });
					changes.emit('changed');
				},
				async remove(path) {
					files.delete(path.slice(9));
					changes.emit('changed');
				},
				watch(_path, fn) {
					changes.on('changed', fn);
					return () => changes.off('changed', fn);
				},
				release() {
					references--;
				},
			};
		},
	};
}
export async function runtime(root, options = {}) {
	mkdirSync(root, { recursive: true });
	const bots = new BotStore(join(root, 'bots.json'));
	const sessions = new BotSessionStore(join(root, 'sessions'));
	const helper = memoryHelper();
	const memories = new BotMemories(helper, bots);
	const records = join(root, 'processes');
	mkdirSync(records, { recursive: true });
	const calls = [];
	const children = new Map();
	const spawnedEnvironments = [];
	let releases = 0;
	const activity = [];
	const kill = async (sid) => {
		const names = sid ? [sid] : readdirSync(records);
		for (const name of names) {
			let pid;
			try {
				pid = Number(readFileSync(join(records, name), 'utf8'));
			} catch {
				continue;
			}
			const child = children.get(name);
			const exited =
				child && child.exitCode === null && child.signalCode === null
					? once(child, 'close')
					: undefined;
			try {
				process.kill(-pid, 'SIGKILL');
			} catch (error) {
				if (error.code !== 'ESRCH') throw error;
			}
			if (exited) await exited;
			unlinkSync(join(records, name));
			children.delete(name);
		}
	};
	const driver = {
		details: {
			pin: {
				kind: 'docker',
				address: 'unix:///fake',
				identity: 'fake',
				connection: false,
			},
		},
		execStream(_container, args) {
            const sid=args[1];
            const child=spawn('python3',[new URL('../../../../docker/terminay-bot/bin/terminay-mcp-relay',import.meta.url).pathname,sid.slice(4)],{stdio:['pipe','pipe','pipe'],detached:true});
            children.set(sid,child);writeFileSync(join(records,sid),String(child.pid));return child;
        },
		async exec(_container, args) {
			calls.push(args);
			if (args[0] === 'terminay-run') {
				await kill(args[1] === '--kill' ? args[2] : undefined);
			}
			return '';
		},
	};
	const definitions = new Map();
	const environment = {
		register(bot) {
			definitions.set(bot.id, structuredClone(bot));
		},
		definition(id) {
			if (!definitions.has(id)) throw new Error('not found');
			return structuredClone(definitions.get(id));
		},
		async prepareSession() {},
		async remove() {},
		async stop(id) {
			await service.stopBot(id);
		},
		async reconcileAll() {
			if (options.engineAvailable === false)
				throw new Error('engine unavailable');
		},
		state() {
			return 'running';
		},
	};
	const hooks = {
		agents: {
			botAgentContributions: () => [
				{
					extensionId: 'fake',
					contribution: {
						...agent,
						autonomousOnly: options.autonomousOnly ?? false,
					},
				},
			],
			botAgentModels: async () => ({
				available: true,
				value: [{ id: 'selected', displayName: 'Selected' }],
			}),
			botAgentStatus: async () => ({
				available: true,
				value: { state: 'ready' },
			}),
			botAgentLaunch: async (id, request) => {
				calls.push(['launch', id, request.modelId]);
				return { available: true, value: { args: [], env: {} } };
			},
		},
		environment,
		driver: async () => driver,
		credentials: {
			acquire: async () => credential('secret', () => releases++),
		},
		removeHelpers: async () => calls.push(['remove-helpers']),
		activity: (...a) => activity.push(a),
		process: (o) =>
			new BotAgentProcess({
				...o,
				spawn: (_command, env) => {
					spawnedEnvironments.push(env);
					const child = spawn(
						process.execPath,
						[new URL('./bot-acp.mjs', import.meta.url).pathname],
						{
							env: { ...process.env, ...env, ...options.env },
							stdio: ['pipe', 'pipe', 'pipe'],
							detached: true,
						},
					);
					children.set(o.sessionId, child);
					writeFileSync(join(records, o.sessionId), String(child.pid));
					return child;
				},
			}),
	};
	const service = new BotService(bots, sessions, memories, hooks);
	await service.reconcile();
	return {
		hooks,
		service,
		spawnedEnvironments,
		environment,
		bots,
		sessions,
		helper,
		memories,
		calls,
		activity,
		children,
		kill,
		get releases() {
			return releases;
		},
	};
}
export function until(emitter, event, predicate) {
	if (predicate()) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			emitter.off(event, check);
			reject(new Error(`deadline waiting for ${event}`));
		}, 5000);
		const check = () => {
			if (predicate()) {
				clearTimeout(timer);
				emitter.off(event, check);
				resolve();
			}
		};
		emitter.on(event, check);
	});
}
