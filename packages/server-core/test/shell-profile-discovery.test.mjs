import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ShellProfileDiscoveryError,
  ShellProfileDiscoveryService,
} from "../dist/shellProfiles/discovery.js";
import { readBoundedEtcShells } from "../dist/shellProfiles/nodeHost.js";

function profile(overrides = {}) {
  return {
    id: "profile-a",
    name: "Development shell",
    target: { kind: "executable", executable: "/bin/zsh" },
    args: ["--no-rcs", "argument with spaces"],
    startupMode: "default",
    environment: { FEATURE_FLAG: "on", OPTIONAL_VALUE: null },
    ...overrides,
  };
}

function fixtureHost(options) {
  const canonical = new Map(options.executables ?? []);
  const probes = [];
  return {
    probes,
    host: {
      platform: options.platform,
      accountShell: options.accountShell,
      environmentShell: options.environmentShell,
      openSshDefaultShell: options.openSshDefaultShell,
      comSpec: options.comSpec,
      windowsPowerShellCandidates: options.windowsPowerShellCandidates,
      powerShell7Candidates: options.powerShell7Candidates,
      commandPromptCandidates: options.commandPromptCandidates,
      gitBashCandidates: options.gitBashCandidates,
      readEtcShells: options.etcShells === undefined ? undefined : () => options.etcShells,
      listWslDistributions: options.wsl === undefined ? undefined : () => options.wsl,
      probeExecutable(candidate) {
        probes.push(candidate);
        return canonical.get(candidate) ?? null;
      },
    },
  };
}

test("POSIX discovery prefers the account shell and canonicalizes and deduplicates candidates", async () => {
  const fixture = fixtureHost({
    platform: "darwin",
    accountShell: "/usr/local/bin/zsh",
    environmentShell: "/bin/bash",
    etcShells: "# approved shells\n/bin/zsh\n/bin/bash\nrelative-shell\n/bin/missing\n",
    executables: [
      ["/usr/local/bin/zsh", "/bin/zsh"],
      ["/bin/zsh", "/bin/zsh"],
      ["/bin/bash", "/bin/bash"],
      ["/bin/sh", "/bin/sh"],
    ],
  });
  const result = await new ShellProfileDiscoveryService(fixture.host).discover();

  assert.equal(result.systemExecutable, "/bin/zsh");
  assert.equal(result.systemProfile.id, "system");
  assert.equal(result.systemProfile.availability.available, true);
  assert.deepEqual(result.systemProfile.projectReferences, []);
  assert.equal("environment" in result.systemProfile, false);
  assert.deepEqual(result.discoveredProfiles.map((entry) => entry.target.executable), ["/bin/zsh", "/bin/bash", "/bin/sh"]);
  assert.equal(result.discoveredProfiles[0].source, "account");
  assert.equal(new Set(result.discoveredProfiles.map((entry) => entry.id)).size, 3);
  assert.equal(fixture.probes.includes("relative-shell"), false);
});

test("Node host bounds /etc/shells before allocating or returning hostile file content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-shells-"));
  const path = join(directory, "shells");
  try {
    await writeFile(path, `/bin/zsh\n${"x".repeat(128 * 1024)}`);
    const result = await readBoundedEtcShells(path);
    assert.ok(Buffer.byteLength(result, "utf8") <= 64 * 1024);
    assert.match(result, /^\/bin\/zsh/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Linux ignores a relative inherited SHELL and follows its documented fallback order", async () => {
  const fixture = fixtureHost({
    platform: "linux",
    accountShell: "/missing/account-shell",
    environmentShell: "attacker-shell",
    etcShells: "/missing/etc-shell\n",
    executables: [["/bin/bash", "/usr/bin/bash"], ["/bin/zsh", "/usr/bin/zsh"], ["/bin/sh", "/usr/bin/sh"]],
  });
  const result = await new ShellProfileDiscoveryService(fixture.host).discover();

  assert.equal(result.systemExecutable, "/usr/bin/bash");
  assert.equal(fixture.probes.includes("attacker-shell"), false);
  assert.deepEqual(result.discoveredProfiles.map((entry) => entry.target.executable), ["/usr/bin/bash", "/usr/bin/zsh", "/usr/bin/sh"]);
});

test("an unavailable POSIX host reports System default unavailable without inventing a shell", async () => {
  const fixture = fixtureHost({ platform: "darwin", environmentShell: "/missing", executables: [] });
  const result = await new ShellProfileDiscoveryService(fixture.host).discover();

  assert.equal(result.systemExecutable, null);
  assert.deepEqual(result.discoveredProfiles, []);
  assert.equal(result.systemProfile.availability.available, false);
  assert.match(result.systemProfile.availability.reason, /No usable system shell/);
});

test("Windows discovers native shells, Git Bash, and structured WSL profiles without making PowerShell 7 the system default", async () => {
  const fixture = fixtureHost({
    platform: "win32",
    environmentShell: "missing-shell.exe",
    openSshDefaultShell: "missing-openssh.exe",
    comSpec: "C:\\Windows\\System32\\cmd.exe",
    windowsPowerShellCandidates: ["powershell.exe"],
    powerShell7Candidates: ["pwsh.exe"],
    commandPromptCandidates: ["cmd.exe"],
    gitBashCandidates: ["git-bash.exe"],
    wsl: ["Ubuntu 24.04", "ubuntu 24.04", "-invalid", "Debian"],
    executables: [
      ["powershell.exe", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"],
      ["pwsh.exe", "C:\\Program Files\\PowerShell\\7\\pwsh.exe"],
      ["C:\\Windows\\System32\\cmd.exe", "C:\\Windows\\System32\\cmd.exe"],
      ["cmd.exe", "C:\\Windows\\System32\\cmd.exe"],
      ["git-bash.exe", "C:\\Program Files\\Git\\bin\\bash.exe"],
      ["wsl.exe", "C:\\Windows\\System32\\wsl.exe"],
    ],
  });
  const service = new ShellProfileDiscoveryService(fixture.host);
  const result = await service.discover();

  assert.equal(result.systemExecutable, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(result.discoveredProfiles.some((entry) => entry.name === "PowerShell 7"), true);
  assert.equal(result.discoveredProfiles.some((entry) => entry.source === "git-bash"), true);
  const wsl = result.discoveredProfiles.filter((entry) => entry.target.kind === "wsl");
  assert.deepEqual(wsl.map((entry) => entry.target.distribution), ["Ubuntu 24.04", "Debian"]);
  assert.equal(wsl.every((entry) => entry.target.kind === "wsl" && !("executable" in entry.target)), true);

  const resolved = await service.resolveTarget(profile({
    target: { kind: "wsl", distribution: "ubuntu 24.04", shellPath: "/bin/zsh" },
  }), result);
  assert.deepEqual(resolved, {
    kind: "wsl",
    executable: "C:\\Windows\\System32\\wsl.exe",
    distribution: "Ubuntu 24.04",
    shellPath: "/bin/zsh",
  });
});

test("profile validation preserves argv and null environment values while rejecting protected and secret fields", () => {
  const fixture = fixtureHost({ platform: "darwin", executables: [["/bin/zsh", "/bin/zsh"]] });
  const service = new ShellProfileDiscoveryService(fixture.host);
  const valid = profile();
  const before = structuredClone(valid);
  assert.deepEqual(service.validate(valid), { valid: true, issues: [] });
  assert.deepEqual(valid, before);

  const invalid = service.validate(profile({
    environment: {
      TERMINAY_CONTROL_TOKEN: "must-not-appear-in-errors",
      API_TOKEN: "also-must-not-appear",
      OPTIONAL_VALUE: null,
    },
    credential: "must-not-appear",
  }));
  assert.equal(invalid.valid, false);
  assert.deepEqual(new Set(invalid.issues.map((entry) => entry.code)), new Set(["protected-environment", "secret-environment", "secret-field"]));
  assert.equal(JSON.stringify(invalid).includes("must-not-appear"), false);
});

test("validation rejects malformed WSL targets, unsupported startup modes, review-required profiles, duplicates, and collection limits", () => {
  const service = new ShellProfileDiscoveryService(fixtureHost({ platform: "linux", executables: [] }).host);
  const invalidWsl = service.validate(profile({
    target: { kind: "wsl", distribution: "-exec", shellPath: "relative/custom-shell" },
    startupMode: "login",
    requiresReview: true,
  }));
  assert.deepEqual(new Set(invalidWsl.issues.map((entry) => entry.code)), new Set([
    "invalid-distribution",
    "invalid-wsl-shell",
    "unsupported-startup-mode",
    "unsupported-target",
    "review-required",
  ]));

  const duplicates = service.validateProfiles([
    profile(),
    profile({ name: "development SHELL" }),
  ]);
  assert.equal(duplicates.valid, false);
  assert.equal(duplicates.issues.some((entry) => entry.code === "duplicate-id"), true);
  assert.equal(duplicates.issues.some((entry) => entry.code === "duplicate-name"), true);

  const tooMany = service.validateProfiles(Array.from({ length: 65 }, (_, index) => profile({ id: `p-${index}`, name: `Profile ${index}` })));
  assert.equal(tooMany.issues.some((entry) => entry.code === "profile-limit"), true);
});

test("launch resolution revalidates executable availability and returns bounded metadata-only errors", async () => {
  const fixture = fixtureHost({ platform: "darwin", executables: [["/bin/zsh", "/private/canonical/zsh"]] });
  const service = new ShellProfileDiscoveryService(fixture.host);
  assert.deepEqual(await service.resolveTarget(profile()), { kind: "executable", executable: "/private/canonical/zsh" });

  await assert.rejects(
    service.resolveTarget(profile({ target: { kind: "executable", executable: "/missing/shell" }, environment: { API_TOKEN: "never-log-this" } })),
    (error) => error instanceof ShellProfileDiscoveryError
      && error.code === "invalid-profile"
      && !error.message.includes("never-log-this"),
  );
});

test("hostile discovery inputs are capped and the redacted discovery result stays within its protocol budget", async () => {
  const oversizedEtcShells = "/bin/ignored\n".repeat(6_000);
  let etcProbeCount = 0;
  const posix = new ShellProfileDiscoveryService({
    platform: "linux",
    readEtcShells: () => oversizedEtcShells,
    probeExecutable(candidate) {
      etcProbeCount += 1;
      return candidate.startsWith("/bin/") ? candidate : null;
    },
  });
  const posixResult = await posix.discover();
  assert.equal(etcProbeCount, 3, "oversized /etc/shells input is discarded before line processing");
  assert.equal(posixResult.systemExecutable, "/bin/bash");

  const many = Array.from({ length: 10_000 }, (_, index) => `shell-${index}.exe`);
  const longPrefix = `C:\\${"deep-path\\".repeat(390)}`;
  const windows = new ShellProfileDiscoveryService({
    platform: "win32",
    windowsPowerShellCandidates: many,
    powerShell7Candidates: many,
    commandPromptCandidates: many,
    gitBashCandidates: many,
    listWslDistributions: () => Array.from({ length: 10_000 }, (_, index) => `Distribution ${index}`),
    probeExecutable(candidate) {
      if (candidate === "wsl.exe") return "C:\\Windows\\System32\\wsl.exe";
      return `${longPrefix}${candidate}`;
    },
  });
  const windowsResult = await windows.discover();
  const serializedBytes = new TextEncoder().encode(JSON.stringify(windowsResult)).byteLength;
  assert.equal(windowsResult.discoveredProfiles.length <= 128, true);
  assert.equal(serializedBytes <= 24 * 1024, true);
  assert.equal(windowsResult.systemProfile.id, "system", "System default is retained when discovery is truncated");
  assert.equal(windowsResult.discoveredProfiles.every((entry) => entry.name.length <= 128), true);
});

test("host call deadlines abort and bound hanging discovery adapters", async () => {
  const signals = [];
  const service = new ShellProfileDiscoveryService({
    platform: "darwin",
    accountShell: "/bin/hanging",
    readEtcShells: (signal) => {
      signals.push(signal);
      return new Promise(() => {});
    },
    probeExecutable(_candidate, signal) {
      signals.push(signal);
      return new Promise(() => {});
    },
  }, { hostCallTimeoutMs: 10 });

  const started = Date.now();
  const result = await service.discover();
  const elapsed = Date.now() - started;
  assert.equal(result.systemProfile.availability.available, false);
  assert.equal(elapsed < 500, true, `hanging host calls took ${elapsed}ms`);
  assert.equal(signals.length, 5);
  assert.equal(signals.every((signal) => signal.aborted), true);
});
