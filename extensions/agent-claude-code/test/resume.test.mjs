import assert from 'node:assert/strict';
import test from 'node:test';
import {
	claudeProjectDirectoryPath,
	claudeProjectJournalPath,
	claudeResumeSessionId,
} from '../dist/index.js';

const sessionId = '5f2aff08-eab3-4852-96eb-48235fc7f471';

test('Claude Code only accepts explicit valid native --resume identities', () => {
	assert.equal(claudeResumeSessionId(['--resume', sessionId]), sessionId);
	assert.equal(claudeResumeSessionId([`--resume=${sessionId}`]), sessionId);
	assert.equal(claudeResumeSessionId(['-r', sessionId]), sessionId);
	assert.equal(claudeResumeSessionId(['--resume', 'not-a-session']), undefined);
	assert.equal(claudeResumeSessionId(undefined), undefined);
});

test('Claude Code derives only the provider-owned project journal path', () => {
	assert.equal(
		claudeProjectJournalPath('/work/acme.github.io', sessionId),
		`.claude/projects/-work-acme-github-io/${sessionId}.jsonl`,
	);
	assert.equal(
		claudeProjectJournalPath('relative/project', sessionId),
		undefined,
	);
	assert.equal(
		claudeProjectJournalPath('/work/acme', 'not-a-session'),
		undefined,
	);
});

test('the project directory encoding replaces every non-alphanumeric character', () => {
	// Taken from a real run: a macOS temporary directory with underscores.
	assert.equal(
		claudeProjectDirectoryPath(
			'/private/var/folders/gw/n_lr8lp97k93jpcv2qg_1mpw0000gn/T/terminay-conformance-KYT549',
		),
		'.claude/projects/-private-var-folders-gw-n-lr8lp97k93jpcv2qg-1mpw0000gn-T-terminay-conformance-KYT549',
	);
	assert.equal(
		claudeProjectDirectoryPath('/Users/mark/Documents/Projects/terminay/terminay'),
		'.claude/projects/-Users-mark-Documents-Projects-terminay-terminay',
	);
});
