import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineExtension, defineSessionSource } from '@terminay/extension-api';

const sourceId = 'dev.terminay.agent-fixture/sessions';

// Fixture Agent rewrites `<home>/live.json` with every live session it runs.
async function readLive(path) {
	try {
		const records = JSON.parse(await readFile(path, 'utf8'));
		return Array.isArray(records)
			? records.map((record) => ({
					id: String(record.id),
					harness: 'fixture-agent',
					pid: record.pid,
					cwd: record.cwd,
					title: bounded(record.title),
					status: record.status,
				}))
			: [];
	} catch {
		return [];
	}
}

const source = defineSessionSource({
	async start({
		enabledHarnesses,
		publisher,
		signal,
		onEnabledHarnessesChanged,
	}) {
		const home =
			process.env.FIXTURE_AGENT_HOME || join(homedir(), '.fixture-agent');
		const path = join(home, 'live.json');
		let enabled = enabledHarnesses.includes('fixture-agent');
		const publish = async () => {
			const sessions = enabled ? await readLive(path) : [];
			if (!signal.aborted) publisher.reset(sessions);
		};
		watch(home, { signal }, (_event, name) => {
			if (name === 'live.json') void publish();
		});
		const subscription = onEnabledHarnessesChanged((next) => {
			enabled = next.includes('fixture-agent');
			void publish();
		});
		signal.addEventListener('abort', () => subscription.dispose(), {
			once: true,
		});
		await publish();
	},
});

function bounded(value, limit = 200) {
	return typeof value === 'string' && value.trim()
		? value.trim().slice(0, limit)
		: undefined;
}

export default defineExtension({
	activate(context) {
		context.subscriptions.add(
			context.agents.registerSessionSource(sourceId, source),
		);
	},
});
