import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateThrowawayHome } from '../scripts/bot-credentials.mjs';

const exec = promisify(execFile);
test('3.4 credential script refuses real homes before opt-in, key lookup or engine access', async (t) => {
	const root = await mkdtemp(
		path.join(await realpath(tmpdir()), 'terminay-bot-credentials-'),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	assert.equal(await validateThrowawayHome(root, {}), root);
	await assert.rejects(
		validateThrowawayHome(homedir(), {}),
		/Refusing real agent homes/,
	);
	await assert.rejects(
		validateThrowawayHome(root, { CODEX_HOME: homedir() }),
		/CODEX_HOME/,
	);
	await assert.rejects(
		validateThrowawayHome(root, { CLAUDE_CONFIG_DIR: homedir() }),
		/CLAUDE_CONFIG_DIR/,
	);

	const parent = await mkdtemp(
		path.join(await realpath(tmpdir()), 'bot-credential-alias-'),
	);
	t.after(() => rm(parent, { recursive: true, force: true }));
	const alias = path.join(parent, 'terminay-bot-credentials-alias');
	await symlink(homedir(), alias);
	await assert.rejects(
		validateThrowawayHome(alias, {}),
		/Refusing real agent homes/,
	);
	await writeFile(path.join(root, 'auth.json'), 'not-a-credential');
	await assert.rejects(validateThrowawayHome(root, {}), /nonempty/);
	await mkdir(path.join(parent, 'ordinary-home'));
	await assert.rejects(
		validateThrowawayHome(path.join(parent, 'ordinary-home'), {}),
		/Refusing real agent homes/,
	);
	const script = fileURLToPath(
		new URL('../scripts/bot-credentials.mjs', import.meta.url),
	);
	await assert.rejects(
		exec(process.execPath, [script, '--home', homedir()], {
			env: { PATH: '/no-engine', TERMINAY_BOT_CREDENTIALS: '1' },
		}),
		(error) => {
			assert.match(error.stderr, /Refusing real agent homes/);
			assert.doesNotMatch(error.stderr, /OPENROUTER|spawn/);
			return true;
		},
	);
});
