## Context

Home's sidebar is a fixed, ordered list of sections in `src/workspace/homeSection.ts` (`HOME_SECTIONS`, `HOME_SECTION_LABELS`, `visibleHomeSections`). `HomeWorkspace.tsx` renders each section as a Home tab and delegates most sections to `home.renderSection`. Device-local Home presentation state is kept in `src/workspace/localViewState.ts` using guarded `localStorage`.

The workspace UI is served by the Terminay server and runs in sandboxed, origin-bound hosts on Desktop and in browsers (ADR-0005). Its HTTP responses carry `DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY` (`packages/ui-bundle/src/manifest.ts`):

```
default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
connect-src 'self' wss:; script-src 'self'; object-src 'none'; base-uri 'none';
form-action 'self'; frame-ancestors 'none'
```

With no `frame-src`, frames fall back to `default-src 'self'`. Today the workspace can neither frame terminay.com nor fetch from it. The Desktop workspace window denies every `window.open` (`securePrimaryWindow` in `electron/main.ts`), so a `target=_blank` link inside a frame goes nowhere. External links already go through `openExternalUrl` (`src/host/nativeActions.ts`): it uses the Desktop bridge where one exists and `window.open` in a browser.

terminay.com is an Astro site deployed to Bunny CDN from the sibling `terminay.com` repository. It already has a docs-screenshot pipeline that drives a checkout of this repository.

The user chose to host posts on terminay.com, so they publish independently of app releases. They also chose to embed the page rather than render a feed natively.

## Goals / Non-Goals

**Goals:**
- Add a What's New Home section, second in the sidebar, that shows the latest monthly post and lets users browse earlier ones.
- Publish posts on terminay.com without an app release.
- Keep the workspace's security posture: one new origin, sandboxed, and no workspace data leaving the device.
- Show a quiet unread cue when a new month's post appears.

**Non-Goals:**
- Rendering posts natively or caching them for offline reading.
- Authoring tooling inside Terminay. Posts are written in the terminay.com repository.
- Opening What's New automatically after an update.
- Syncing "viewed" state across devices.
- Per-release, as opposed to monthly, notes. GitHub releases stay as they are.

## Decisions

### 1. Section placement and identity

Add `'whatsNew'` to `HOME_SECTIONS` directly after `'home'`, with the label "What's New" and a sparkle/gift-style icon from the icon set the sidebar already uses. It goes through the existing section machinery: one tab per section, remembered section, keyboard reachability. It is always visible and never hidden like the forge sections.

*Alternative:* put it in the overview's "Home" content. Rejected because the user asked for a sidebar section, and sections already provide tab identity and memory.

### 2. Embed a sandboxed iframe rather than render a feed natively

The panel renders:

```
<iframe src="https://terminay.com/whats-new/embed/?theme=dark"
        sandbox="allow-scripts allow-same-origin"
        referrerpolicy="no-referrer"
        allow="" loading="eager">
```

- `allow-same-origin` here means terminay.com's own origin, not the workspace's. The frame is cross-origin to the workspace, so it still cannot touch the workspace DOM or storage. terminay.com needs its own origin for normal site scripts, such as the month picker.
- Omitting `allow-top-navigation*`, `allow-popups`, `allow-forms` and `allow-modals` means the page cannot navigate the workspace or open windows directly.
- The URL carries only the embed path and `theme=light|dark`, with no referrer. This keeps hosted services data-blind. The embed is its own path, not a query flag, because the public site loads analytics and web fonts. A static page cannot leave those out based on a query string, and the framed page must make no third-party requests.

*Boundary crossed:* the workspace content security policy, and therefore the renderer trust boundary. This is the first hosted, non-workspace origin admitted into the workspace UI. See ADR-0136.

*Alternatives:* a native JSON-feed renderer gives better theming and offline reading, but the user chose the embed. An ADR-0038-style opaque proxy is meant for untrusted local HTML. It adds nothing for a fixed, first-party HTTPS origin and would still need `frame-src`.

### 3. CSP: allow exactly `https://terminay.com`

Change the default UI-bundle policy to add `frame-src 'self' https://terminay.com` and `connect-src 'self' wss: https://terminay.com`. Keep `'self'` in `frame-src`, because adding a `frame-src` directive stops the fallback to `default-src`, and existing same-origin frames (app-view proxy, MDX preview, HTML preview) must keep working. The policy names the origin exactly, with no subdomain wildcards.

### 4. Links open via a closed `postMessage` bridge

In embed mode, the site intercepts link activation and posts `{ type: 'terminay.whats-new.open-external', version: 1, url }` to `parent`. The panel accepts the message only when all of the following hold:

- `event.source` is the panel's own iframe `contentWindow`;
- `event.origin === 'https://terminay.com'`;
- the object has exactly those keys;
- `url` parses as an `https:` URL without username or password.

It then calls `openExternalUrl(url)`. Everything else is dropped silently.

Browser user activation propagates to ancestor frames, so a browser host's `window.open` inside `openExternalUrl` is still allowed. Desktop goes through the bridge and does not need activation.

*Alternative:* `allow-popups` with a Desktop window-open handler that recognises the frame. Rejected because it needs Electron main-process changes and a second code path per host.

### 5. Appearance via query parameter

The workspace, Home included, is drawn dark whatever the system prefers. Only a few modal surfaces follow `prefers-color-scheme`. So the panel always asks for `theme=dark`. Following the system put a white page inside the dark workspace in the first E2E screenshots. The site still supports `theme=light` for the day the workspace gains a light appearance; the panel would then pass that through `theme=` and reload.

### 6. Offline and failure state

The panel starts a 15-second timer when it sets `src`. If `navigator.onLine` is false, it shows the notice straight away.

A cross-origin iframe's `load` event fires even for error pages, so success is defined by a handshake: the embed page posts `{ type: 'terminay.whats-new.ready', version: 1 }` once it renders, validated the same way as decision 4. If the handshake has not arrived when the timer ends, the panel replaces the frame with the notice ("Couldn't load What's New", Retry, Open in browser). Retry resets the timer and reloads the frame.

### 7. Unread cue from `latest.json`

`https://terminay.com/whats-new/latest.json` returns `{ "id": "2026-11", "title": "...", "published": "2026-11-17" }`. Only `id` matters, and it must match `/^\d{4}-\d{2}$/`.

The renderer fetches it with `cache: 'no-store'`, `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`. To follow ADR-0028 there is no timer. The renderer fetches on demand, when the workspace starts and when the user selects Home. Any fetch within an hour of the last successful read is skipped, and that time is kept in memory. A failed read does not start the hour, so a window that started offline, or before the site served the file, tries again the next time Home is selected. This is a throttle on user-driven events, not a poll. A session that stays outside Home sees a new post the next time Home is selected. A small hook exposes `hasUnread`, which the sidebar renders as a dot and adds to the item's accessible name.

Opening the What's New section stores the announced `id` as `lastViewedWhatsNewId` in `localViewState.ts`. Storage failures behave like the existing Home section memory: no error, and the dot simply comes back next time.

*Boundary:* this is device presentation state only. It is not server-scoped, not synced, and nothing goes to the server.

*Alternative:* have the server fetch `latest.json`. Rejected because it would give the server an outbound dependency on terminay.com just for UI chrome, and browser and phone clients render the same bundle anyway.

### 8. Companion site contract (terminay.com repository)

These are delivered in the terminay.com repository. The app depends only on this contract:

- `/whats-new/` shows the latest post. `/whats-new/<YYYY-MM>/` shows a given month.
- `/whats-new/embed/` and `/whats-new/embed/<YYYY-MM>/` render the same posts without site header, footer, analytics or web fonts, match the requested theme, and send the ready and open-external messages from decisions 4 and 6.
- `?theme=light|dark` is honoured in embed mode.
- `/whats-new/latest.json` follows the shape in decision 7.
- The embed pages send `Content-Security-Policy: frame-ancestors *`, or a list that covers every Terminay host origin, because the workspace's origin varies (local server port, `*.terminay.com` session origins). They must not send `X-Frame-Options`.
- Posts are user-facing only: features, UI changes, improvements and fixes. Each has a hero and feature cards with screenshots, then grouped improvements and fixes, and a month browser. The first issue covers 17 Oct to 17 Nov 2026 (v6.0.0 to v6.3.0, about 80 merged PRs). It is drafted from GitHub release notes and Gitea PRs, using PR screenshots and the `docs:screenshots` pipeline.

## Risks / Trade-offs

- [The page is unavailable offline] → The notice offers Retry and Open in browser. Native caching is a non-goal by the user's choice.
- [A compromised terminay.com could show misleading content inside the app] → It cannot reach the workspace (cross-origin sandbox, no top navigation, no popups). The only thing it can ask for is opening `https` URLs externally, and the user still sees the browser open. This is accepted and recorded in ADR-0136.
- [Electron's server-UI host might block cross-origin subframe navigation] → An E2E test loads the section in the Desktop container suite. If it is blocked, the host's subframe policy gets a narrow allowance for `https://terminay.com`, recorded in the same ADR.
- [Adding `frame-src` stops the `default-src` fallback and could break existing same-origin frames] → Keep `'self'` in `frame-src`, and cover it with the existing app-view, MDX and HTML preview E2E suites.
- [The app ships before the site serves `/whats-new/`] → The offline notice covers it. Deploy the site first (see the migration plan).
- [Fetching `latest.json` tells terminay.com/Bunny that a Terminay client is running, including its IP] → No cookies, referrer or identifiers are sent. It is the same exposure as visiting the website, and it happens only on start or on selecting Home, at most once an hour.

## Migration Plan

1. Ship the terminay.com `/whats-new/` pages, embed mode and `latest.json` with the first post, and deploy them to Bunny.
2. Merge and release this change.
3. Rollback: revert the app change. The section disappears, and the CSP returns to `'self'` only. The site pages can stay as public web pages.

## Open Questions

- None blocking. The icon choice and the exact notice copy are left to implementation, within the existing icon set and copy style.
