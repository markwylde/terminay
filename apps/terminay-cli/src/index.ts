export type {
	DaemonCommand,
	DaemonOptions,
	InstallScope,
	PairingMode,
	ParsedCommandLine,
} from './args.js';
export { HELP_TEXT, parseCommandLine, UsageError } from './args.js';
export { runInstall } from './commands/install.js';
export { runStart, runStatus, runStop } from './commands/lifecycle.js';
export {
	runApprovals,
	runPairing,
	runResolveApproval,
} from './commands/pairing.js';
export { runResetIdentity, runUninstall } from './commands/uninstall.js';
export { runUpgrade } from './commands/upgrade.js';
export { NotInstalledError, resolveContext } from './context.js';
export {
	installLayout,
	readInstallRecord,
	writeInstallRecord,
} from './layout.js';
export type { HostFacts } from './platform.js';
export {
	assertSupportedHost,
	hostArchitecture,
	readHostFacts,
	SYSTEMD_MARKER,
	UnsupportedHostError,
} from './platform.js';
export { buildFromSource, preflightToolchain } from './source.js';
