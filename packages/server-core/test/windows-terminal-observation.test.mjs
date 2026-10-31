import test from "node:test";
import assert from "node:assert/strict";
import { windowsTerminalCwd, windowsTerminalForegroundCommand } from "../dist/index.js";

// Design decision 5: a Windows terminal's directory and foreground command come
// from one snapshot, through injected Win32 reads.

const rows = [
	{ pid: 10, ppid: 1, exe: "cmd.exe", createdAt: 100 },
	{ pid: 11, ppid: 10, exe: "conhost.exe", createdAt: 101 },
	{ pid: 12, ppid: 10, exe: "node.exe", createdAt: 200 },
	{ pid: 20, ppid: 1, exe: "wsl.exe", createdAt: 100 },
];

function host(cwds) {
	return { readProcessTable: () => rows, readProcessCwd: (pid) => cwds[pid] ?? null };
}

test("a terminal reports its foreground process's directory and command", () => {
	const observed = host({ 10: "C:\\", 12: "C:\\Windows" });
	assert.equal(windowsTerminalCwd(10, observed), "C:\\Windows");
	assert.equal(windowsTerminalForegroundCommand(10, observed), "node");
});

test("a foreground process that cannot be read falls back to the shell's directory", () => {
	assert.equal(windowsTerminalCwd(10, host({ 10: "C:\\Users" })), "C:\\Users");
});

test("a WSL terminal, a missing shell, or an unreadable table reports nothing", () => {
	const observed = host({ 20: "C:\\" });
	assert.equal(windowsTerminalCwd(20, observed), null);
	assert.equal(windowsTerminalForegroundCommand(20, observed), null);
	assert.equal(windowsTerminalCwd(99, observed), null);
	const blind = { readProcessTable: () => null, readProcessCwd: () => "C:\\" };
	assert.equal(windowsTerminalCwd(10, blind), null);
	assert.equal(windowsTerminalForegroundCommand(10, blind), null);
});
