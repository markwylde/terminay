## 1. Shared status palette

- [x] 1.1 Declare `--status-working`, `--status-attention`, `--status-done`, `--status-idle` on `:root` in `src/components/AgentStatusIndicator.css` and make its state classes read them (verify: e2e computed colour of a desktop working dot is `rgb(232, 185, 49)`)
- [x] 1.2 Alias `--bots-work-dot`, `--bots-need-dot`, `--bots-done-dot`, `--bots-idle-dot` in `src/workspace/bots/bots.css` to the shared properties (verify: `git grep` finds no status hex literal for those properties)

## 2. Compact kit

- [x] 2.1 In `src/workspace/compact/compactSection.css`, alias `--c-attention`, `--c-done`, and new `--c-working` and `--c-idle`, to the shared properties. Point `crow__mark--working`, `crow__mark--idle` and `crow__chip--working` at them, split the combined working/info chip rule so info stays accent, and replace hard-coded status rgba tints with `color-mix` (verify: `git grep` finds no `242, 180, 76` in the kit, and `.crow__chip--info` still uses `--c-accent`)
- [x] 2.2 Make `crow__mark--working` breathe using the indicator keyframes, with no animation under `prefers-reduced-motion` (verify: e2e reads computed `animation-name` with and without reduced motion)
- [x] 2.3 Import `AgentStatusIndicator.css` from `src/workspace/compact/CompactRow.tsx` (verify: e2e computed colour of a compact working mark resolves to the shared amber)
- [x] 2.4 Map a queued bot's compact chip to `info` in `BotsCompactPage.tsx` (verify: typecheck; visual check on the Bots page)

## 3. Tabs rows

- [x] 3.1 In `TabsCompactRow` (`src/workspace/WorkspaceDashboard.tsx`), render `AgentStatusIndicator` (`showIdle`, `size="medium"`) for rows with an agent or a non-idle status, and the kind icon for idle rows without an agent and for untracked rows (verify: e2e asserts the indicator's state class and colour per row)

## 4. Verification

- [x] 4.1 Extend compact e2e coverage on a phone viewport. Assert computed colours for working, waiting and done Tabs rows, the blocked accessible label, the red detail line for a waiting row, a kind icon for an untracked row, and an amber breathing workflow mark. Capture screenshots of the Tabs and Workflows pages (verify: `npm run test:e2e` for that spec passes)
- [x] 4.2 Run typecheck, lint, the relevant unit tests, and `openspec validate align-compact-tab-status-colors` (verify: all clean; failures elsewhere in `--all` are reported as existing)
