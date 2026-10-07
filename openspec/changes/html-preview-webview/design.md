## Context

A file panel shows an HTML file's source twice: once in Text and once, highlighted,
in Preview. `classifyPreview` in `packages/server-core/src/fileService/catalog.ts`
has no HTML kind — `.html` and `.htm` map to `text/html` and fall through to the
`text` preview kind, and `.xhtml` is absent from the MIME table. `PreviewViewer`
renders `text` as a `<pre>`.

Three things already in the repository shape the answer:

- Electron's `<webview>` tag is off in every window (`webviewTag: false`) and
  `will-attach-webview` is denied in `electron/main.ts` and
  `electron/serverUiHost.ts`. The workspace is one bundle that also runs in a
  remote browser, where no such tag exists.
- App views (ADR-0037, ADR-0038) already render untrusted HTML: the workspace
  frames `public/app-view.html` with `sandbox="allow-scripts allow-forms"`, the
  proxy creates an inner `srcdoc` frame, and the workspace embeds a content
  security policy in the document it hands over (`viewDocument.ts`). The proxy
  is probed before use (`appViewAvailability.ts`).
- The file-viewer spec says previews never execute file-provided script, and
  ADR-0011 treats renderer content as untrusted at every privileged boundary.

Decisions taken with the owner before design
(`questionnaires/scope.yaml`): the "webview" is the ADR-0038 sandboxed frame,
not an Electron webview; the page's script runs; the page loads project files by
relative path and has no network; Preview follows the live draft; HTML opens in
Preview.

## Goals / Non-Goals

**Goals:**

- Preview of `.html`, `.htm`, and `.xhtml` renders the page, identically on
  Desktop and remote browser clients.
- Page script runs with no Terminay authority and no network.
- Relative stylesheets, scripts, images, fonts, and media from the project load.
- Preview tracks the draft without a save.
- No new listener, hostname, custom scheme, or protocol method.

**Non-Goals:**

- A browser. No address bar, history, back/forward, devtools, or navigation
  between pages; a link to another project page does not load it.
- A dev server. ES module graphs (`import './x.js'` between files), bare
  specifiers, `fetch()` of project files, and service workers do not resolve.
- External resources. A page that depends on a CDN renders without it.
- XML parsing of `.xhtml`. It is parsed as HTML.
- Live reload when a referenced resource changes on disk.
- Editing in Preview.

## Decisions

### 1. Render in the ADR-0038 proxy, not an Electron webview

The preview is an opaque-origin `srcdoc` frame inside `app-view.html`, framed by
the workspace with the existing `APP_VIEW_SANDBOX`. This crosses the
renderer-content trust boundary (ADR-0011) in exactly the way app views already
do, and adds no new crossing.

Alternatives: an Electron `<webview>` or `WebContentsView` gives a real browsing
context with navigation, but is Desktop-only, needs a second implementation for
remote clients, and reverses a posture enforced in five places. A `srcdoc` frame
created directly by the workspace inherits the workspace's `script-src 'self'`
and cannot run inline script (measured for ADR-0038). Both rejected.

`AppWindowHost.tsx` and `AppWindowMirror.tsx` each drive a proxy frame already,
each with its own short lifecycle (mount, wait for `sandbox-proxy-ready`, send
`sandbox-resource-ready`, listen) wound into what that caller does with the
view. `HtmlPreview` is a third caller of the same shape. What the three share —
the proxy URL, the sandbox attribute, the probe, the message names, and the
document builder — lives in `appViewAvailability.ts` and `viewDocument.ts`, and
the message names are exported from there for the new caller. The two existing
callers are not rewritten: they are working, security-relevant code, and a
shared lifecycle component would have to carry the bridge, the mirror, and the
recorder to serve them.

### 2. The workspace inlines project resources; the frame fetches nothing

An opaque-origin frame has no credentials and no channel to the server, and
ADR-0038 forbids a second listener or scheme. So the workspace resolves
resources before handing the document over:

1. Scan the draft's start tags with a small tokenizer that skips comments and
   the text of `script`, `style`, and similar elements. Nothing is parsed into a
   tree and nothing runs. A tokenizer rather than `DOMParser` because the unit
   tests run under Node with no DOM, and because the source text is edited in
   place, so markup the scanner does not touch reaches the frame exactly as
   written. The scanner is not a boundary: a reference it misses does not load.
2. Collect references from `link[rel~=stylesheet|icon][href]`, `script[src]`,
   `img[src|srcset]`, `source[src|srcset]`, `video|audio[src|poster]`, and
   `url()` / `@import` inside inline `<style>` and fetched stylesheets
   (`@import` depth bounded).
3. Keep only relative and root-relative references. Relative resolves against
   the file's project-relative folder, root-relative against the project root.
   Anything with a scheme or a `//` prefix is left untouched, and the policy in
   decision 3 stops it loading.
4. Read each through the existing bounded file reads of the file gateway, using
   the panel's project identity. The server canonicalizes and authorizes each
   path at the read (ADR-0020); client-side path normalisation is a convenience,
   never the authority. This is the filesystem-authorization boundary and it
   stays on the server.
5. Rewrite each reference to a `data:` URL with a MIME type from a fixed
   extension table. A script stays a `src`, so its text cannot close its own
   element; a stylesheet's text is rewritten first, then carried the same way.
6. Serialize, prepend the policy, send to the proxy.

Bounds: at most 200 resources and 16 MB of resource bytes per render, 4 MB per
resource, `@import` depth 4, reads limited to a small concurrency. Past a bound,
remaining references are left unresolved and the panel shows "Some resources
were not loaded". A failed or refused read leaves that one reference unresolved.

Fetched resources are cached for as long as the Preview is mounted, so a
keystroke re-render re-reads nothing. Leaving and re-entering Preview drops the
cache, which is how a changed stylesheet is picked up.

Alternatives: a server HTTP route for preview assets needs an authenticated URL
an opaque origin can use, i.e. a capability token in a URL plus a wider
`resource` policy — a new exposure surface for remote access. A `postMessage`
resource bridge cannot satisfy `<link>` or `<img>` loads without a service
worker, which an opaque origin cannot register. Both rejected.

### 3. A `file` view source with a no-network policy

`viewDocument.ts` gains a `file` source kind whose policy is fixed, declares no
origins, and cannot be widened by the document:

```
default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:;
img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none';
frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; webrtc 'block'
```

`<base>` and `<meta http-equiv="Content-Security-Policy|refresh">` in the source
are removed while building, so the page can neither re-root its references nor
navigate by meta refresh. The frame's `allow` attribute is empty: no camera,
microphone, geolocation, or clipboard.

### 4. The server publishes an `html` preview kind

`classifyPreview` returns `html` for the three extensions when the content is
valid text, adds `xhtml` to the MIME table, counts `html` as a safe preview
within `maxPreviewBytes`, and prefers Preview for it. Classification stays on
the server that owns the project (ADR-0017). `FilePreviewKind` and
`FileCatalogPreviewKind` gain `html`; no protocol method is added.

The kind is published only to a client that asks for it. A workspace bundle
validates `previewKind` against the set it knows and rejects the whole snapshot
otherwise, so a bundle older than this change, driving a newer server
(ADR-0018), would fail to open any HTML file. The capability request therefore
carries `options.acceptPreviewKinds: ['html']`, and a request without it is
answered as before: `text`, opening in Text. This is a per-request declaration
rather than a negotiated protocol version because the request already carries a
free-form options record that older servers ignore, so neither side needs a
version bump to stay compatible with the other.

The client does not upgrade a file to HTML preview from its extension when the
server has published a classification. A server that predates this change
publishes `text`, and the file keeps its highlighted-source preview.
`detectPreviewKind`, used only when no server capabilities are present, gains
the same three extensions for consistency.

`resolveViewModes` lists Preview before Text for the `html` kind, as it does for
Markdown, and `defaultMode` follows the server's `preferredMode`.

### 5. Draft-driven re-render by replacing the proxy frame

`HtmlPreview` takes the same `text` prop `MarkdownPreview` does, which is the
draft. A change schedules a rebuild after 300 ms; the rebuilt document is shown
by mounting a fresh proxy frame and removing the old one once the new one
reports ready. The proxy's rule that a frame holds only the document it was
given (ADR-0038 point 7) is kept intact rather than taught to accept a second
document. Scroll position is not preserved across a re-render.

### 6. Links leave through the workspace, on a gesture

The built document carries a short Terminay-authored script that intercepts
anchor activation and posts an open-link request to the proxy instead of
navigating. The workspace honours it only for a credential-free `http:` or
`https:` URL and only when the proxy reports user activation in the view
(ADR-0038 point 8), then uses the normal external-link policy. The script is in
the page and the page can tamper with it; the workspace's validation is the
authority, the script is a convenience. Any navigation that slips past it is
caught by the proxy removing the frame, and the panel then shows "The page
navigated away" with a Reload action.

### 7. Unavailable proxy means no HTML preview

`HtmlPreview` awaits the existing probe result. Where the proxy cannot be
framed, the Preview tab stays in the switcher, disabled, with the reason, and
the file opens in Text — the existing fallback path for an unavailable view.

## Risks / Trade-offs

- [The security contract is loosened: file-provided script now runs] → Confined
  to an opaque origin with no preload, IPC, storage, or protocol access, the
  same boundary ADR-0038 accepted for third-party MCP App HTML. Recorded as
  ADR-0042 and as a modified `File security boundaries` requirement.
- [Chromium does not enforce the `webrtc 'block'` directive (measured for
  ADR-0038), so page script could reach a peer over WebRTC] → Same known gap as
  app views; stated here and in ADR-0042 rather than hidden. The spec requires
  the policy to ask for the block, not that the browser honours it.
- [A navigation attempt may open a connection before the frame is removed
  (ADR-0038 point 7), which can carry data in a URL] → Meta refresh and `<base>`
  are stripped and anchors intercepted; script-driven `location` changes remain
  a residual exfiltration path for content the page already holds, which is
  project content the user chose to render.
- [Pages built for a dev server look broken: module graphs, `fetch`, CDN assets]
  → Non-goal. The "Some resources were not loaded" notice says why.
- [`.xhtml` is parsed as HTML, so XML-only constructs render differently] →
  Accepted; well-formed XHTML served as HTML is the common case.
- [Inlining a large page costs memory: base64 inflates bytes by a third and the
  document is rebuilt per edit] → Per-render bounds, the per-mount cache, and
  the debounce.
- [Keyboard focus inside the frame swallows workspace shortcuts] → Same as app
  views; focus taken without a gesture is returned (ADR-0038 point 8).
- [`file-viewer-view-profiles` is unarchived and also defines the default view
  by file type] → This change adds its own requirement for HTML rather than
  modifying one that is not yet in the main spec. Whichever archives second
  reconciles the wording.
- [A newer server publishing `html` to an older workspace bundle (ADR-0018 lets
  one bundle drive many servers)] → The older bundle rejects a snapshot whose
  preview kind it does not know. The server names `html` only to a client that
  asks for it (decision 4).
- [Any click in the page lets its script open one web link, and a URL can carry
  data] → The request passes the proxy's gesture check, the workspace's own
  activation check, a credential-free `http`/`https` check, and a one-per-second
  limit, and it opens visibly in the user's browser. It remains a way for a
  hostile page to send out what it holds, once per click. Same exposure as app
  views.

## Migration Plan

No data migration. Rollback is reverting the change: the server stops publishing
`html` and files return to the `text` preview kind.

## Open Questions

- None blocking. No in-force ADR needs revisiting: ADR-0038 is extended to a new
  caller, not altered, and the extension is recorded as a new ADR.
