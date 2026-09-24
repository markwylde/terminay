## 1. Document

- [x] 1.1 Add `electron/aboutWindowDocument.ts`: the script-free About document, the link list, and `aboutWindowExternalUrl(url)`, which returns a URL only if it is one of those links. Verified by `scripts/about-window-document.test.mjs`.

## 2. Window

- [x] 2.1 Open a single sandboxed About window from `electron/main.ts`. macOS uses the application menu's About item; Windows and Linux use a Help menu item. Allowlisted links open externally and all other navigation is blocked. Verified by `npx tsc --noEmit -p .` and `npx biome lint`.

## 3. Validation

- [x] 3.1 `openspec validate --all` passes.
- [ ] 3.2 Gitea PR CI statuses all `success` or `skipped`.
