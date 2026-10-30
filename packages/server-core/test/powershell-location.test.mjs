import test from "node:test";
import assert from "node:assert/strict";
import { encodePowerShellCommand, POWERSHELL_LOCATION_HOOK, shellLaunchArgs } from "../dist/index.js";

// ADR-0085: an interactive PowerShell on Windows keeps its process directory
// in step with its location; nothing else is changed.

const hooked = (args) => [...args, "-NoExit", "-EncodedCommand", encodePowerShellCommand(POWERSHELL_LOCATION_HOOK)];

test("an interactive PowerShell on Windows runs the location hook after its profiles", () => {
	assert.deepEqual(shellLaunchArgs("C:\\Program Files\\PowerShell\\7\\pwsh.exe", [], "win32"), hooked([]));
	assert.deepEqual(shellLaunchArgs("powershell.exe", ["-NoLogo"], "win32"), hooked(["-NoLogo"]));
	assert.deepEqual(shellLaunchArgs("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE", [], "win32"), hooked([]));
});

test("other shells, other platforms, and PowerShell given its own command start as configured", () => {
	assert.deepEqual(shellLaunchArgs("C:\\Windows\\System32\\cmd.exe", ["/k"], "win32"), ["/k"]);
	assert.deepEqual(shellLaunchArgs("wsl.exe", ["-d", "Ubuntu"], "win32"), ["-d", "Ubuntu"]);
	assert.deepEqual(shellLaunchArgs("/usr/bin/pwsh", [], "linux"), []);
	for (const args of [["-Command", "Get-Date"], ["-c", "x"], ["-File", "a.ps1"], ["-EncodedCommand", "AA=="], ["-NonInteractive"]])
		assert.deepEqual(shellLaunchArgs("pwsh.exe", args, "win32"), args);
});

test("the hook is UTF-16LE base64, as -EncodedCommand reads it", () => {
	assert.equal(encodePowerShellCommand("dir"), Buffer.from("dir", "utf16le").toString("base64"));
	assert.equal(encodePowerShellCommand(POWERSHELL_LOCATION_HOOK), Buffer.from(POWERSHELL_LOCATION_HOOK, "utf16le").toString("base64"));
	assert.match(POWERSHELL_LOCATION_HOOK, /\[System\.Environment\]::CurrentDirectory = \$PWD\.ProviderPath/);
});
