import type { DesktopBundleLaunch } from "./serverBundleHost.js";
import { DesktopServerBundleHost } from "./serverBundleHost.js";

export interface LocalServerUiSessionOptions {
	readonly bundleRoot: string;
	readonly cacheRoot: string;
	readonly serverId: string;
}

/** Privileged owner for the embedded server's verified UI selection.
 * `sessionOrigin` is bundle identity only: no listener is created. Local
 * application bytes remain on Desktop's private MessagePort. */
export class LocalServerUiSession {
  static readonly profileId = "local:embedded";
  static readonly sessionOrigin = "http://127.0.0.1";
  private readonly bundleHost: DesktopServerBundleHost;
  private readonly launches = new Map<number, DesktopBundleLaunch>();

  constructor(private readonly options: LocalServerUiSessionOptions) {
    this.bundleHost = new DesktopServerBundleHost({ cacheRoot: options.cacheRoot, capabilities: {
      clipboardWrite: 1,
      filePicker: 1,
      nativeMenus: 1,
      nativeWindows: 1,
      notifications: 1,
      osIntegration: 1,
      updater: 1,
    } });
  }

  async prepare(webContentsId: number): Promise<DesktopBundleLaunch> {
    if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0) throw new TypeError("Local server UI window id is invalid");
    const existing = this.launches.get(webContentsId);
    if (existing !== undefined) return existing;
    const launch = await this.bundleHost.prepareLocal({ artifact: { rootDirectory: this.options.bundleRoot }, origin: LocalServerUiSession.sessionOrigin, profileId: LocalServerUiSession.profileId, serverId: this.options.serverId, windowId: `window-${webContentsId}` });
    this.launches.set(webContentsId, launch);
    return launch;
  }

  release(webContentsId: number): void { this.launches.delete(webContentsId); }
  launchFor(webContentsId: number): DesktopBundleLaunch | undefined { return this.launches.get(webContentsId); }
}
