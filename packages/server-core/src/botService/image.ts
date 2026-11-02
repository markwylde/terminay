import { createHash, randomUUID } from 'node:crypto';
import {
	cp,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	type BotAgentContribution,
	validateBotAgentContribution,
} from '@terminay/extension-api';
import type { EngineDriver } from './engine.js';

/** Image inputs copied from validated bot-agent declarations. */
export interface BotAgentInstall {
	readonly id: string;
	readonly install: {
		readonly npm: readonly string[];
		readonly apt?: readonly string[];
	};
}

export function botAgentInstalls(
	contributions: readonly BotAgentContribution[],
): BotAgentInstall[] {
	return contributions.map((contribution) => {
		const result = validateBotAgentContribution(
			contribution,
			contribution.id.split('/')[0] ?? '',
		);
		if (!result.ok) throw new TypeError('invalid bot agent contribution');
		return {
			id: result.value.id,
			install: {
				npm: [...result.value.imageInstall.npm],
				apt: [...(result.value.imageInstall.debian ?? [])],
			},
		};
	});
}
export const BOT_IMAGE = 'terminay-bot:local';
const npmPin =
	/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const debianName = /^[a-z0-9][a-z0-9+.-]+$/;

export function agentLayer(agents: readonly BotAgentInstall[]): string {
	if (agents.length > 256) throw new TypeError('too many bot agents');
	const npm = new Map<string, string>();
	const apt = new Set<string>();
	const ids = new Set<string>();
	for (const agent of agents) {
		if (!agent.id || ids.has(agent.id))
			throw new TypeError('duplicate or missing bot agent id');
		ids.add(agent.id);
		if (
			!Array.isArray(agent.install?.npm) ||
			agent.install.npm.length > 64 ||
			(agent.install.apt?.length ?? 0) > 64
		)
			throw new TypeError('invalid agent install lists');
		for (const specifier of agent.install.npm) {
			if (specifier.length > 256 || !npmPin.test(specifier))
				throw new TypeError('bot adapter must use an exact npm version');
			const name = specifier.slice(0, specifier.lastIndexOf('@'));
			if (npm.has(name) && npm.get(name) !== specifier)
				throw new TypeError('conflicting bot adapter versions');
			npm.set(name, specifier);
		}
		for (const name of agent.install.apt ?? []) {
			if (name.length > 128 || !debianName.test(name))
				throw new TypeError('invalid Debian package name');
			apt.add(name);
		}
	}
	return [
		'# Generated from validated bot-agent install lists.',
		...(apt.size
			? [
					`RUN apt-get update && apt-get install -y --no-install-recommends ${[...apt].sort().join(' ')} && rm -rf /var/lib/apt/lists/*`,
				]
			: []),
		...(npm.size
			? [`RUN npm install -g -- ${[...npm.values()].sort().join(' ')}`]
			: []),
		// Expose the adapter's compatible Codex, without a separate CLI install.
		...(npm.has('@agentclientprotocol/codex-acp')
			? [
					'RUN ln -s /usr/local/lib/node_modules/@agentclientprotocol/codex-acp/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex && codex --version',
				]
			: []),
		'',
	].join('\n');
}

export interface BotImagePlan {
	readonly dockerfile: string;
	readonly fingerprint: string;
	readonly uid: number;
	readonly gid: number;
}
export async function planBotImage(
	contextPath: string,
	agents: readonly BotAgentInstall[],
	uid: number,
	gid: number,
): Promise<BotImagePlan> {
	if (![uid, gid].every((id) => Number.isSafeInteger(id) && id > 0))
		throw new TypeError('bot uid and gid must be positive');
	const layer = agentLayer(agents);
	const hash = createHash('sha256');
	async function hashDirectory(relative: string): Promise<void> {
		const entries = await readdir(path.join(contextPath, relative), {
			withFileTypes: true,
		});
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const name = path.join(relative, entry.name);
			if (entry.isSymbolicLink())
				throw new TypeError('image context must not contain links');
			if (entry.isDirectory()) await hashDirectory(name);
			else if (entry.isFile()) {
				const bytes = await readFile(path.join(contextPath, name));
				hash.update(JSON.stringify([name, bytes.length]));
				hash.update(bytes);
			} else throw new TypeError('unsupported image context entry');
		}
	}
	await hashDirectory('');
	hash.update(
		JSON.stringify({
			layer,
			agents: agents.map((agent) => agent.id).sort(),
			uid,
			gid,
		}),
	);
	const fingerprint = hash.digest('hex');
	const base = await readFile(path.join(contextPath, 'Dockerfile'), 'utf8');
	return {
		dockerfile: `${base}\n${layer}LABEL terminay.fingerprint="${fingerprint}"\n`,
		fingerprint,
		uid,
		gid,
	};
}

/** Serialize through the owning service; publish the local tag only on success. */
export async function buildBotImage(
	driver: EngineDriver,
	contextPath: string,
	plan: BotImagePlan,
	onOutput?: (chunk: string) => void,
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), 'terminay-bot-image-'));
	const temporaryTag = `terminay-bot:build-${randomUUID()}`;
	try {
		await cp(contextPath, directory, { recursive: true });
		await writeFile(path.join(directory, 'Dockerfile'), plan.dockerfile);
		await driver.run(
			[
				'build',
				'--tag',
				temporaryTag,
				'--build-arg',
				`BOT_UID=${plan.uid}`,
				'--build-arg',
				`BOT_GID=${plan.gid}`,
				directory,
			],
			{ deadlineMs: 15 * 60_000, onOutput, tail: true, maxBytes: 256 * 1024 },
		);
		await driver.run(['image', 'tag', temporaryTag, BOT_IMAGE]);
	} finally {
		await driver.run(['image', 'rm', temporaryTag]).catch(() => undefined);
		await rm(directory, { recursive: true, force: true });
	}
}
