import { constants } from "node:fs";
import { access, open, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ShellDiscoveryHost, ShellDiscoveryPlatform } from "./discovery.js";

const execFileAsync = promisify(execFile);
const MAX_ETC_SHELLS_READ_BYTES = 64 * 1024;

/** Privileged Node host adapter shared by Desktop and standalone servers. */
export async function createNodeShellDiscoveryHost(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ShellDiscoveryHost> {
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    throw new TypeError(`shell discovery is unsupported on ${platform}`);
  }
  const windows = platform === "win32";
  const programFiles = environment.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = environment["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return {
    platform: platform as ShellDiscoveryPlatform,
    accountShell: windows ? null : safeAccountShell(),
    environmentShell: environment.SHELL ?? null,
    openSshDefaultShell: windows ? await readOpenSshDefaultShell() : null,
    comSpec: windows ? environment.ComSpec ?? environment.COMSPEC ?? null : null,
    powerShell7Candidates: windows ? [join(programFiles, "PowerShell", "7", "pwsh.exe"), "pwsh.exe"] : [],
    gitBashCandidates: windows ? [
      join(programFiles, "Git", "bin", "bash.exe"),
      join(programFiles, "Git", "usr", "bin", "bash.exe"),
      join(programFilesX86, "Git", "bin", "bash.exe"),
    ] : [],
    probeExecutable: (candidate) => probeExecutable(candidate, environment, windows),
    ...(windows ? { listWslDistributions } : { readEtcShells: () => readBoundedEtcShells() }),
  };
}

export async function readBoundedEtcShells(path = "/etc/shells"): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(MAX_ETC_SHELLS_READ_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    return buffer.subarray(0, Math.min(bytesRead, MAX_ETC_SHELLS_READ_BYTES)).toString("utf8");
  } finally {
    await handle.close();
  }
}

function safeAccountShell(): string | null {
  try {
    const shell = userInfo().shell;
    return typeof shell === "string" && shell.length > 0 ? shell : null;
  } catch {
    return null;
  }
}

async function probeExecutable(
  candidate: string,
  environment: Readonly<Record<string, string | undefined>>,
  windows: boolean,
): Promise<string | null> {
  if (candidate.length === 0 || candidate.length > 4_096 || candidate.includes("\0")) return null;
  if (isAbsolute(candidate)) return executablePath(candidate);
  const pathEntries = (environment.PATH ?? environment.Path ?? "").split(delimiter).filter(Boolean);
  const suffixes = windows && !/\.[A-Za-z0-9]+$/u.test(candidate)
    ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const directory of pathEntries) {
    for (const suffix of suffixes) {
      const found = await executablePath(join(directory, `${candidate}${suffix}`));
      if (found !== null) return found;
    }
  }
  return null;
}

async function executablePath(candidate: string): Promise<string | null> {
  try {
    await access(candidate, constants.X_OK);
    return await realpath(candidate);
  } catch {
    return null;
  }
}

async function readOpenSshDefaultShell(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("reg.exe", [
      "query", "HKLM\\SOFTWARE\\OpenSSH", "/v", "DefaultShell",
    ], { windowsHide: true, timeout: 2_000, maxBuffer: 64 * 1024 });
    const match = stdout.match(/DefaultShell\s+REG_SZ\s+(.+)$/imu);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

async function listWslDistributions(): Promise<readonly string[]> {
  try {
    const { stdout } = await execFileAsync("wsl.exe", ["--list", "--quiet"], {
      windowsHide: true,
      timeout: 3_000,
      maxBuffer: 256 * 1024,
      encoding: "buffer",
    });
    // Windows PowerShell-era WSL emits UTF-16LE even when the parent uses UTF-8.
    const bytes = stdout as unknown as Buffer;
    const text = bytes.includes(0) ? bytes.toString("utf16le") : bytes.toString("utf8");
    return text.split(/\r?\n/u).map((entry) => entry.replace(/^\*\s*/u, "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}
