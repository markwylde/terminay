# ADR-0041: A file preview that runs file-provided script uses the app-view sandbox, with resources inlined by the workspace and no network

Status: accepted
Date: 2026-10-07

## Context

The file viewer's previews have never executed file-provided script: Markdown is
sanitized, images and PDFs are decoded, text is shown as text. Rendering an HTML
file as the page it describes cannot keep that rule, because a page without its
script is usually not the page.

ADR-0038 already settled how Terminay runs untrusted HTML: an opaque-origin
frame nested in a self-sandboxing proxy document shipped in the workspace
bundle, with a content security policy the workspace embeds in the document, no
authority, and no second listener, hostname, or scheme. It was decided for app
views, whose HTML comes from MCP servers and from the model.

Electron's `<webview>` tag is disabled in every window and attachment is denied,
and the workspace bundle also runs in remote browsers (ADR-0018), where the tag
does not exist.

A project file is not more trusted than an MCP App. A repository can be cloned
from anywhere, and opening a file in it is not consent to give that file
authority over the workspace or a route off the machine.

## Decision

1. **A file preview may execute file-provided script only inside the ADR-0038
   proxy**: an opaque-origin frame with no preload, no host IPC, no protocol
   access, and no Terminay storage. Every other preview keeps executing none.
2. **No Electron webview is introduced.** `webviewTag` stays off and the same
   frame serves Desktop and remote browser clients.
3. **The frame fetches nothing.** The workspace resolves the project resources
   a document references, reads each through the existing bounded,
   server-authorized file reads, and inlines them into the document before
   handing it to the proxy. No asset route, capability URL, or resource bridge
   is added. Authorization of every path stays on the server at the read.
4. **A file preview has no network.** Its content security policy is fixed by
   the workspace, declares no origin, and cannot be widened by the document.
5. **A host on which the proxy cannot be framed has no such preview.** The
   preview is reported unavailable; isolation is never weakened to render it.
6. **A previewed document cannot act for the user except on a recorded
   gesture**, as ADR-0038 point 8 already requires of a view.

## Consequences

- HTML preview works wherever app views work, with one sandbox to audit.
- The file viewer's "no file-provided script" rule becomes "none outside this
  sandbox". Any later preview that wants to run script — a notebook, an SVG with
  script — has one sanctioned place to do it and inherits these limits.
- A previewed page is a static bundle. Anything it would request at run time —
  module imports between files, `fetch`, a CDN — does not resolve. Terminay is
  not a dev server, and this ADR is the reason.
- Inlining costs memory and a rebuild per render, so previews carry bounds on
  resource count and bytes.
- The residual gaps of ADR-0038 carry over unchanged: Chromium does not enforce
  the `webrtc` directive, and a navigation attempt may open a connection before
  the proxy removes the frame.

## Open items

- If Chromium enforces `webrtc 'block'`, or a reliable way to deny WebRTC to an
  opaque-origin frame appears, apply it to both app views and file previews.
