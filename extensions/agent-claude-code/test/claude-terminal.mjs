import { fixtureTerminal } from '@terminay/extension-api/testing';

/**
 * The shape production actually supplies to this provider, in one place.
 *
 * A real `claude` writes `~/.claude/sessions/<pid>.json` for itself the moment
 * it starts, keyed by its own OS pid, and rewrites it whenever the process
 * changes conversation. Its project directory is shared by every terminal open
 * on the same working directory, so it normally holds other sessions' journals
 * too — including ones created long before this process and appended to more
 * recently than its own.
 */
export const HOME = '/home/test';
export const CWD = '/workspace';
export const PROJECTS = `${HOME}/.claude/projects/-workspace`;
export const SESSIONS = `${HOME}/.claude/sessions`;

/** A pid the fixture's foreground process reports as its own. */
export const PID = 4242;

export const journalPath = (sessionId, projects = PROJECTS) =>
	`${projects}/${sessionId}.jsonl`;
export const sessionFilePath = (pid) => `${SESSIONS}/${pid}.json`;
/** The sibling peer-token file the CLI writes and this provider must not read. */
export const keyFilePath = (pid) => `${SESSIONS}/${pid}.9f2c1d.key`;

export const header = (sessionId) => ({
	type: 'mode',
	mode: 'normal',
	sessionId,
	version: '2.1.263',
});

export const titled = (sessionId, title) => [
	header(sessionId),
	{ type: 'ai-title', sessionId, aiTitle: title },
];

/**
 * The five fields the provider reads plus the ones it must not, so a fixture
 * never passes by omitting the fields the rule forbids.
 */
export function sessionFile({
	pid = PID,
	sessionId,
	cwd = CWD,
	startedAt,
	version = '2.1.263',
}) {
	return {
		pid,
		sessionId,
		cwd,
		startedAt,
		procStart: new Date(startedAt).toUTCString(),
		version,
		peerProtocol: 1,
		kind: 'interactive',
		entrypoint: 'cli',
		pidDomain: 'linux',
		messagingSocketPath: `/tmp/claude-${pid}.sock`,
		name: 'workspace-1',
		nameSource: 'derived',
		updatedAt: startedAt + 90_000,
		status: 'busy',
		statusUpdatedAt: startedAt + 90_000,
	};
}

/**
 * A terminal running one `claude`, with the session file that process wrote for
 * itself and a project directory holding whatever journals the fixture names.
 *
 * `journals` maps a session id to its records. `older` names the journals
 * created before this process started — the resumable history every real
 * directory carries — and `appendedLast` names the journal another terminal
 * touched most recently, so a rule that ordered by time would pick it.
 */
export function claudeTerminal({
	pid = PID,
	sessionId,
	cwd = CWD,
	fileCwd = cwd,
	processStartedAt = '2026-09-06T11:00:00.000Z',
	fileStartedAt = Date.parse(processStartedAt),
	journals = {},
	older = [],
	appendedLast,
	sessionFileRecord,
	omitSessionFile = false,
	keyFile = true,
	extraFiles = {},
	extraDescendants = [],
	fileRewrites,
	onFileRead,
	...rest
} = {}) {
	const start = Date.parse(processStartedAt);
	const files = { ...extraFiles };
	const fileCreatedAt = {};
	const fileModifiedAt = {};
	for (const [id, records] of Object.entries(journals)) {
		const path = journalPath(id);
		files[path] = records;
		const isOlder = older.includes(id);
		fileCreatedAt[path] = new Date(
			isOlder ? start - 86_400_000 : start + 4_000,
		).toISOString();
		fileModifiedAt[path] = new Date(
			appendedLast === id ? start + 600_000 : start + 30_000,
		).toISOString();
	}
	if (!omitSessionFile)
		files[sessionFilePath(pid)] = [
			sessionFileRecord ??
				sessionFile({
					pid,
					sessionId,
					cwd: fileCwd,
					startedAt: fileStartedAt,
				}),
		];
	if (keyFile) files[keyFilePath(pid)] = ['peer-token-never-read'];
	return fixtureTerminal({
		foregroundExecutable: 'claude',
		cwd,
		pid,
		startedAt: processStartedAt,
		openFilePaths: [],
		files,
		fileCreatedAt,
		fileModifiedAt,
		descendants: extraDescendants,
		...(fileRewrites ? { fileRewrites } : {}),
		...(onFileRead ? { onFileRead } : {}),
		...rest,
	});
}
