import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('electron/serverTerminalAuthority.ts', 'utf8');

test('embedded Desktop composes and binds the server-owned Git authority', () => {
	assert.match(source, /this\.git = new GitService\(\)/u);
	assert.match(source, /new ServerGitAdapter\(\{[\s\S]*git: this\.git/u);
	assert.match(source, /git: gitAdapter/u);
	assert.match(source, /capabilities: \[[^\]]*'git'/u);
	assert.match(source, /await this\.git\.bindProject\(projectId, canonicalRoot\)/u);
});
