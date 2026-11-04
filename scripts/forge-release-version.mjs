import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getNextVersion } from './release-utils.mjs';

const execute = promisify(execFile);

export async function selectForgeReleaseTag({ cwd = process.cwd(), commit }) {
	if (!/^[a-f0-9]{40}$/u.test(commit ?? ''))
		throw new Error('Expected a full source commit');
	const git = async (...args) =>
		(
			await execute('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })
		).stdout.trim();
	const latestTag =
		(await git('tag', '--list', 'v*', '--sort=-version:refname'))
			.split('\n')
			.find((value) => /^v\d+\.\d+\.\d+$/u.test(value)) ?? null;
	// A failed attempt may have created the tag already. Let preparation check
	// the matching draft or recognize a release that has already finished.
	if (latestTag && (await git('rev-parse', `${latestTag}^{commit}`)) === commit)
		return latestTag;
	const range = latestTag ? `${latestTag}..${commit}` : commit;
	const messages = (await git('log', range, '--format=%B%x1e'))
		.split('\x1e')
		.map((value) => value.trim())
		.filter(Boolean);
	const version = getNextVersion({ latestTag, messages });
	return version ? `v${version}` : null;
}
