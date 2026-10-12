import {
	createServerCoreComposition,
	type ServerCoreComposition,
	type ServerCoreCompositionOptions,
} from '@terminay/server-core';

/**
 * Electron-free authority surface for the embedded Desktop server.
 *
 * Desktop supplies a host-neutral PTY factory and authentication policy, then
 * wires `composition.core.accept(...)` to its private framed transport. The
 * server package owns the terminal service, operation registry, event journal,
 * and connection cleanup; no Electron object crosses this boundary.
 */
export type EmbeddedDesktopAuthorityOptions = Omit<
	ServerCoreCompositionOptions,
	'serverUpgrade'
>;

export function createEmbeddedDesktopAuthority(
	options: EmbeddedDesktopAuthorityOptions,
): ServerCoreComposition {
	// The embedded server is updated with Terminay Desktop (ADR-0062). It is
	// never given an upgrader, whatever its caller or environment carries, so
	// it checks no release and offers no upgrade.
	const { serverUpgrade: _serverUpgrade, ...embedded } =
		options as ServerCoreCompositionOptions;
	return createServerCoreComposition(embedded);
}
