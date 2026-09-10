import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
	test as base,
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
} from '@playwright/test';
import { stageImmutableRendererArtifact } from '../scripts/immutable-renderer-artifact.mjs';
import {
	openChildWindow,
	openMacroLauncher,
	openMacrosWindow,
	openRecordingsWindow,
	openRemoteControlWindow,
	openSettingsWindow,
	prepareWindow,
	sendAppCommand,
} from './support/app';
import {
	createDialogController,
	type DialogController,
} from './support/dialogs';
import {
	createFixtureWorkspace,
	type FixtureWorkspace,
	type WorkspaceOptions,
} from './support/workspace';

type ElectronFixtures = {
	appHarness: {
		dialogs: (page?: Page) => Promise<DialogController>;
		openChildWindow: (action: () => Promise<void>) => Promise<Page>;
		openMacroLauncher: (
			page?: Page,
			options?: { attempts?: number },
		) => Promise<void>;
		openMacrosWindow: (page?: Page) => Promise<Page>;
		openRecordingsWindow: (page?: Page) => Promise<Page>;
		openRemoteControlWindow: (page?: Page) => Promise<Page>;
		openSettingsWindow: (options?: {
			page?: Page;
			sectionId?: string;
		}) => Promise<Page>;
		prepareWindow: (page: Page) => Promise<Page>;
		sendAppCommand: (
			command: import('../src/types/terminay').AppCommand,
			page?: Page,
		) => Promise<void>;
	};
	createWorkspace: (options?: WorkspaceOptions) => Promise<FixtureWorkspace>;
	electronApp: ElectronApplication;
	mainWindow: Page;
	tempDir: string;
	userDataDir: string;
};

const desktopAppReadyTimeoutMs = 15_000;
const execFileAsync = promisify(execFile);

const nativeCodexFixture = String.raw`
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

static void directories(char *path) {
  for (char *cursor = path + 1; *cursor; cursor += 1) {
    if (*cursor == '/') { *cursor = '\0'; mkdir(path, 0700); *cursor = '/'; }
  }
  mkdir(path, 0700);
}

int main(void) {
  const char *home = getenv("CODEX_HOME");
  if (!home) return 64;
  char directory[PATH_MAX];
  char journal[PATH_MAX];
  snprintf(directory, sizeof(directory), "%s/sessions/2026/08/24", home);
  directories(directory);
  snprintf(journal, sizeof(journal), "%s/rollout-e2e-root.jsonl", directory);
  FILE *stream = fopen(journal, "w");
  if (!stream) return 65;
  fputs("{\"type\":\"session_meta\",\"payload\":{\"id\":\"e2e-native-root\",\"originator\":\"codex-tui\",\"source\":\"cli\",\"model\":\"gpt-e2e-codex\"}}\n", stream);
  fputs("{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Native Codex root prompt\",\"turn_id\":\"native-turn\"}}\n", stream);
  fflush(stream);
  for (;;) sleep(1);
}
`;

async function prepareNativeCodexFixture(
	tempDir: string,
): Promise<{ readonly codexHome: string; readonly bin: string }> {
	const codexHome = path.join(tempDir, 'native-codex-home');
	const bin = path.join(tempDir, 'native-codex-bin');
	const source = path.join(tempDir, 'native-codex.c');
	const executable = path.join(bin, 'codex');
	await Promise.all([
		mkdir(codexHome, { recursive: true }),
		mkdir(bin, { recursive: true }),
	]);
	// Codex maintains this index before a session starts. Creating the empty
	// file here means the real extension binds a watcher and can observe the
	// later atomic/append title update below without a provider restart.
	await writeFile(path.join(codexHome, 'session_index.jsonl'), '', {
		mode: 0o600,
	});
	await writeFile(source, nativeCodexFixture, { mode: 0o600 });
	await execFileAsync('cc', [source, '-O2', '-o', executable]);
	return { codexHome, bin };
}

/**
 * Claude Code's per-process record and journal identities used by the stub
 * CLI and by `claude-code-multi-terminal.spec.ts`. Three distinct sessions
 * exist in one project directory: one quit before the run begins, one minted
 * by a fresh process, and one minted in-process by `/clear`.
 */
export const nativeClaudeEarlierSessionId =
	'cccccccc-dddd-4eee-8fff-000000000001';
export const nativeClaudeFreshSessionId =
	'cccccccc-dddd-4eee-8fff-000000000002';
export const nativeClaudeClearedSessionId =
	'cccccccc-dddd-4eee-8fff-000000000003';
/** The CLI version the stub records, matching the real host observation. */
export const nativeClaudeVersion = '2.1.263';

/** Home the stub CLI and the app's terminals share, isolated per test run. */
export function nativeClaudeHome(tempDir: string): string {
	return path.join(tempDir, 'native-claude-home');
}

/** Working directory the spec drives both terminals in. */
export function nativeClaudeProject(tempDir: string): string {
	return path.join(tempDir, 'native-claude-project');
}

/**
 * A stub `claude` that writes what the real CLI writes: the pid-keyed session
 * record under `~/.claude/sessions`, then the journal that record names under
 * the encoded project directory. It is a real compiled process so its pid,
 * cwd, start time and executable name are the operating system's, not a
 * fixture's claim about them — a provider that ignores the record and guesses
 * a journal from file times cannot pass against it.
 *
 * Behaviour driven by the spec: `--resume <id>` binds an existing session,
 * `CLAUDE_E2E_SESSION` names a fresh one, a typed line runs one turn, `/clear`
 * mints a new session and rewrites both the record and the journal, and
 * quitting removes the record the way the CLI does on exit.
 */
const nativeClaudeFixture = String.raw`
#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

static const char VERSION[] = "${nativeClaudeVersion}";
static const char DEFAULT_SESSION_ID[] = "${nativeClaudeFreshSessionId}";
static const char DEFAULT_CLEAR_SESSION_ID[] = "${nativeClaudeClearedSessionId}";
#ifdef __APPLE__
static const char PID_DOMAIN[] = "darwin";
#else
static const char PID_DOMAIN[] = "linux";
#endif

/** The record the provider joins to this process's pid. */
static char session_file[PATH_MAX];

static void directories(char *path) {
  for (char *cursor = path + 1; *cursor; cursor += 1) {
    if (*cursor == '/') { *cursor = '\0'; mkdir(path, 0700); *cursor = '/'; }
  }
  mkdir(path, 0700);
}

static long long now_ms(void) {
  struct timeval clock_value;
  gettimeofday(&clock_value, NULL);
  return (long long)clock_value.tv_sec * 1000 + clock_value.tv_usec / 1000;
}

/**
 * Claude's project-directory encoding: every character outside [A-Za-z0-9]
 * becomes '-'. Kept identical to the provider's own encoder so the stub and
 * the extension name the same directory.
 */
static void encode_cwd(const char *cwd, char *out, size_t size) {
  size_t index = 0;
  for (; cwd[index] && index + 1 < size; index += 1) {
    char value = cwd[index];
    int plain = (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z')
      || (value >= '0' && value <= '9');
    out[index] = plain ? value : '-';
  }
  out[index] = '\0';
}

static void write_session_file(const char *session_id, const char *cwd,
    long long started_at, const char *name) {
  FILE *stream = fopen(session_file, "w");
  if (!stream) return;
  time_t seconds = (time_t)(started_at / 1000);
  struct tm parts;
  char proc_start[64];
  gmtime_r(&seconds, &parts);
  strftime(proc_start, sizeof(proc_start), "%a %b %e %H:%M:%S %Y", &parts);
  long long updated_at = now_ms();
  fprintf(stream,
    "{\"pid\":%d,\"sessionId\":\"%s\",\"cwd\":\"%s\",\"startedAt\":%lld,"
    "\"procStart\":\"%s\",\"version\":\"%s\",\"kind\":\"interactive\","
    "\"entrypoint\":\"cli\",\"pidDomain\":\"%s\",\"name\":\"%s\","
    "\"nameSource\":\"derived\",\"nameSince\":%lld,\"updatedAt\":%lld,"
    "\"status\":\"idle\",\"statusUpdatedAt\":%lld}\n",
    (int)getpid(), session_id, cwd, started_at, proc_start, VERSION, PID_DOMAIN, name,
    started_at, updated_at, updated_at);
  fclose(stream);
}

/** The CLI removes its record on exit; a signal must not leave a stale one. */
static void remove_session_file(void) { unlink(session_file); }

static void handle_signal(int signal_number) {
  (void)signal_number;
  remove_session_file();
  _exit(0);
}

static FILE *open_journal(const char *home, const char *encoded,
    const char *session_id, int append, char *journal_path) {
  char directory[PATH_MAX];
  snprintf(directory, sizeof(directory), "%s/.claude/projects/%s", home, encoded);
  directories(directory);
  snprintf(journal_path, PATH_MAX, "%s/%s.jsonl", directory, session_id);
  FILE *stream = fopen(journal_path, append ? "a" : "w");
  if (stream) setvbuf(stream, NULL, _IONBF, 0);
  return stream;
}

/**
 * The turn header block. The real CLI rewrites it at session start, after a
 * prompt and after each turn completes, and every record carries the session
 * id the journal is named for.
 */
static void write_header(FILE *journal, const char *session_id, const char *cwd) {
  fprintf(journal,
    "{\"type\":\"mode\",\"mode\":\"default\",\"sessionId\":\"%s\","
    "\"version\":\"%s\",\"cwd\":\"%s\"}\n", session_id, VERSION, cwd);
  fprintf(journal,
    "{\"type\":\"permission-mode\",\"permissionMode\":\"default\","
    "\"sessionId\":\"%s\"}\n", session_id);
}

static void write_label(FILE *journal, const char *session_id, const char *label) {
  fprintf(journal, "{\"type\":\"last-prompt\",\"lastPrompt\":\"%s\","
    "\"sessionId\":\"%s\"}\n", label, session_id);
}

/**
 * --resume takes either a session id or nothing at all. With no id the real
 * CLI opens a picker and the user chooses a session in it, which is the form
 * the reported defect was seen under: ps shows only "claude --resume", and the
 * process then appends to a journal created before it. The picker choice is
 * supplied here by CLAUDE_E2E_SESSION. The picker flag reports that form so
 * the caller resumes rather than creating a session.
 */
static const char *resume_argument(int argc, char **argv, int *picker) {
  *picker = 0;
  for (int index = 1; index < argc; index += 1) {
    if (strncmp(argv[index], "--resume=", 9) == 0) return argv[index] + 9;
    if (strcmp(argv[index], "--resume") != 0 && strcmp(argv[index], "-r") != 0)
      continue;
    const char *next = index + 1 < argc ? argv[index + 1] : NULL;
    if (next && next[0] != '-') return next;
    *picker = 1;
    return NULL;
  }
  return NULL;
}

/**
 * How long a turn takes. The real CLI's turns are as long as the model takes;
 * a test that needs one terminal to still be working while another binds sets
 * CLAUDE_E2E_TURN_MS.
 */
static void sleep_one_turn(FILE *journal, const char *session_id, int turn) {
  const char *configured = getenv("CLAUDE_E2E_TURN_MS");
  long milliseconds = configured && *configured ? strtol(configured, NULL, 10) : 2000;
  if (milliseconds <= 0) milliseconds = 2000;
  int step = 0;
  for (long elapsed = 0; elapsed < milliseconds; elapsed += 500) {
    long slice = milliseconds - elapsed < 500 ? milliseconds - elapsed : 500;
    struct timespec span;
    span.tv_sec = slice / 1000;
    span.tv_nsec = (slice % 1000) * 1000000L;
    while (nanosleep(&span, &span) == -1 && errno == EINTR) continue;
    step += 1;
    /*
     * The real CLI writes assistant records throughout a turn, so a working
     * session's journal keeps advancing its modification time; a stub that
     * goes silent for the whole turn does not, and a file-time rule that would
     * pick the wrong journal in production never gets the chance to. Carries
     * no stop_reason, so the turn stays open, and no model, so nothing about
     * the entry's label or metadata moves.
     */
    fprintf(journal,
      "{\"type\":\"assistant\",\"sessionId\":\"%s\","
      "\"uuid\":\"e2e-turn-%d-step-%d\","
      "\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
      session_id, turn, step);
  }
}

static const char *value_of(const char *name, const char *fallback) {
  const char *value = getenv(name);
  return value && *value ? value : fallback;
}

int main(int argc, char **argv) {
  const char *home = getenv("HOME");
  if (!home || !*home) return 64;
  char cwd[PATH_MAX];
  if (!getcwd(cwd, sizeof(cwd))) return 66;
  char encoded[PATH_MAX];
  encode_cwd(cwd, encoded, sizeof(encoded));
  const long long started_at = now_ms();
  int picker = 0;
  const char *chosen = resume_argument(argc, argv, &picker);
  const int resumed = chosen != NULL || picker;
  char session_id[128];
  snprintf(session_id, sizeof(session_id), "%s",
    chosen ? chosen : value_of("CLAUDE_E2E_SESSION", DEFAULT_SESSION_ID));
  const char *label = value_of("CLAUDE_E2E_LABEL", "Claude e2e session");

  char sessions[PATH_MAX];
  snprintf(sessions, sizeof(sessions), "%s/.claude/sessions", home);
  directories(sessions);
  snprintf(session_file, sizeof(session_file), "%s/%d.json", sessions, (int)getpid());
  write_session_file(session_id, cwd, started_at, label);
  atexit(remove_session_file);
  signal(SIGTERM, handle_signal);
  signal(SIGINT, handle_signal);
  signal(SIGHUP, handle_signal);

  char journal_path[PATH_MAX];
  FILE *journal = open_journal(home, encoded, session_id, resumed, journal_path);
  if (!journal) return 65;
  setvbuf(stdout, NULL, _IONBF, 0);
  write_header(journal, session_id, cwd);
  if (resumed) {
    fputs("Claude e2e resumed\n", stdout);
  } else {
    write_label(journal, session_id, label);
    fputs("Claude e2e ready\n", stdout);
  }

  char line[512];
  int turn = 0;
  while (fgets(line, sizeof(line), stdin)) {
    size_t length = strlen(line);
    while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
      line[--length] = '\0';
    }
    if (length == 0) continue;
    if (strcmp(line, "quit") == 0 || strcmp(line, "/quit") == 0
        || strcmp(line, "/exit") == 0) {
      return 0;
    }
    if (strcmp(line, "/clear") == 0) {
      snprintf(session_id, sizeof(session_id), "%s",
        value_of("CLAUDE_E2E_CLEAR_SESSION", DEFAULT_CLEAR_SESSION_ID));
      label = value_of("CLAUDE_E2E_CLEAR_LABEL", "Cleared Claude e2e session");
      fclose(journal);
      journal = open_journal(home, encoded, session_id, 0, journal_path);
      if (!journal) return 65;
      write_header(journal, session_id, cwd);
      write_label(journal, session_id, label);
      // The record is rewritten in place: same pid, same start time, new
      // session. This is the only evidence that the terminal's session moved.
      write_session_file(session_id, cwd, started_at, label);
      fputs("Claude e2e cleared\n", stdout);
      continue;
    }
    turn += 1;
    fprintf(journal, "{\"type\":\"ai-title\",\"aiTitle\":\"%s\",\"sessionId\":\"%s\"}\n",
      label, session_id);
    fprintf(journal,
      "{\"type\":\"user\",\"sessionId\":\"%s\",\"promptId\":\"e2e-turn-%d\","
      "\"message\":{\"role\":\"user\",\"content\":\"%s\"}}\n",
      session_id, turn, line);
    sleep_one_turn(journal, session_id, turn);
    fprintf(journal,
      "{\"type\":\"system\",\"subtype\":\"turn_duration\",\"sessionId\":\"%s\","
      "\"durationMs\":2000}\n", session_id);
    write_header(journal, session_id, cwd);
    fputs("Claude e2e turn done\n", stdout);
  }
  return 0;
}
`;

async function prepareNativeClaudeFixture(
	tempDir: string,
): Promise<{ readonly claudeHome: string; readonly bin: string }> {
	const claudeHome = nativeClaudeHome(tempDir);
	const bin = path.join(tempDir, 'native-claude-bin');
	const source = path.join(tempDir, 'native-claude.c');
	const executable = path.join(bin, 'claude');
	await Promise.all([
		mkdir(path.join(claudeHome, '.claude', 'projects'), { recursive: true }),
		mkdir(path.join(claudeHome, '.claude', 'sessions'), { recursive: true }),
		mkdir(nativeClaudeProject(tempDir), { recursive: true }),
		mkdir(bin, { recursive: true }),
	]);
	await writeFile(source, nativeClaudeFixture, { mode: 0o600 });
	await execFileAsync('cc', [source, '-O2', '-o', executable]);
	return { claudeHome, bin };
}

export const nativeGrokSessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';

const nativeGrokFixture = String.raw`
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char SESSION_ID[] = "${nativeGrokSessionId}";

static void directories(char *path) {
  for (char *cursor = path + 1; *cursor; cursor += 1) {
    if (*cursor == '/') { *cursor = '\0'; mkdir(path, 0700); *cursor = '/'; }
  }
  mkdir(path, 0700);
}

static void write_summary(const char *path, const char *id, const char *title) {
  FILE *stream = fopen(path, "w");
  if (!stream) return;
  fprintf(stream,
    "{\"info\":{\"id\":\"%s\"},\"generated_title\":\"%s\",\"session_summary\":\"%s\",\"current_model_id\":\"grok-4.6\"}\n",
    id, title, title);
  fflush(stream);
  fclose(stream);
}

static int resuming(int argc, char **argv) {
  for (int index = 1; index < argc; index += 1) {
    if (strcmp(argv[index], "--resume") == 0 || strcmp(argv[index], "-r") == 0
      || strcmp(argv[index], "-c") == 0 || strcmp(argv[index], "--continue") == 0) {
      return 1;
    }
  }
  return 0;
}

static const char *resume_session_id(int argc, char **argv) {
  for (int index = 1; index < argc; index += 1) {
    if ((strcmp(argv[index], "--resume") == 0 || strcmp(argv[index], "-r") == 0)
      && index + 1 < argc && argv[index + 1][0] != '-') {
      return argv[index + 1];
    }
  }
  return NULL;
}

int main(int argc, char **argv) {
  const char *home = getenv("GROK_HOME");
  if (!home) return 64;
  char session_id[64];
  const char *explicit = resume_session_id(argc, argv);
  const int resume = resuming(argc, argv);
  if (explicit) snprintf(session_id, sizeof(session_id), "%s", explicit);
  else if (resume) snprintf(session_id, sizeof(session_id), "%s", SESSION_ID);
  else snprintf(session_id, sizeof(session_id), "aaaaaaaa-bbbb-4ccc-8ddd-%012x", (unsigned)getpid());
  char directory[PATH_MAX];
  char events_path[PATH_MAX];
  char summary_path[PATH_MAX];
  snprintf(directory, sizeof(directory), "%s/sessions/e2e-workspace/%s", home, session_id);
  directories(directory);
  snprintf(events_path, sizeof(events_path), "%s/events.jsonl", directory);
  snprintf(summary_path, sizeof(summary_path), "%s/summary.json", directory);
  FILE *events = fopen(events_path, resume ? "a" : "w");
  if (!events) return 65;
  setvbuf(events, NULL, _IONBF, 0);
  setvbuf(stdout, NULL, _IONBF, 0);
  if (resume) {
    fputs("{\"ts\":\"2026-08-05T10:00:20.000Z\",\"type\":\"session_end\"}\n", events);
    fputs("{\"ts\":\"2026-08-05T10:00:21.000Z\",\"type\":\"session_start\"}\n", events);
    fputs("{\"ts\":\"2026-08-05T10:00:22.000Z\",\"type\":\"mcp_config_resolved\",\"servers\":[],\"disabled\":[]}\n", events);
    fputs("Grok e2e resumed\n", stdout);
  } else {
    fputs("{\"ts\":\"2026-08-05T10:00:00.000Z\",\"type\":\"mcp_config_resolved\",\"servers\":[],\"disabled\":[]}\n", events);
    write_summary(summary_path, session_id, "");
    fputs("Grok e2e ready\n", stdout);
  }
  char line[512];
  int turn = 0;
  while (fgets(line, sizeof(line), stdin)) {
    size_t length = strlen(line);
    while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
      line[--length] = '\0';
    }
    if (length == 0) continue;
    if (strcmp(line, "quit") == 0 || strcmp(line, "/quit") == 0 || strcmp(line, "/exit") == 0) {
      return 0;
    }
    turn += 1;
    fprintf(events,
      "{\"ts\":\"2026-08-05T10:00:%02d.000Z\",\"type\":\"turn_started\",\"session_id\":\"%s\",\"turn_number\":%d,\"model_id\":\"grok-4.6\",\"session_relationship\":\"primary\"}\n",
      turn, session_id, turn - 1);
    sleep(2);
    fprintf(events, "{\"ts\":\"2026-08-05T10:00:%02d.500Z\",\"type\":\"turn_ended\",\"outcome\":\"completed\"}\n", turn);
    write_summary(summary_path, session_id, "Native Grok chat");
    fputs("Grok e2e turn done\n", stdout);
  }
  return 0;
}
`;

async function prepareNativeGrokFixture(
	tempDir: string,
): Promise<{ readonly grokHome: string; readonly bin: string }> {
	const grokHome = path.join(tempDir, 'native-grok-home');
	const bin = path.join(tempDir, 'native-grok-bin');
	const source = path.join(tempDir, 'native-grok.c');
	const executable = path.join(bin, 'grok');
	await Promise.all([
		mkdir(grokHome, { recursive: true }),
		mkdir(bin, { recursive: true }),
	]);
	await writeFile(source, nativeGrokFixture, { mode: 0o600 });
	await execFileAsync('cc', [source, '-O2', '-o', executable]);
	return { grokHome, bin };
}

const contentTypes: Record<string, string> = {
	'.css': 'text/css',
	'.html': 'text/html',
	'.ico': 'image/x-icon',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.mjs': 'text/javascript',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
};

async function createStaticServer(
	distRoot: string,
): Promise<{ close: () => Promise<void>; url: string }> {
	const server: Server = createServer(async (request, response) => {
		try {
			const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
			const pathname =
				requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
			const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
			let filePath: string | null = null;

			for (const root of [distRoot]) {
				const candidate = path.resolve(root, relativePath);
				if (!candidate.startsWith(root)) {
					continue;
				}

				const candidateStat = await stat(candidate).catch(() => null);
				if (candidateStat?.isFile()) {
					filePath = candidate;
					break;
				}
			}

			if (!filePath) {
				response.writeHead(404);
				response.end('Not found');
				return;
			}

			response.writeHead(200, {
				'content-type':
					contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
			});
			createReadStream(filePath).pipe(response);
		} catch {
			response.writeHead(500);
			response.end('Internal server error');
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Failed to start E2E static server.');
	}

	return {
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
		url: `http://127.0.0.1:${address.port}/`,
	};
}

async function closeElectronAppGracefully(
	electronApp: ElectronApplication,
): Promise<void> {
	const closeTimeoutMs = 2_500;

	const raceWithTimeout = async <T>(
		promise: Promise<T>,
		timeoutMs: number,
		message: string,
	): Promise<T> => {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	};

	try {
		await electronApp.evaluate(({ dialog }) => {
			dialog.showMessageBox = async () => ({
				checkboxChecked: false,
				response: 0,
			});
		});
	} catch {
		// The app may already have exited during the test.
	}

	try {
		await raceWithTimeout(
			electronApp.close(),
			closeTimeoutMs,
			'Timed out waiting for Electron to close gracefully.',
		);
		return;
	} catch {
		// A broken graceful-shutdown path must not consume the test timeout.
		if (electronApp.process().exitCode === null) {
			electronApp.process().kill('SIGKILL');
		}
	}
}

export const test = base.extend<ElectronFixtures>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture callbacks require an object pattern here.
	userDataDir: async ({}, use) => {
		const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'terminay-e2e-'));

		try {
			await use(userDataDir);
		} finally {
			await rm(userDataDir, { recursive: true, force: true });
		}
	},

	tempDir: async ({ userDataDir }, use) => {
		const tempDir = path.join(userDataDir, 'temp');

		await rm(tempDir, { recursive: true, force: true });
		await mkdir(tempDir, { recursive: true });
		await use(tempDir);
	},

	electronApp: async ({ tempDir, userDataDir }, use, testInfo) => {
		const specFile = path.basename(testInfo.file);
		const nativeCodex =
			specFile === 'extension-agent-runtime.spec.ts'
				? await prepareNativeCodexFixture(tempDir)
				: undefined;
		const nativeGrok = ['extension-grok-agent-runtime.spec.ts'].includes(
			specFile,
		)
			? await prepareNativeGrokFixture(tempDir)
			: undefined;
		// The Claude Code provider resolves `~/.claude` from the terminal's own
		// HOME, so the stub CLI's store is isolated by giving the whole app an
		// isolated HOME rather than by an environment variable of its own.
		const nativeClaude =
			specFile === 'claude-code-multi-terminal.spec.ts'
				? await prepareNativeClaudeFixture(tempDir)
				: undefined;
		const rendererArtifactParent = await mkdtemp(
			path.join(os.tmpdir(), 'terminay-e2e-renderer-'),
		);
		const rendererArtifact = await stageImmutableRendererArtifact({
			sourceRoot: path.resolve('dist'),
			// The app owns both userData and TMP. Keep the immutable application
			// bytes in an independent fixture root until after Electron exits.
			destinationParent: rendererArtifactParent,
		});
		const staticServer = await createStaticServer(
			rendererArtifact.rootDirectory,
		);
		const extraPath = [nativeCodex?.bin, nativeGrok?.bin, nativeClaude?.bin]
			.filter((value): value is string => value !== undefined)
			.join(path.delimiter);
		const electronApp = await electron.launch({
			args: ['.'],
			env: {
				...process.env,
				CI: '1',
				TEMP: tempDir,
				TERMINAY_E2E_TEMP_DIR: tempDir,
				TERMINAY_TEST: '1',
				...(nativeCodex === undefined
					? {}
					: {
							CODEX_HOME: nativeCodex.codexHome,
						}),
				...(nativeGrok === undefined
					? {}
					: {
							GROK_HOME: nativeGrok.grokHome,
						}),
				...(nativeClaude === undefined
					? {}
					: {
							HOME: nativeClaude.claudeHome,
						}),
				...(extraPath.length === 0
					? {}
					: {
							PATH: `${extraPath}${path.delimiter}${process.env.PATH ?? ''}`,
						}),
				...(path.basename(testInfo.file) ===
				'embedded-workspace-persistence-recovery.spec.ts'
					? {
							TERMINAY_TEST_WORKSPACE_PERSISTENCE_FAULT:
								persistenceFaultForTest(testInfo.title),
						}
					: {}),
				...(path.basename(testInfo.file) === 'remote-access.spec.ts'
					? { TERMINAY_TEST_ALLOW_UNAVAILABLE_WEBRTC_UI: '1' }
					: {}),
				// A 16 KiB replay window so a sustained flood outruns it during the
				// sub-second gap a Local transport loss leaves. Inert in production.
				...(path.basename(testInfo.file) ===
				'terminal-recovery-beyond-replay-window.spec.ts'
					? { TERMINAY_TEST_TERMINAL_REPLAY_BYTES: '16384' }
					: {}),
				TERMINAY_USER_DATA_DIR: userDataDir,
				TMP: tempDir,
				TMPDIR: tempDir,
				VITE_DEV_SERVER_URL: staticServer.url,
			},
		});

		try {
			await use(electronApp);
		} finally {
			await closeElectronAppGracefully(electronApp);
			await staticServer.close();
			await rendererArtifact.assertUnchanged();
			await rm(rendererArtifactParent, { recursive: true, force: true });
		}
	},

	mainWindow: async ({ electronApp }, use) => {
		const mainWindow = await prepareWindow(await electronApp.firstWindow());
		await expect(mainWindow.locator('.project-tabbar')).toBeVisible({
			timeout: desktopAppReadyTimeoutMs,
		});
		await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(1, {
			timeout: desktopAppReadyTimeoutMs,
		});
		await use(mainWindow);
	},

	appHarness: async ({ electronApp, mainWindow }, use) => {
		await use({
			dialogs: async (page = mainWindow) => {
				await prepareWindow(page);
				return createDialogController(page);
			},
			openChildWindow: (action) => openChildWindow(electronApp, action),
			openMacroLauncher: (page = mainWindow, options) =>
				openMacroLauncher(page, options),
			openMacrosWindow: (page = mainWindow) =>
				openMacrosWindow(electronApp, page),
			openRecordingsWindow: (page = mainWindow) =>
				openRecordingsWindow(electronApp, page),
			openRemoteControlWindow: (page = mainWindow) =>
				openRemoteControlWindow(electronApp, page),
			openSettingsWindow: (options) =>
				openSettingsWindow(electronApp, options?.page ?? mainWindow, {
					sectionId: options?.sectionId,
				}),
			prepareWindow,
			sendAppCommand: (command, page = mainWindow) =>
				sendAppCommand(page, command),
		});
	},

	createWorkspace: async ({ tempDir }, use) => {
		await use((options?: WorkspaceOptions) =>
			createFixtureWorkspace(tempDir, options),
		);
	},
});

export { expect };

function persistenceFaultForTest(
	title: string,
): 'unreadable' | 'invalid' | 'uncommittable' {
	if (title.includes('unreadable')) return 'unreadable';
	if (title.includes('invalid')) return 'invalid';
	return 'uncommittable';
}
