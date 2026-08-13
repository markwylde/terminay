import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/u.test(tag ?? '')) {
	throw new Error('A valid release tag is required');
}

const execFileAsync = promisify(execFile);
const git = async (args) =>
	(
		await execFileAsync('git', args, {
			cwd: process.cwd(),
			maxBuffer: 10 * 1024 * 1024,
		})
	).stdout.trim();

const tags = (await git(['tag', '--list', 'v*', '--sort=-version:refname']))
	.split('\n')
	.map((value) => value.trim())
	.filter(Boolean);
const index = tags.indexOf(tag);
if (index < 0) throw new Error(`Release tag ${tag} does not exist locally`);
const previous = tags[index + 1] ?? null;
const range = previous === null ? tag : `${previous}..${tag}`;
const subjects = (await git(['log', '--reverse', '--format=%s', range]))
	.split('\n')
	.map((value) => value.trim())
	.filter(Boolean)
	.slice(0, 40);

const bullets =
	subjects.length === 0
		? ['- Published the verified Terminay release artifacts.']
		: subjects.map((subject) => `- ${subject.replace(/^[-*]\s*/u, '')}`);
const notes = [
	`Terminay ${tag.slice(1)} packages the verified changes since ${previous ?? 'the initial release'}.`,
	'',
	'## Changes',
	'',
	'### Included work',
	...bullets,
	'',
	'## Downloads',
	'',
	'### Verified artifacts',
	'- Published signed/checksummed Desktop and standalone server artifacts with this release.',
	'',
].join('\n');

await writeFile(resolve(process.cwd(), 'RELEASE.md'), notes, { mode: 0o600 });
