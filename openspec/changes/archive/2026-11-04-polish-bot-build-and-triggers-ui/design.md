## Context

The build notice (`BuildBanner`) is drawn wherever the engine summary appears: on the Bots dashboard and at the top of each bot tab. Progress comes from server-owned `BotBuildProgress`, keyed by build id and state.

## Decisions

- **Dismissal is per build outcome, kept in the renderer.** The key is `<build id>:<state>`, held in `localStorage` and shared across every banner in the window through a small external store. A new build, or a change of state, produces a new key, so the notice returns when there is news. It is presentation state, so nothing crosses the renderer/server boundary. The renderer stays untrusted and gains no command.
- **"Seen, then left" is observed, not inferred.** An `IntersectionObserver` marks the completed notice as shown once it intersects. It retires the notice when the Home tab holding it reports itself hidden (`BotTabHost.isVisible`), or when it unmounts, after having been shown. Home tabs stay mounted while hidden, so intersection alone cannot tell that the user left. Scrolling it out of view does not count, and a notice mounted while hidden is never marked seen.
- **Failures are not dismissible.** Dismissing a failed build's banner would hide the only path to Retry, because the engine card is hidden while a build is failed.
- **A sheet, not a page.** Progress renders as a right-hand modal sheet below the title bar, so the user keeps their place. It keeps the existing dialog semantics: focus trap, Escape, and focus restore. Clicking the backdrop closes it.
- **One dropdown component.** `GroupedSelect` generalises the Profile tab's agent picker: a combobox button, a listbox of optional titled groups, descriptions and icons, keyboard navigation, and opening above the button when there is no room below. The agent picker, the Model select, and every trigger-editor select use it. Native selects elsewhere in Bots are left for a follow-up.

## Risks

- `localStorage` can be unavailable. Dismissal then lasts only for the window's lifetime, which is acceptable for a notice.
