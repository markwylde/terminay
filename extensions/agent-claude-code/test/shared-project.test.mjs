import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension from '../dist/index.js';

/**
 * Two terminals, each running its own `claude` in the same directory. This is
 * the ordinary case on a developer's machine: several sessions open against
 * one repository. Claude Code encodes the project directory from the cwd, so
 * both CLIs journal into the same `.claude/projects/<encoded>` directory and
 * each terminal lists the other terminal's journal alongside its own.
 *
 * Every terminal must bind the journal its own process is writing.
 */
const projects = '/home/test/.claude/projects/-workspace';
const older = '5f2aff08-eab3-4852-96eb-48235fc7f471';
const newer = 'bf0b34e1-4afc-4b93-8389-80caa0b589a4';

const header = (id) => ({
	type: 'mode',
	mode: 'normal',
	sessionId: id,
	version: '2.1.263',
});

/** Both journals exist for both terminals; only the process differs. */
const files = {
	[`${projects}/${older}.jsonl`]: [header(older)],
	[`${projects}/${newer}.jsonl`]: [header(newer)],
};
const fileCreatedAt = {
	[`${projects}/${older}.jsonl`]: '2026-09-06T20:54:37.000Z',
	[`${projects}/${newer}.jsonl`]: '2026-09-06T21:15:36.000Z',
};
/** The newer session replied most recently; the older one is mid-turn. */
const fileModifiedAt = {
	[`${projects}/${older}.jsonl`]: '2026-09-06T21:18:07.000Z',
	[`${projects}/${newer}.jsonl`]: '2026-09-06T21:18:11.000Z',
};

function terminalStartedAt(startedAt) {
	return fixtureTerminal({
		foregroundExecutable: 'claude',
		cwd: '/workspace',
		startedAt,
		openFilePaths: [],
		files,
		fileCreatedAt,
		fileModifiedAt,
	});
}

async function boundSessionOf(terminal) {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(terminal);
		return harness.observation()?.binding.providerSessionId;
	} finally {
		await harness.dispose();
	}
}

test('each terminal binds its own journal when two sessions share one project directory', async () => {
	assert.equal(
		await boundSessionOf(terminalStartedAt('2026-09-06T21:15:36.000Z')),
		newer,
		'the terminal started second must bind the journal it writes',
	);
	assert.equal(
		await boundSessionOf(terminalStartedAt('2026-09-06T20:54:37.000Z')),
		older,
		'the terminal started first must bind its own journal, not the other terminal’s',
	);
});
