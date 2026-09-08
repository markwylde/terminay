export { HELP_TEXT, UsageError, parseCommandLine } from './args.js';
export type { DaemonCommand, DaemonOptions, InstallScope, PairingMode, ParsedCommandLine } from './args.js';
export { SYSTEMD_MARKER, UnsupportedHostError, assertSupportedHost, hostArchitecture, readHostFacts } from './platform.js';
export type { HostFacts } from './platform.js';
