# ADR-0136: The workspace admits terminay.com as its only hosted content origin, in a sandboxed frame with a closed message bridge

Status: accepted
Date: 2026-11-17

## Context

Users need a monthly What's New post inside Terminay. The post is published on terminay.com, so it can ship separately from app releases. The repository owner chose to embed the site's page rather than render a feed natively.

Until now the workspace UI's content security policy (`DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY`) admitted no origin but its own. Frames fell back to `default-src 'self'` and `connect-src` allowed `'self' wss:`. ADR-0038 avoided loosening that policy for untrusted HTML by using a same-origin proxy. ADR-0005 and ADR-0011 treat renderer content as untrusted at every privileged boundary. The architecture also requires hosted services to stay data-blind.

Embedding terminay.com is the first time a hosted, non-workspace origin enters the workspace UI. That is a lasting boundary decision for every host, Desktop and browser alike.

## Decision

1. **One named origin.** The UI-bundle policy adds `https://terminay.com`, exactly, with no wildcards, to `frame-src` (alongside `'self'`) and to `connect-src`. It adds no other hosted origin. A future hosted origin needs a new ADR.
2. **Sandboxed, cross-origin frame.** The page is framed with `sandbox="allow-scripts allow-same-origin"` and `referrerpolicy="no-referrer"`. It gets no top navigation, popups, forms, modals, or permission delegation, and it cannot reach the workspace DOM, storage, or host bridge.
3. **Data-blind requests.** Requests to terminay.com carry only the embed page's address (`/whats-new/embed/`) and a theme. The embed page itself makes no third-party requests: no analytics, no web fonts. They carry no referrer, credentials, or project, terminal, server, device, or user identity. The `latest.json` read uses `credentials: 'omit'`.
4. **Closed message bridge.** The frame can send only two versioned, schema-exact messages: `ready` and `open-external`. The workspace accepts one only if it comes from that frame's `contentWindow` with origin `https://terminay.com`. `open-external` is honoured only for a credential-free `https:` URL, and only through the existing external-link host action.
5. **Desktop subframe allowance.** The Desktop server-UI host blocks every navigation that leaves the server. It lets a subframe, and never the main frame, load `https://terminay.com/whats-new/embed/` and the pages under it, and nothing else.
6. **Presentation only.** Whether a post has been viewed is device-local presentation state (ADR-0040). The server neither fetches nor stores What's New content.

## Consequences

- If terminay.com is compromised, it can show misleading content in the What's New tab and ask to open `https` URLs in the user's browser. It cannot touch terminals, projects, files, settings, or credentials.
- terminay.com sees an IP address and a theme when a user opens What's New or Home. It sees the same when someone visits the website.
- The What's New section needs the network. Offline users get a notice with Retry and Open in browser, not cached content.
- Adding `frame-src` ends the `default-src` fallback for frames, so the directive must keep `'self'` for the app-view proxy, MDX, and HTML previews.
- terminay.com's embed pages must allow framing by every Terminay host origin (`frame-ancestors`) and must not send `X-Frame-Options`.
