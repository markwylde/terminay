import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { selectForgeReleaseTag } from './forge-release-version.mjs';

if (!process.env.OPENROUTER_API_KEY?.trim())
	throw new Error(
		'OPENROUTER_API_KEY is required before release builds can start',
	);
const execute = promisify(execFile);
const commit = process.env.RELEASE_COMMIT;
const tag = await selectForgeReleaseTag({ commit });
if (tag) {
	// The shared generator needs a local tag; no remote tag/draft is created
	// until the live AI request and the preparation checks have succeeded.
	try {
		const existing = await execute('git', [
			'rev-parse',
			'--verify',
			`refs/tags/${tag}^{commit}`,
		]);
		if (existing.stdout.trim() !== commit)
			throw new Error('Local release tag conflicts with source commit');
	} catch (error) {
		if (error.code !== 128) throw error;
		await execute('git', ['tag', tag, commit]);
	}
	await execute(
		process.execPath,
		[
			fileURLToPath(new URL('./generate-release-notes.mjs', import.meta.url)),
			tag,
		],
		{ env: process.env, maxBuffer: 1024 * 1024 },
	);
	console.log(`Generated AI release notes for ${tag}`);
}
