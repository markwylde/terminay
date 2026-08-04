import {
	createLegacyFileViewerClient,
	createTerminayFileGateway,
	captureLegacyFileViewerCapability,
	type LegacyFileGatewayApi,
} from './terminayFileGateway';

/** Disconnected Desktop and not-yet-composed mutation capabilities. */
export function createDisconnectedFilePanelCompatibility(
	api: LegacyFileGatewayApi,
) {
	const capability = captureLegacyFileViewerCapability(api);
	const gateway = createTerminayFileGateway(capability);
	return Object.freeze({
		createClient: () => createLegacyFileViewerClient(capability),
		gateway,
		getMutationRevision: (path: string) => gateway.getFileInfo(path),
	});
}

export type DisconnectedFilePanelCompatibility = ReturnType<
	typeof createDisconnectedFilePanelCompatibility
>;
