# ADR-0038: App views run in an opaque-origin frame inside a self-sandboxing proxy document

Status: accepted
Date: 2026-10-04

## Context

ADR-0037 has Terminay render HTML that comes from third-party MCP servers and
from the model. That content is untrusted. The workspace UI loads in a sandboxed,
origin-bound partition (ADR-0005), and the trust-boundary model (ADR-0011) treats
renderer content as untrusted at every privileged boundary.

Where the workspace is served over HTTP it carries a content security policy with
`script-src 'self'` and no `frame-src`, so frames fall back to `default-src
'self'`. A frame the workspace creates with `srcdoc`, `blob:`, or `data:` inherits
that policy, which blocks the inline scripts every MCP App view uses: measured,
see [evidence](./evidence/mcp-apps-terminal-windows-spike.md). Loosening the
workspace policy would weaken it for the whole application. SEP-1865 requires web
hosts to place a view inside a sandbox proxy whose origin differs from the host's.

A document fetched from a URL carries its own policy. A response header
`Content-Security-Policy: sandbox` forces that document into an opaque origin
however it is opened, and the workspace's existing `default-src 'self'` already
admits a same-site URL as a frame.

## Decision

1. **Every view document runs in an opaque-origin frame** (`sandbox` without
   `allow-same-origin`) nested in a Terminay-authored proxy document.
2. **The proxy is one static document shipped in the workspace bundle** and
   framed by URL. Its origin is always opaque: the workspace frames it with a
   `sandbox` attribute, and every host that serves it over HTTP sends it with a
   `Content-Security-Policy` header carrying `sandbox`, a permissive resource
   policy that is the ceiling for any view, and `frame-ancestors 'self'`.
3. **The workspace builds each view's own content security policy** from the
   window's source and embeds it in the view document. The proxy only frames and
   relays.
4. **The workspace content security policy is unchanged.** No custom scheme, no
   second listener, and no second hostname is introduced.
5. **The proxy and the view have no authority.** They get no preload, no host
   IPC, no Terminay storage, and no protocol access. Their only channel is a
   validated message contract with the workspace.
6. **A host on which the proxy cannot be framed reports the capability
   unavailable.** The workspace proves the proxy answers before it offers app
   windows. Isolation is never weakened to make a view run.
7. **A view's frame holds only the document it was given.** A document's own
   policy cannot stop it navigating itself, which would carry data out past
   that policy and leave a foreign page speaking as the view. Once it has
   created the frame, the proxy forbids itself to load anything else in it
   (`frame-src 'none'`, added after creation so the view does not inherit
   it), and it removes a frame that loads a second document all the same.

## Consequences

- Each host that serves the bundle over HTTP must send the proxy's header. The
  Terminay Server does. The hosted session surface is a separate repository whose
  service worker redirects frame navigations under `/remote-app/`; until it serves
  the proxy with that header, sessions paired through it report app windows
  unavailable.
- Desktop loads the bundle from `file://`, where no header applies; the frame's
  `sandbox` attribute and the `file:` scheme's opaque origin provide the same
  result, and the existing navigation policy already admits a bundle file.
- Views cannot use cookies or `localStorage` (opaque origin). Apps that need
  persistence must keep it on their server.
- The MDX preview keeps its own host; this ADR does not change it. The same
  measurement shows its `srcdoc` frame cannot run script under the HTTP policy.

## Open items

- The hosted session surface must serve the proxy document with its header
  before app windows work in sessions paired through it.
- The measurement was made in Chromium. Safari and Firefox are to be checked by
  the end-to-end task of the `terminal-app-windows` change.
