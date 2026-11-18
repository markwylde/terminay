## 1. Companion site: terminay.com (separate repository, ships first)

- [x] 1.1 Add a `/whats-new/` Astro collection to `../terminay.com/docs`: one entry per month (`YYYY-MM`). The layout has a hero feature, feature cards with screenshots, and grouped Improvements and Fixes. `/whats-new/` renders the latest month and `/whats-new/<YYYY-MM>/` renders a given month, with a month browser to reach earlier posts. Verify: `npm run build --prefix docs` emits both routes.
- [x] 1.2 Embed pages at `/whats-new/embed/` and `/whats-new/embed/<YYYY-MM>/`, with no site chrome, analytics or third-party requests. `?theme=light|dark` sets the colours. Link clicks post `{type:'terminay.whats-new.open-external',version:1,url}` to `parent`. The page posts `{type:'terminay.whats-new.ready',version:1}` once rendered. Verify in a Playwright test on the site that both messages are sent with exact keys.
- [ ] 1.3 Serve `/whats-new/latest.json` (`{id,title,published}`). The Bunny pull zone sends no `X-Frame-Options` or `frame-ancestors`, so framing needs no change, and `latest.json` must carry `Access-Control-Allow-Origin: *`. Verify: `curl -sI -H 'Origin: http://127.0.0.1'` on the deployed JSON shows the header, and the JSON parses.
- [x] 1.4 Write the first post for 17 Oct–17 Nov 2026 (v6.0.0–v6.3.0). Draft it from GitHub release notes and the merged Gitea PRs (`tea pr ls --state closed`). Include user-visible features, UI changes, improvements and fixes only, with no refactors, CI or stabilisation work. Screenshots come from the PR attachments and the `docs:screenshots` pipeline, saved as webp. Verify: the user has reviewed the copy and screenshots on a preview deploy.
- [ ] 1.5 Deploy to Bunny (`npm run deploy:docs`). Verify: `https://terminay.com/whats-new/embed/?theme=dark` loads in a browser and `latest.json` returns `2026-11`.

## 2. Content security policy

- [x] 2.1 In `packages/ui-bundle/src/manifest.ts`, add `frame-src 'self' https://terminay.com` and append `https://terminay.com` to `connect-src` in `DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY`. Verify: a unit test asserts the exact policy string, and `npm run test:security-boundaries` passes.
- [x] 2.2 Confirm that the existing same-origin frames still load under the new `frame-src`: app-view proxy, MDX preview and HTML preview. Verify: the `app-windows*`, `app-view-mirror` and MDX/HTML preview E2E specs pass in `npm run test:e2e`.

## 3. Home section

- [x] 3.1 Add `'whatsNew'` to `HOME_SECTIONS` after `'home'` in `src/workspace/homeSection.ts`, label it "What's New", and give it an icon from the existing sidebar icon set. Verify: `src/workspace/homeTabs.test.ts` covers the order with and without forge sections.
- [x] 3.2 Render the What's New section in `HomeWorkspace.tsx`/`HomeView.tsx` through the existing section path, so there is one tab and the section is remembered. Verify: a unit test shows that activating it twice keeps one tab.

## 4. What's New panel

- [x] 4.1 Create `src/workspace/whatsNew/WhatsNewPanel.tsx`: an iframe to `https://terminay.com/whats-new/embed/?theme=<appearance>` with `sandbox="allow-scripts allow-same-origin"`, `referrerPolicy="no-referrer"`, and no `allow` delegation. The theme comes from the workspace's resolved appearance, and the frame reloads when it changes. Verify: a model test asserts the URL built for each appearance.
- [x] 4.2 In `src/workspace/whatsNew/whatsNewModel.ts`, a pure validator for `ready` and `open-external`. It checks the exact source window, the exact origin `https://terminay.com`, the exact key set and version, and that the URL is `https:` with no credentials. Valid `open-external` calls `openExternalUrl`. Verify: `whatsNewModel.test.ts` covers the wrong origin, wrong source, extra keys, `file:`/`javascript:`/`http:` URLs, credentials in the URL, and the valid case.
- [x] 4.3 Offline state: show the notice right away when `navigator.onLine` is false, and after 15 s if `ready` has not arrived. The notice has Retry, which resets the timer and reloads the frame, and Open in browser, which calls `openExternalUrl` on the non-embed URL. Verify: a component or model test with fake timers covers the timeout, an early `ready`, and Retry.
- [x] 4.4 Style the panel: the frame fills the tab, the background matches the theme while loading, and the notice uses the existing empty-state styling. Verify: a visual check in the Desktop E2E screenshot (task 6.1).

## 5. Unread cue

- [x] 5.1 Add `lastViewedWhatsNewId` read/write to `src/workspace/localViewState.ts` with the same try/catch guarding as the Home section memory. Verify: `scripts/local-view-state.test.mjs` covers round-trip and unavailable storage.
- [x] 5.2 Create `src/workspace/whatsNew/latestWhatsNew.ts`. It fetches `latest.json` with `cache:'no-store'`, `credentials:'omit'` and `referrerPolicy:'no-referrer'`, and validates `id` against `/^\d{4}-\d{2}$/`. It runs on workspace start and when Home is selected, and skips if the last fetch was under an hour ago. There is no interval timer (ADR-0028). Any failure keeps the previous state silently. Verify: a unit test with an injected fetch and clock covers the throttle, a bad payload, a network error, and that no timer is scheduled.
- [x] 5.3 Show an unread dot on the What's New sidebar item, and on the compact section list where Home sections appear, when the announced id differs from `lastViewedWhatsNewId`. Add "new post" to the accessible name. Opening the section stores the announced id. Verify: a unit test of the unread derivation, plus the E2E in 6.1.

## 6. End-to-end and specs

- [x] 6.1 Add `e2e/whats-new.spec.ts`, run through `npm run test:e2e`. It routes `https://terminay.com/whats-new/**` to a local fixture that sends `ready` and `open-external`, and `latest.json` to a fixture id. The test checks: the sidebar order, the dot then cleared, the frame loaded with the right query and no referrer, link messages reaching the external-open host action, foreign-origin messages ignored, and the offline notice with a working Retry when the route fails. Verify: the spec passes in the container.
- [x] 6.2 Run `openspec validate --all` and `npm run lint`, plus the typecheck for the touched workspaces. Verify: all clean.
- [x] 6.3 Open the PR on Gitea (`tea`). Verify: every commit status on the head SHA reads back as `success` or `skipped`.
