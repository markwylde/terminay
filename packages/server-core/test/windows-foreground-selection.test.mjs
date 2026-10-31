import test from "node:test";
import assert from "node:assert/strict";
import { selectWindowsForegroundProcess } from "../dist/index.js";

// Snapshots in the shape the Toolhelp reader produces. The holder (100) owns
// the PTY; ConPTY adds an OpenConsole beside each shell.
const row = (pid, ppid, exe, createdAt) => ({ pid, ppid, exe, createdAt });
const holder = row(100, 4, "terminay-session-holder.exe", 1_000);

test("an idle PowerShell is its own foreground", () => {
  const rows = [holder, row(200, 100, "pwsh.exe", 2_000), row(201, 100, "OpenConsole.exe", 2_000), row(202, 200, "conhost.exe", 2_001)];
  assert.deepEqual(selectWindowsForegroundProcess(200, rows), { kind: "process", pid: 200, command: "pwsh" });
});

test("node running under Command Prompt is the foreground, through a one-child wrapper chain", () => {
  const rows = [
    holder,
    row(300, 100, "cmd.exe", 2_000),
    row(301, 300, "npx.cmd", 3_000),
    row(302, 301, "node.exe", 3_100),
  ];
  assert.deepEqual(selectWindowsForegroundProcess(300, rows), { kind: "process", pid: 302, command: "node" });
});

test("the newest child of the shell wins over an older background job", () => {
  const rows = [holder, row(400, 100, "powershell.exe", 2_000), row(401, 400, "python.exe", 3_000), row(402, 400, "node.exe", 4_000)];
  assert.equal(selectWindowsForegroundProcess(400, rows).command, "node");
});

test("a TUI with helper children is reported, not one of its helpers", () => {
  const rows = [
    holder,
    row(500, 100, "pwsh.exe", 2_000),
    row(501, 500, "claude.exe", 3_000),
    row(502, 501, "git.exe", 4_000),
    row(503, 501, "rg.exe", 4_001),
  ];
  assert.equal(selectWindowsForegroundProcess(500, rows).command, "claude");
});

test("a reused pid is not taken for a child", () => {
  // 601 names 600 as its parent, but 600 started after it: the real parent died
  // and its pid was reused.
  const rows = [holder, row(600, 100, "cmd.exe", 5_000), row(601, 600, "node.exe", 4_000)];
  assert.equal(selectWindowsForegroundProcess(600, rows).command, "cmd");
});

test("a WSL terminal is limited, because its processes run outside Windows", () => {
  const rows = [holder, row(700, 100, "wsl.exe", 2_000), row(701, 700, "wslhost.exe", 2_100)];
  assert.deepEqual(selectWindowsForegroundProcess(700, rows), { kind: "limited", reason: "wsl" });
});

test("a session whose shell is not in the snapshot is limited", () => {
  assert.deepEqual(selectWindowsForegroundProcess(800, [holder]), { kind: "limited", reason: "no-root" });
});
