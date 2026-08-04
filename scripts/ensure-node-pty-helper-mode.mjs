import { chmod, lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function executableHelper(path) {
	const details = await lstat(path).catch((error) => {
		if (error?.code === 'ENOENT') return undefined;
		throw error;
	});
	if (details === undefined) return false;
	if (!details.isFile() || details.isSymbolicLink()) {
		throw new Error(`node-pty spawn helper must be a regular file: ${path}`);
	}
	await chmod(path, details.mode | 0o111);
	return true;
}

export async function ensureNodePtyHelperMode(nodePtyRoot) {
	const root = resolve(nodePtyRoot);
	const helpers = [join(root, 'build', 'Release', 'spawn-helper')];
	const prebuilds = join(root, 'prebuilds');
	const platforms = await readdir(prebuilds, { withFileTypes: true }).catch(
		(error) => {
			if (error?.code === 'ENOENT') return [];
			throw error;
		},
	);
	for (const platform of platforms) {
		if (platform.isDirectory() && !platform.isSymbolicLink()) {
			helpers.push(join(prebuilds, platform.name, 'spawn-helper'));
		}
	}
	let repaired = 0;
	for (const helper of helpers) {
		if (await executableHelper(helper)) repaired += 1;
	}
	return repaired;
}

const invokedPath = process.argv[1]?.trim();
if (invokedPath && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
	const nodePtyRoot =
		process.argv[2] ?? join(process.cwd(), 'node_modules', 'node-pty');
	const repaired = await ensureNodePtyHelperMode(nodePtyRoot);
	if (repaired === 0) {
		throw new Error(
			`No node-pty spawn helper found under ${resolve(nodePtyRoot)}`,
		);
	}
}
