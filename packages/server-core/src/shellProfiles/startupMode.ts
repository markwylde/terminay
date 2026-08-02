export type ShellStartupModeFamily = "posix" | "powershell";

const POSIX_STARTUP_MODE_SHELLS = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"]);
const POWERSHELL_STARTUP_MODE_SHELLS = new Set(["powershell", "pwsh"]);

/** Classify startup-mode support from a shell executable without relying on
 * the host OS path implementation. Discovery and launch must use this same
 * authority so a validated profile cannot later fail solely due to drift. */
export function shellStartupModeFamily(executable: string): ShellStartupModeFamily | null {
  const name = executable
    .replace(/\\/gu, "/")
    .split("/")
    .at(-1)
    ?.replace(/\.exe$/iu, "")
    .toLocaleLowerCase("en-US");
  if (name !== undefined && POSIX_STARTUP_MODE_SHELLS.has(name)) return "posix";
  if (name !== undefined && POWERSHELL_STARTUP_MODE_SHELLS.has(name)) return "powershell";
  return null;
}

export function supportsShellStartupMode(executable: string): boolean {
  return shellStartupModeFamily(executable) !== null;
}
