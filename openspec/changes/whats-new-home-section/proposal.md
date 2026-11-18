## Why

Terminay ships several releases a month, but users only see what changed if they read GitHub release notes written for developers. Features land unnoticed: bot threads, workflow graphs, phone layouts, forge items in tabs. Users need one place in the app that shows, in plain language and with screenshots, what got better for them each month, and lets them look back at earlier months.

Monthly posts are written and published on a schedule separate from app releases, so they need to live where they can be published without shipping a new build: terminay.com.

## What Changes

- Add a **What's New** section to the Home sidebar, second in the list, between **Home** and **Tabs**. Like every other section, it opens as a Home tab and is never open twice.
- The section embeds the What's New page from terminay.com, shown in its chrome-less embed mode. The page opens on the latest monthly post and has its own way to browse earlier months.
- The embedded page matches the workspace's light or dark appearance and runs in a sandbox with no access to the workspace. The workspace sends it nothing about the user's workspace.
- Links in the post open in the user's browser, not inside the workspace.
- When the page cannot be reached, the section shows an offline notice with a Retry button instead of a broken frame.
- The What's New sidebar item shows an unread dot when terminay.com announces a post newer than the last one this device has opened. The dot clears when the section is opened.
- The UI bundle's content security policy lets the workspace frame the What's New page and read its small "latest post" announcement from terminay.com. No other origin is allowed.
- The Home sidebar requirement is restated to list every section the workspace actually offers. That includes Pull Requests and Issues, which are shown only where a forge source serves them.

Companion work outside this repository: terminay.com gets a `/whats-new/` collection with one post per month, an embed mode, a month browser, and a `latest.json` announcement. The first post covers 17 October to 17 November 2026.

## Capabilities

### New Capabilities

- `whats-new`: the What's New Home section, the embedded monthly post from terminay.com, its sandbox and data boundary, opening links externally, the offline state, and the unread cue.

### Modified Capabilities

- `workspace-dashboard`: the Home sidebar sections requirement adds What's New, second in the list, and lists Pull Requests and Issues as the conditional sections they already are.

## Impact

- `src/workspace/homeSection.ts`, `HomeWorkspace.tsx`, and `HomeView.tsx`: the new section, its label and icon, and the unread dot on the sidebar item.
- A new What's New panel in `src/workspace/`: the iframe, a message bridge for opening links, and the offline state.
- `src/workspace/localViewState.ts`: device-local "last viewed post" state.
- `packages/ui-bundle/src/manifest.ts`: `DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY` gains `frame-src https://terminay.com` and `connect-src https://terminay.com`. This applies to Desktop and browser hosts alike.
- No server, protocol, persistence, or Electron main-process changes. Opening links reuses the existing `openExternalUrl` host action.
- terminay.com (separate repository): the Astro pages, embed mode, `latest.json`, and the first monthly post with screenshots.
