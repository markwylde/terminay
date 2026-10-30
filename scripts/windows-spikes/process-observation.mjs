// Spike 1.4 (native-windows-desktop): the koffi bindings in server-core
// against real Windows processes. Reads the current directory of a 64-bit
// Command Prompt, a 32-bit one, and PowerShell after `Set-Location`; selects the
// foreground under cmd; times reads; checks the SID and the protected DACL.
// Needs a built server-core. Run with Node on Windows; prints JSON.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const core = await import(new URL('../../packages/server-core/dist/index.js', import.meta.url));
const result = { bindings: core.windowsBindingsAvailable() };
const target = 'C:\\Windows\\System32\\drivers';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function start(file, args) {
	const child = spawn(file, args, { cwd: 'C:\\', stdio: 'ignore', windowsHide: true });
	return child;
}

const cmd64 = start('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', `cd /d ${target} && ping -n 60 127.0.0.1 > nul`]);
const cmd32 = start('C:\\Windows\\SysWOW64\\cmd.exe', ['/d', '/c', `cd /d ${target} && ping -n 60 127.0.0.1 > nul`]);
const pwshSetLocation = start('powershell.exe', ['-NoProfile', '-Command', `Set-Location '${target}'; Start-Sleep 60`]);
const pwshEnvironment = start('powershell.exe', [
	'-NoProfile',
	'-Command',
	`Set-Location '${target}'; [Environment]::CurrentDirectory = (Get-Location).Path; Start-Sleep 60`,
]);
await wait(4_000);

result.cwd = {
	expected: target,
	cmd64: core.readWindowsProcessCwd(cmd64.pid),
	cmd32: core.readWindowsProcessCwd(cmd32.pid),
	powershellSetLocationOnly: core.readWindowsProcessCwd(pwshSetLocation.pid),
	powershellWithEnvironmentCurrentDirectory: core.readWindowsProcessCwd(pwshEnvironment.pid),
	self: core.readWindowsProcessCwd(process.pid),
	selfExpected: process.cwd(),
	system: core.readWindowsProcessCwd(4),
};

const table = core.readWindowsProcessTable();
result.table = {
	rows: table?.length ?? null,
	cmd64Children: table?.filter((row) => row.ppid === cmd64.pid).map((row) => row.exe),
	cmd64CreatedAtPlausible: Math.abs((table?.find((row) => row.pid === cmd64.pid)?.createdAt ?? 0) - Date.now()) < 120_000,
	foregroundUnderCmd64: core.selectWindowsForegroundProcess(cmd64.pid, table ?? []),
};

let started = performance.now();
for (let index = 0; index < 1_000; index += 1) core.readWindowsProcessCwd(cmd64.pid);
result.timing = { cwdReadMicroseconds: Math.round(((performance.now() - started) * 1_000) / 1_000) };
started = performance.now();
for (let index = 0; index < 20; index += 1) core.readWindowsProcessTable();
result.timing.snapshotMilliseconds = Math.round((performance.now() - started) / 20);

result.sid = core.currentWindowsUserSid();
try {
	result.whoamiSid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).trim().split(',').at(-1).replaceAll('"', '');
} catch (error) {
	result.whoamiSid = `error: ${error.message}`;
}

const protectedDirectory = mkdtempSync(join(tmpdir(), 'tpd-'));
result.protect = core.protectWindowsDirectory(protectedDirectory, result.sid ?? '');
result.protectedAcl = execFileSync('icacls.exe', [protectedDirectory], { encoding: 'utf8' }).trim();

for (const child of [cmd64, cmd32, pwshSetLocation, pwshEnvironment]) child.kill();
// ADR-0082: an interactive PowerShell in a ConPTY, started with the arguments
// Terminay adds, keeps its process directory in step after `Set-Location`.
async function hookedPowerShell(shell) {
	const { createRequire } = await import('node:module');
	const pty = createRequire(import.meta.url)('node-pty');
	const term = pty.spawn(shell, core.shellLaunchArgs(shell, ['-NoLogo', '-NoProfile'], 'win32'), {
		cwd: 'C:\\',
		cols: 120,
		rows: 30,
	});
	let output = '';
	term.onData((data) => {
		output += data;
	});
	await wait(5_000);
	term.write(`Set-Location '${target}'\r`);
	await wait(3_000);
	const cwd = core.readWindowsProcessCwd(term.pid);
	term.write(`Set-Location 'HKCU:\\Software'\r`);
	await wait(2_000);
	const afterRegistry = core.readWindowsProcessCwd(term.pid);
	term.kill();
	return { cwd, afterRegistry, promptStillDrawn: /PS .*drivers>/u.test(output) };
}
try {
	result.powershellHook = {
		windowsPowerShell: await hookedPowerShell('powershell.exe'),
		pwsh: await hookedPowerShell('pwsh.exe'),
	};
} catch (error) {
	result.powershellHook = `error: ${String(error?.stack ?? error).slice(0, 600)}`;
}

console.log(JSON.stringify(result, null, 2));
process.exit(0);
