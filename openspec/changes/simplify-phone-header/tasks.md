## 1. Renderer

- [x] 1.1 `CompactChromeRow`: drop the application menu, Home, and connection controls; order Command Bar, title block, update, Notifications, Pixel dock, sidebar toggle with a right-panel glyph; draw the server warning on the title block whenever it applies — verified by `compact-chrome-switcher` E2E
- [x] 1.2 `CompactSwitcher`: accept an `applicationMenu` node and draw it as a band across the top of the drawer — verified by `compact-chrome-switcher` E2E
- [x] 1.3 Browser host: replace the burger `compact` variant with a `sheet` menu bar that scrolls sideways, portals its lists, and closes the switcher on a command; wire it and the Windows menu button through `App.tsx` — verified by E2E and typecheck

## 2. Verification

- [x] 2.1 Update the E2E suites that pressed the removed controls (`compact-chrome-switcher`, `compact-rail-drawer-visual`, `pixel`, `server-upgrade`, `project-tabs`) — verified by `npm run test:e2e` on those files
- [x] 2.2 Typecheck, Biome, and `openspec validate --all` pass
- [ ] 2.3 Pull request checks green
- [ ] 2.4 Confirmed on a phone
