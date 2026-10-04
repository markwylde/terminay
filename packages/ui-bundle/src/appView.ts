/**
 * The sandbox proxy document for app windows (ADR-0038).
 *
 * It is one static asset of the workspace bundle. A host that serves the bundle
 * over HTTP sends it with `APP_VIEW_PROXY_CONTENT_SECURITY_POLICY` in place of
 * the workspace policy, so the proxy is an opaque-origin document however it is
 * opened and may be framed only by the workspace that shipped it.
 */

/** File name of the proxy within a bundle. */
export const APP_VIEW_PROXY_ASSET_NAME = "app-view.html";

/**
 * `sandbox` forces the opaque origin. The resource directives are the ceiling
 * for any view the proxy frames: a nested `srcdoc` view inherits them, and the
 * workspace narrows each view further with a policy of its own.
 */
export const APP_VIEW_PROXY_CONTENT_SECURITY_POLICY =
  "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline' https: blob:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src https: wss:; frame-src https: blob: data:; worker-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/** Whether a bundle asset path is the proxy document. */
export function isAppViewProxyAssetPath(assetPath: string): boolean {
  return /^\/remote-app\/[^/]+\/app-view\.html$/u.test(assetPath);
}
