import { createHash, randomUUID } from 'node:crypto';
import {
	cp,
	lstat,
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
import { BOT_BROWSER_SECCOMP } from './browserSandbox.js';
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
		'',
	].join('\n');
}

/** The build-context paths a Dockerfile's COPY and ADD instructions read,
 * sorted and de-duplicated. Copies from another stage read no context. */
export function dockerfileSources(dockerfile: string): string[] {
	const sources = new Set<string>();
	const lines = dockerfile.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
	for (const line of lines) {
		const words = line.trim().split(/\s+/);
		const instruction = words[0]?.toUpperCase();
		if (instruction !== 'COPY' && instruction !== 'ADD') continue;
		const args = words.slice(1);
		if (args.some((word) => /^--from=.+/.test(word))) continue;
		// Forms whose sources cannot be read reliably fail the plan, so no
		// built input can quietly escape the fingerprint.
		if (args[0]?.startsWith('['))
			throw new TypeError('JSON-form COPY is not supported in the bot image');
		if (args.some((word) => word.startsWith('<<')))
			throw new TypeError('heredoc COPY is not supported in the bot image');
		const paths = args.filter((word) => !word.startsWith('--'));
		if (paths.length < 2 || args.some((word) => word === '--from'))
			throw new TypeError('bot image COPY sources must be literal paths');
		for (const source of paths.slice(0, -1)) {
			const name = path.normalize(source);
			if (
				/[*?[\]$'"\\]/.test(source) ||
				source.split(/[\\/]/).includes('..') ||
				/^[a-z][a-z0-9+.-]*:\/\//i.test(source) ||
				name === '..' ||
				name.startsWith(`..${path.sep}`) ||
				path.isAbsolute(name)
			)
				throw new TypeError('bot image COPY sources must be literal paths');
			sources.add(name);
		}
	}
	return [...sources].sort((a, b) => a.localeCompare(b));
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
	hash.update(JSON.stringify(BOT_BROWSER_SECCOMP));
	const base = await readFile(path.join(contextPath, 'Dockerfile'), 'utf8');
	async function hashEntry(name: string): Promise<void> {
		// lstat on the leaf alone follows links in parent components.
		let parent = path.dirname(name);
		while (parent !== '.') {
			if ((await lstat(path.join(contextPath, parent))).isSymbolicLink())
				throw new TypeError('image context must not contain links');
			parent = path.dirname(parent);
		}
		const entry = await lstat(path.join(contextPath, name));
		if (entry.isSymbolicLink())
			throw new TypeError('image context must not contain links');
		if (entry.isDirectory()) {
			hash.update(JSON.stringify([name, 'directory', entry.mode & 0o111]));
			const entries = await readdir(path.join(contextPath, name));
			for (const child of entries.sort((a, b) => a.localeCompare(b)))
				await hashEntry(path.join(name, child));
		} else if (entry.isFile()) {
			const bytes = await readFile(path.join(contextPath, name));
			const executable = (entry.mode & 0o111) !== 0;
			hash.update(JSON.stringify([name, bytes.length, executable]));
			hash.update(bytes);
		} else throw new TypeError('unsupported image context entry');
	}
	// Only what the image is built from: the Dockerfile, its ignore file and
	// the context files it copies. Tests and notes beside it never make
	// containers out of date.
	const ignore = await lstat(path.join(contextPath, '.dockerignore')).then(
		() => ['.dockerignore'],
		(error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		},
	);
	for (const name of ['Dockerfile', ...ignore, ...dockerfileSources(base)])
		await hashEntry(name);
	hash.update(
		JSON.stringify({
			layer,
			agents: agents.map((agent) => agent.id).sort(),
			uid,
			gid,
		}),
	);
	const fingerprint = hash.digest('hex');
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
	onPhase?: (
		id: string,
		description: string,
		state: 'running' | 'completed',
	) => void,
	onBuildEvent?: (event: Record<string, unknown>) => void,
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), 'terminay-bot-image-'));
	const temporaryTag = `terminay-bot:build-${randomUUID()}`;
	try {
		await cp(contextPath, directory, { recursive: true });
		await writeFile(path.join(directory, 'Dockerfile'), plan.dockerfile);
		onPhase?.('prepare', 'Preparing image build', 'completed');
		onPhase?.('build', 'Building the bot image', 'running');
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
			{
				deadlineMs: 15 * 60_000,
				onOutput,
				onBuildEvent,
				tail: true,
				maxBytes: 256 * 1024,
			},
		);
		onPhase?.('build', 'Building the bot image', 'completed');
		onPhase?.('publish', 'Publishing the local bot image', 'running');
		await driver.run(['image', 'tag', temporaryTag, BOT_IMAGE]);
		onPhase?.('publish', 'Publishing the local bot image', 'completed');
	} finally {
		await driver.run(['image', 'rm', temporaryTag]).catch(() => undefined);
		await rm(directory, { recursive: true, force: true });
	}
}
