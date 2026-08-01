import {
  createLegacyFileViewerClient,
  captureLegacyFileViewerCapability,
  type LegacyFileGatewayApi,
} from './terminayFileGateway'

/** Disconnected-Desktop fallback kept outside connected feature components. */
export function createDisconnectedFolderCompatibility(
  fileApi: LegacyFileGatewayApi,
  explorerHost: NonNullable<typeof window.terminayFileExplorerHost>,
) {
  const capability = captureLegacyFileViewerCapability(fileApi)
  return Object.freeze({
  createClient: () => createLegacyFileViewerClient(capability),
  calculateSize: (request: { jobId: string; path: string }) =>
    explorerHost.calculateFolderSize(request),
  cancelSize: (jobId: string) =>
    explorerHost.cancelFolderSize(jobId),
  subscribeSize: (
    listener: Parameters<NonNullable<typeof window.terminayFileExplorerHost>['subscribeFolderSizeProgress']>[0],
  ) => explorerHost.subscribeFolderSizeProgress(listener),
  subscribeWatches: (
    listener: Parameters<NonNullable<typeof window.terminayFileExplorerHost>['subscribeWatchEvents']>[0],
  ) => explorerHost.subscribeWatchEvents(listener),
  watchDirectory: (path: string) =>
    explorerHost.watchDirectory(path),
  unwatchDirectory: (path: string) =>
    explorerHost.unwatchDirectory(path),
  })
}

export type DisconnectedFolderCompatibility = ReturnType<
  typeof createDisconnectedFolderCompatibility
>
