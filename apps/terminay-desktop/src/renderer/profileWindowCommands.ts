/**
 * Renderer-owned, least-authority native-window capability.
 *
 * This deliberately has no dependency on Electron, preload implementation, or
 * Desktop main-process types.  The host supplies only a bound connection id
 * and the one validated window-open dispatch required by shared UI.
 */
export interface OpenCurrentProfileWindowRequest {
  readonly workspaceViewId?: string;
}

export interface DesktopProfileWindowCommandClient {
  openCurrentProfileWindow(request?: OpenCurrentProfileWindowRequest): Promise<void>;
}

export interface DesktopProfileWindowHost {
  getContext(): Promise<{ readonly connectionId: string }>;
  openWindow(action: {
    readonly type: "window.open";
    readonly profileId: string;
    readonly workspaceViewId?: string;
  }): Promise<unknown>;
}

/**
 * The target connection always comes from host-bound context.  Shared UI can
 * select an optional logical view, but can never choose another profile.
 */
export function createDesktopProfileWindowCommandClient(
  host: DesktopProfileWindowHost,
): DesktopProfileWindowCommandClient {
  return Object.freeze({
    async openCurrentProfileWindow(
      request: OpenCurrentProfileWindowRequest = {},
    ): Promise<void> {
      // Snapshot structural input before awaiting so getters cannot swap the
      // validated values between validation and native dispatch.
      const workspaceViewId = request.workspaceViewId;
      assertOptionalId(workspaceViewId, "workspace view id");
      const context = await host.getContext();
      const connectionId = context.connectionId;
      assertId(connectionId, "connection id");
      await host.openWindow(Object.freeze({
        type: "window.open" as const,
        profileId: connectionId,
        ...(workspaceViewId === undefined ? {} : { workspaceViewId }),
      }));
    },
  });
}

function assertOptionalId(value: unknown, name: string): void {
  if (value !== undefined) assertId(value, name);
}

function assertId(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new TypeError(`${name} is invalid`);
  }
}
