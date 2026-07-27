/** A bounded response used by the host to load the selected server bundle.
 * Electron/webContents integration can adapt its request primitive to this
 * interface without giving the renderer a general network client. */
export interface DesktopBundleResponse {
  readonly status: number;
  readonly contentType?: string;
  readonly bytes: Uint8Array;
}

export type DesktopBundleFetcher = (url: string) => Promise<DesktopBundleResponse>;

export interface SelectedDesktopConnection {
  readonly connectionId: string;
  readonly origin: string;
}

export interface DesktopBundleResource extends DesktopBundleResponse {
  readonly connectionId: string;
  readonly origin: string;
  readonly url: string;
}

export type DesktopHostShellEvent = "navigation" | "new-window" | "download" | "permission" | "protocol";

export interface DesktopHostShellRequest {
  readonly event: DesktopHostShellEvent;
  readonly connectionId: string;
  readonly url: string;
  readonly permission?: string;
  readonly userGesture?: boolean;
}

export interface DesktopHostShellDecision {
  readonly action: "allow" | "deny";
  readonly reason: string;
}

export interface DesktopHostShellPolicyOptions {
  /** Explicit privileged-host overrides. Renderer code cannot supply these. */
  readonly allowNewWindow?: (request: DesktopHostShellRequest) => boolean;
  readonly allowDownload?: (request: DesktopHostShellRequest) => boolean;
  readonly allowPermission?: (request: DesktopHostShellRequest) => boolean;
  readonly allowProtocol?: (request: DesktopHostShellRequest) => boolean;
}

/**
 * Host-only policy for a server-bundled UI. The selected connection is the
 * only origin allowed to navigate or provide the bundle. New windows,
 * downloads, permissions, and non-HTTP protocols are denied unless an
 * explicit privileged callback opts in to that one request.
 */
export class DesktopHostShellPolicy {
  private selectedValue: SelectedDesktopConnection | undefined;
  private readonly options: DesktopHostShellPolicyOptions;

  constructor(options: DesktopHostShellPolicyOptions = {}) {
    this.options = Object.freeze({ ...options });
  }

  get selectedConnection(): SelectedDesktopConnection | undefined {
    return this.selectedValue;
  }

  selectConnection(connection: SelectedDesktopConnection): SelectedDesktopConnection {
    const normalized = normalizeSelectedConnection(connection);
    this.selectedValue = Object.freeze(normalized);
    return this.selectedValue;
  }

  clearConnection(connectionId: string): void {
    if (this.selectedValue?.connectionId === connectionId) this.selectedValue = undefined;
  }

  bundleUrl(assetPath = "/manifest.json"): string {
    const selected = this.requireSelected();
    return bundleUrl(selected.origin, assetPath);
  }

  async loadSelectedBundle(fetcher: DesktopBundleFetcher, assetPath = "/manifest.json"): Promise<DesktopBundleResource> {
    if (typeof fetcher !== "function") throw new TypeError("bundle fetcher is required");
    const selected = this.requireSelected();
    const url = bundleUrl(selected.origin, assetPath);
    const response = await fetcher(url);
    if (!Number.isSafeInteger(response.status) || response.status < 200 || response.status > 299) throw new Error(`selected server bundle request failed: ${response.status}`);
    if (!(response.bytes instanceof Uint8Array)) throw new TypeError("selected server bundle response is invalid");
    return Object.freeze({ ...response, bytes: new Uint8Array(response.bytes), connectionId: selected.connectionId, origin: selected.origin, url });
  }

  evaluate(request: DesktopHostShellRequest): DesktopHostShellDecision {
    const selected = this.selectedValue;
    if (selected === undefined) return deny("no connection is selected");
    if (request.connectionId !== selected.connectionId) return deny("request is outside the selected connection");
    const parsed = parseSafeUrl(request.url);
    if (parsed === undefined) return deny("URL is invalid or contains credentials/query state");

    switch (request.event) {
      case "navigation":
        return parsed.origin === selected.origin && (parsed.protocol === "http:" || parsed.protocol === "https:")
          ? allow("same-origin server bundle navigation")
          : deny("navigation is outside the selected server origin");
      case "new-window":
        return explicitDecision(this.options.allowNewWindow, request, "new window is not explicitly allowed");
      case "download":
        return explicitDecision(this.options.allowDownload, request, "downloads are not explicitly allowed");
      case "permission":
        return explicitDecision(this.options.allowPermission, request, "permissions are not explicitly allowed");
      case "protocol":
        if (parsed.protocol === "http:" || parsed.protocol === "https:") return deny("protocol handling is limited to navigation");
        return explicitDecision(this.options.allowProtocol, request, "protocol handlers are not explicitly allowed");
    }
  }

  private requireSelected(): SelectedDesktopConnection {
    if (this.selectedValue === undefined) throw new Error("no connection is selected");
    return this.selectedValue;
  }
}

export function normalizeSelectedConnection(connection: SelectedDesktopConnection): SelectedDesktopConnection {
  if (typeof connection !== "object" || connection === null || typeof connection.connectionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(connection.connectionId)) throw new TypeError("selected connection id is invalid");
  const parsed = new URL(connection.origin);
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new TypeError("selected connection origin is invalid");
  if (parsed.protocol === "http:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "[::1]") throw new TypeError("HTTP selected connection must be loopback");
  return { connectionId: connection.connectionId, origin: parsed.origin };
}

function bundleUrl(origin: string, assetPath: string): string {
  if (typeof assetPath !== "string" || assetPath.length === 0 || assetPath.length > 4096 || !assetPath.startsWith("/") || assetPath.startsWith("//") || assetPath.includes("\\") || assetPath.includes("\0")) throw new TypeError("bundle asset path is invalid");
  if (/(^|\/)(?:\.{1,2}|%2e%2e?)(?:\/|$)/iu.test(assetPath)) throw new TypeError("bundle asset path is invalid");
  const selected = new URL(origin);
  const parsed = new URL(assetPath, selected);
  if (parsed.origin !== selected.origin || parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError("bundle asset path is invalid");
  return parsed.href;
}

function parseSafeUrl(rawUrl: string): URL | undefined {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 16_384) return undefined;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function explicitDecision(callback: ((request: DesktopHostShellRequest) => boolean) | undefined, request: DesktopHostShellRequest, reason: string): DesktopHostShellDecision {
  return callback?.(request) === true ? allow("explicit privileged host approval") : deny(reason);
}

function allow(reason: string): DesktopHostShellDecision { return Object.freeze({ action: "allow", reason }); }
function deny(reason: string): DesktopHostShellDecision { return Object.freeze({ action: "deny", reason }); }
