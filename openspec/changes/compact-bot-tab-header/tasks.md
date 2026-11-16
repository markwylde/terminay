## 1. Renderer

- [x] 1.1 `BotTab`: add a "Bot settings" button with a gear icon and an in-header ARIA menu (`menuitemradio` Chat and Configure with the current one checked, then Enable/Disable bot as a `menuitem` only when sources are supported); focus the checked item on open, arrow/Home/End navigation, Escape and choosing close it and refocus the button, outside press and the tab being hidden close it — verified by `bots` E2E
- [x] 1.2 `botPanels.css`: make `.bots-tab` an inline-size container; at 600px and below hide the agent line, the Disable bot button and the mode switch, visually hide the status chip unless the bot is disabled, and show the settings button; above it hide the settings button and its menu — verified by `bots` E2E
- [x] 1.3 Truncate the bot's name with an ellipsis at every width — verified by `bots` E2E

## 2. Verification

- [x] 2.1 Add a narrow bot tab E2E case at a 390px window: the name's box does not intersect the settings button; no visible chip, agent line, Disable bot button or mode switch; the status is still in the accessibility tree; the menu marks Chat checked, Configure switches mode and closes the menu, Disable bot disables the bot and shows a Disabled chip, Enable bot restores it; Escape closes the menu and refocuses the button — verified by `npm run test:e2e -- e2e/bots.spec.ts`
- [x] 2.2 Existing wide `bots` E2E cases still pass with the wide switch and Disable bot button — verified by `npm run test:e2e -- e2e/bots.spec.ts`
- [x] 2.3 Screenshots of the narrow header and its open menu attached to the pull request
- [x] 2.4 `npm run typecheck`, Biome, and `openspec validate --all` pass
- [ ] 2.5 Every Gitea commit status on the pull request head SHA is `success` or `skipped`
- [ ] 2.6 Confirmed by Mark on an iPhone in the PWA at portrait width: header fits, menu switches Chat/Configure and toggles availability
