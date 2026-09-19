import { watch } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
	boundedAgentText,
	defineMcpInstallTarget,
	defineSessionSource,
	EXTENSION_LIMITS,
} from '@terminay/extension-api';

// Example Agent keeps one `<pid>.json` file per live process under
// `<home>/sessions/`, and deletes it when the process exits.
function exampleHome() {
	return process.env.EXAMPLE_AGENT_HOME || join(homedir(), '.example-agent');
}

async function readSession(directory, name) {
	const match = /^(\d+)\.json$/.exec(name);
	if (!match) return undefined;
	try {
		const record = JSON.parse(await readFile(join(directory, name), 'utf8'));
		if (typeof record.id !== 'string' || typeof record.cwd !== 'string')
			return undefined;
		return {
			id: record.id,
			harness: 'example-agent',
			pid: Number(match[1]),
			cwd: record.cwd,
			title: boundedAgentText(record.title, EXTENSION_LIMITS.agentTitleLength),
			status: ['running', 'waiting', 'idle'].includes(record.status)
				? record.status
				: undefined,
		};
	} catch {
		// Mid-write or already gone: the next watch event settles it.
		return undefined;
	}
}

export const exampleSessionSource = defineSessionSource({
	async start({
		enabledHarnesses,
		publisher,
		signal,
		onEnabledHarnessesChanged,
	}) {
		const directory = join(exampleHome(), 'sessions');
		await mkdir(directory, { recursive: true });
		let enabled = enabledHarnesses.includes('example-agent');
		const live = new Map(); // file name -> session id

		async function resetAll() {
			live.clear();
			if (!enabled) return publisher.reset([]);
			const sessions = [];
			for (const name of await readdir(directory)) {
				const session = await readSession(directory, name);
				if (!session) continue;
				live.set(name, session.id);
				sessions.push(session);
			}
			if (!signal.aborted) publisher.reset(sessions);
		}

		// Watch, never poll. Each event re-reads only the file it names.
		const watcher = watch(directory, { signal }, async (_event, name) => {
			if (!enabled || typeof name !== 'string') return;
			const session = await readSession(directory, name);
			if (signal.aborted) return;
			if (session) {
				live.set(name, session.id);
				publisher.upsert(session);
			} else if (live.has(name)) {
				publisher.remove(live.get(name));
				live.delete(name);
			}
		});
		watcher.on('error', () => {
			publisher.diagnostic({
				code: 'watch-failed',
				message: 'Example Agent sessions can no longer be watched',
			});
		});

		const subscription = onEnabledHarnessesChanged((next) => {
			enabled = next.includes('example-agent');
			void resetAll();
		});
		signal.addEventListener('abort', () => subscription.dispose(), {
			once: true,
		});
		await resetAll();
	},
});

function configPath() {
	return join(exampleHome(), 'mcp.json');
}

async function readConfig() {
	try {
		return JSON.parse(await readFile(configPath(), 'utf8'));
	} catch (error) {
		if (error?.code === 'ENOENT') return {};
		throw error;
	}
}

async function writeConfig(config) {
	await mkdir(exampleHome(), { recursive: true });
	const temporary = `${configPath()}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`);
	await rename(temporary, configPath());
}

const sameServer = (entry, server) =>
	JSON.stringify(entry) ===
	JSON.stringify({
		command: server.command,
		args: server.args,
		env: server.env ?? {},
	});

export const exampleMcpInstallTarget = defineMcpInstallTarget({
	async status({ server }) {
		try {
			const entry = (await readConfig()).mcpServers?.terminay;
			if (entry === undefined)
				return { state: 'not-installed', configPath: configPath() };
			return sameServer(entry, server)
				? { state: 'installed', configPath: configPath() }
				: {
						state: 'changed',
						configPath: configPath(),
						message: 'The terminay entry points at a different command',
					};
		} catch {
			return {
				state: 'error',
				configPath: configPath(),
				message: 'The configuration file is not valid JSON',
			};
		}
	},
	async install({ server }) {
		const config = await readConfig();
		config.mcpServers = {
			...config.mcpServers,
			terminay: {
				command: server.command,
				args: server.args,
				env: server.env ?? {},
			},
		};
		await writeConfig(config);
		return { ok: true, installed: true };
	},
	async uninstall() {
		const config = await readConfig();
		if (config.mcpServers?.terminay !== undefined) {
			delete config.mcpServers.terminay;
			await writeConfig(config);
		}
		return { ok: true, installed: false };
	},
});
