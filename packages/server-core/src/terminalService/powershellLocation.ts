/**
 * PowerShell's location is not its process's current directory: `Set-Location`
 * moves only the provider location, so Windows goes on reporting the directory
 * PowerShell started in. An interactive PowerShell that Terminay starts on
 * Windows therefore runs one command after its profiles load. It wraps the
 * prompt the user has, so that each prompt first sets the process directory to
 * a filesystem location, and then draws exactly what it drew before
 * (ADR-0085, terminal-workspace).
 */

const POWERSHELL_EXECUTABLES = new Set(['pwsh', 'powershell']);

/** Arguments after which PowerShell runs something other than an interactive prompt. */
const NON_INTERACTIVE_PARAMETERS = [
	'-command',
	'-c',
	'-file',
	'-f',
	'-encodedcommand',
	'-e',
	'-ec',
	'-noninteractive',
];

export const POWERSHELL_LOCATION_HOOK = [
	'if (-not $global:__TerminayPrompt) {',
	'$global:__TerminayPrompt = $function:prompt;',
	'function global:prompt {',
	"if ($PWD.Provider.Name -eq 'FileSystem') { [System.Environment]::CurrentDirectory = $PWD.ProviderPath };",
	'& $global:__TerminayPrompt',
	'} }',
].join(' ');

/**
 * The arguments to start a shell with on `platform`. Only an interactive
 * PowerShell on Windows is changed; every other shell, and a PowerShell given
 * its own command or script, starts exactly as configured.
 */
export function shellLaunchArgs(
	shellPath: string,
	args: readonly string[],
	platform: string,
): string[] {
	if (platform !== 'win32' || !isPowerShell(shellPath)) return [...args];
	if (
		args.some((arg) =>
			NON_INTERACTIVE_PARAMETERS.includes(arg.toLowerCase().split(':')[0] ?? ''),
		)
	)
		return [...args];
	return [
		...args,
		'-NoExit',
		'-EncodedCommand',
		encodePowerShellCommand(POWERSHELL_LOCATION_HOOK),
	];
}

/** `-EncodedCommand` takes UTF-16LE in base64, which needs no quoting. */
export function encodePowerShellCommand(command: string): string {
	const bytes = new Uint8Array(command.length * 2);
	for (let index = 0; index < command.length; index += 1) {
		const unit = command.charCodeAt(index);
		bytes[index * 2] = unit & 0xff;
		bytes[index * 2 + 1] = unit >> 8;
	}
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function isPowerShell(shellPath: string): boolean {
	const name = shellPath
		.split(/[\\/]/u)
		.pop()
		?.replace(/\.exe$/iu, '')
		.toLowerCase();
	return name !== undefined && POWERSHELL_EXECUTABLES.has(name);
}
