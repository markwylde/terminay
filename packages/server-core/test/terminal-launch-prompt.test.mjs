import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  OrderedEventJournal,
  TerminalLauncherRegistry,
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
  launcherCommandLine,
  normaliseLauncherPrompt,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);
const CLAUDE = "com.terminay.builtin-agents/launch-claude-code";
const CODEX = "com.terminay.builtin-agents/launch-codex";
const OTHER = "com.terminay.builtin-agents/launch-other";
const HOSTILE = "it's $(rm -rf ~) `id` \"q\" ; & | %PATH% ünïcødé 🚀";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const writes = [];
      const process = {
        pid: 7300 + processes.length,
        options,
        writes,
        write(data) {
          writes.push(typeof data === "string" ? data : new TextDecoder().decode(data));
        },
        resize() {},
        kill() {},
        onData: () => () => {},
        onExit: () => () => {},
      };
      processes.push(process);
      return process;
    },
  };
}

const pathAuthority = { canonicalDirectory: async (value) => (value === "/project" || value === "/home" ? value : null), homeDirectory: async () => "/home", isRoot: (value) => value === "/" };

function fixture(shell = "/bin/zsh") {
  const system = { id: "system", name: "System default", target: { kind: "executable", executable: shell }, args: [], startupMode: "default", environment: {}, kind: "system", readOnly: true, source: "system", availability: { available: true } };
  const profiles = {
    catalogue: async () => ({ settingsRevision: 1, defaultProfileId: "system", cwdPolicy: "current", entries: [system], projectReferences: {} }),
    resolveProfile: async (_id, catalogue) => ({ profile: system, definition: system, settingsRevision: catalogue.settingsRevision, target: system.target }),
  };
  const source = {
    terminalLauncherContributions: () => [
      { extensionId: "com.terminay.builtin-agents", contribution: { id: CLAUDE, displayName: "Claude Code", icon: "agent-claude-code", initialPrompt: "positional" } },
      { extensionId: "com.terminay.builtin-agents", contribution: { id: CODEX, displayName: "Codex", icon: "agent-codex", initialPrompt: "positional" } },
      { extensionId: "com.terminay.builtin-agents", contribution: { id: OTHER, displayName: "Other", icon: "agent-other" } },
    ],
    async resolveTerminalLauncher(id) {
      return { available: true, executable: id === CODEX ? "/opt/codex" : id === OTHER ? "/opt/other" : "/opt/claude" };
    },
    onContributionsChanged: () => () => {},
  };
  const launchers = new TerminalLauncherRegistry({ platform: "darwin", maxResolutionAgeMs: 0 });
  launchers.attach(source);
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const pty = createPtyFactory();
  const composition = createServerCoreComposition({
    serverId: "server-a",
    serverVersion: "1.0.0",
    capabilities: [],
    ptyFactory: pty,
    workspace,
    eventJournal: new OrderedEventJournal(),
    terminalProfiles: profiles,
    terminalLaunchPathAuthority: pathAuthority,
    terminalLaunchers: launchers,
  });
  composition.workspaceOperations.applyHostCommand("h0", { type: "project.create", projectId: "project-a", viewId: workspace.state.viewOrder[0], root: "/project", name: "A" });
  let serial = 0;
  const context = { authScope: "write", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal };
  const create = (payload) =>
    composition.operations.commands.get("terminal.create")({
      body: new Uint8Array(),
      context,
      envelope: { commandId: `create-${++serial}`, operation: "terminal.create", payload: { projectId: "project-a", cols: 80, rows: 24, ...payload } },
    });
  const list = () =>
    composition.operations.queries.get("terminal.launchers")({
      body: new Uint8Array(),
      context: { ...context, authScope: "read" },
      envelope: { queryId: "q", operation: "terminal.launchers", payload: {} },
    });
  return { composition, workspace, pty, create, list };
}

test("the launcher list says which launchers take a prompt", async () => {
  const { composition, list } = fixture();
  try {
    const { launchers } = await list();
    assert.deepEqual(
      launchers.filter((launcher) => launcher.initialPrompt === "positional").map((launcher) => launcher.displayName).sort(),
      ["Claude Code", "Codex"],
    );
  } finally {
    await composition.shutdown?.();
  }
});

test("a prompt goes to the launcher as one quoted argument and is not stored", async () => {
  const { composition, pty, create, workspace } = fixture();
  try {
    await create({ launcherId: CODEX, prompt: "Fix issue #541\nthen test" });
    assert.deepEqual(pty.processes.at(-1).writes, ["'/opt/codex' 'Fix issue #541 then test'\r"]);
    assert.equal(JSON.stringify(workspace.state).includes("Fix issue"), false);
  } finally {
    await composition.shutdown?.();
  }
});

test("prompts are refused without a launcher, for a launcher that takes none, and when malformed", async () => {
  const { composition, pty, create } = fixture();
  try {
    await assert.rejects(create({ prompt: "hi" }), /needs a launcher/);
    await assert.rejects(create({ launcherId: OTHER, prompt: "hi" }), /does not take a prompt/);
    await assert.rejects(create({ launcherId: CLAUDE, prompt: "   " }), /empty/);
    await assert.rejects(create({ launcherId: CLAUDE, prompt: "  --dangerously" }), /cannot start with/);
    await assert.rejects(create({ launcherId: CLAUDE, prompt: "bell\u0007" }), /control/);
    await assert.rejects(create({ launcherId: CLAUDE, prompt: "x".repeat(4001) }), /longer/);
    assert.equal(pty.processes.length, 0);
  } finally {
    await composition.shutdown?.();
  }
});

test("a prompt in cmd or an unrecognised shell is refused before a terminal starts", async () => {
  for (const shell of ["C:\\Windows\\System32\\cmd.exe", "/usr/bin/xonsh"]) {
    const { composition, pty, create } = fixture(shell);
    try {
      await assert.rejects(create({ launcherId: CLAUDE, prompt: "hello" }), /cmd|not supported/);
      assert.equal(pty.processes.length, 0, shell);
    } finally {
      await composition.shutdown?.();
    }
  }
});

test("prompt normalisation folds newlines and keeps everything else", () => {
  assert.deepEqual(normaliseLauncherPrompt("a\r\nb\nc"), { prompt: "a b c" });
  assert.deepEqual(normaliseLauncherPrompt(HOSTILE), { prompt: HOSTILE });
  assert.ok("problem" in normaliseLauncherPrompt("-x"));
});

test("quoting per shell keeps the prompt one literal argument", () => {
  assert.equal(launcherCommandLine("/opt/codex", "/bin/zsh", ["--no-daemon"], "Fix #541"), "'/opt/codex' '--no-daemon' 'Fix #541'\r", "Codex: flags, then the prompt");
  assert.equal(launcherCommandLine("/opt/claude", "/bin/bash", [], "it's"), "'/opt/claude' 'it'\\''s'\r");
  assert.equal(launcherCommandLine("/opt/claude", "/usr/bin/fish", [], "a\\b'c"), "'/opt/claude' 'a\\\\b\\'c'\r");
  assert.equal(launcherCommandLine("C:\\claude.exe", "pwsh.exe", [], "it's \u2019q"), "& 'C:\\claude.exe' 'it''s \u2019\u2019q'\r");
  assert.equal(launcherCommandLine("C:\\claude.exe", "cmd.exe", [], "hi"), '"C:\\claude.exe"\r', "cmd never carries a prompt");
});

test("a real shell hands the program exactly the prompt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "terminay-prompt-argv-"));
  try {
    const program = join(root, "print-args");
    await writeFile(program, "#!/bin/sh\nfor a in \"$@\"; do printf '[%s]\\n' \"$a\"; done\n");
    await chmod(program, 0o755);
    const shells = ["/bin/sh", "/bin/bash", "/bin/zsh", "/usr/bin/fish", "/opt/homebrew/bin/fish", "/usr/local/bin/fish"];
    let ran = 0;
    for (const shell of shells) {
      try {
        await execFileAsync(shell, ["-c", "true"]);
      } catch {
        continue;
      }
      const line = launcherCommandLine(program, shell, ["--no-daemon"], HOSTILE).replace(/\r$/u, "");
      const { stdout } = await execFileAsync(shell, ["-c", line], { cwd: root });
      assert.equal(stdout, `[--no-daemon]\n[${HOSTILE}]\n`, shell);
      ran += 1;
    }
    if (ran === 0) t.skip("no shell available");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
