import { join } from 'node:path';
import {
	type OrderedEventJournalLike,
	type RequestContext,
	connectDesktopHolder,
	ServerDesktopService,
	type ServerDesktopSetup,
	serverDesktopDirectoryFits,
} from '@terminay/server-core';
import {
	controlSocketRuntimeDirectory,
	prepareControlSocketRuntimeDirectory,
} from './mcp/controlSocketPlacement.js';

/** The command an operator runs to install what the desktop needs. */
export const SERVER_DESKTOP_INSTALL_COMMAND =
	'sudo terminay daemon desktop install';

/** Setup where the server has no way to install packages itself: it reports
 * the command and starts the desktop once the programs are found. */
export const manualServerDesktopSetup: ServerDesktopSetup = Object.freeze({
	describe: async () => ({
		means: 'command' as const,
		command: SERVER_DESKTOP_INSTALL_COMMAND,
	}),
	run: async () => ({
		ok: false as const,
		reason: 'Setup has to be run by an operator on this host.',
	}),
	running: async () => undefined,
});

/**
 * Where the desktop's sockets, cookie and logs live: in the data directory,
 * which only the server account reads, or, when that path is too long for a
 * socket, in the per-data-directory runtime directory under the temporary
 * directory (ADR-0054). The temporary directory is used and never
 * `XDG_RUNTIME_DIR`, which is emptied at logout while the desktop lives on.
 */
export async function serverDesktopDirectory(options: {
	readonly dataRoot: string;
	readonly temporaryDirectory: string;
}): Promise<string | undefined> {
	const inData = join(options.dataRoot, 'desktop');
	if (serverDesktopDirectoryFits(inData)) return inData;
	const runtime = controlSocketRuntimeDirectory({
		dataDirectory: options.dataRoot,
		temporaryDirectory: options.temporaryDirectory,
	});
	const directory = join(runtime, 'desktop');
	if (!serverDesktopDirectoryFits(directory)) return undefined;
	const prepared = await prepareControlSocketRuntimeDirectory(runtime);
	return prepared.ok ? directory : undefined;
}

/**
 * The server desktop of a standalone server. Every standalone server composes
 * one, on any host: where the host cannot offer a desktop the service says
 * so, with the reason. An embedded server never calls this.
 */
export async function createStandaloneServerDesktop(options: {
	readonly dataRoot: string;
	readonly home: string;
	readonly temporaryDirectory: string;
	readonly eventJournal: OrderedEventJournalLike;
	readonly deviceName?: (context: RequestContext) => string | undefined;
	readonly setup?: ServerDesktopSetup;
	readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<ServerDesktopService | undefined> {
	const directory = await serverDesktopDirectory(options);
	if (directory === undefined) {
		process.stderr.write(
			'[terminay-server] server desktop: no directory short enough for its sockets; the desktop is not offered\n',
		);
		return undefined;
	}
	return new ServerDesktopService({
		eventJournal: options.eventJournal,
		directory,
		dataRoot: options.dataRoot,
		home: options.home,
		setup: options.setup ?? manualServerDesktopSetup,
		...(options.env === undefined ? {} : { env: options.env }),
		...(options.deviceName === undefined
			? {}
			: { deviceName: options.deviceName }),
		onDiagnostic: (message) => {
			process.stderr.write(`[terminay-server] ${message}\n`);
		},
	});
}

/**
 * End the desktop a server left running, for `end-sessions`: an uninstall
 * leaves no holder behind. Says what it found.
 */
export async function endStandaloneServerDesktop(options: {
	readonly dataRoot: string;
	readonly temporaryDirectory: string;
}): Promise<'none' | 'ended' | 'unreachable'> {
	const directory = await serverDesktopDirectory(options);
	if (directory === undefined) return 'none';
	const connection = await connectDesktopHolder(directory);
	if (connection.outcome === 'absent') return 'none';
	// A holder of another build ends itself when it is refused.
	if (connection.outcome === 'replaced') return 'ended';
	if (connection.outcome !== 'adopted') return 'unreachable';
	await connection.client.stop();
	return 'ended';
}
