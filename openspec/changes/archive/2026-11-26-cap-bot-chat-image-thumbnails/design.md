## Context

Every inline image in a bot transcript is an `<img class="bots-inline-image">`. Image attachments are turned into Markdown `![name](bot-attachment:<id>)` images, and the agent's own Markdown can reference images in its container. Both pass through `renderBotMarkdown` in `src/workspace/bots/botMarkdown.ts`. So one CSS rule, `.bots-inline-image` in `src/workspace/bots/bots.css`, sizes every inline image that Chat (`.bots-msgs`) and a thread panel (`.bots-thread__body`) show.

Session transcripts (`BotSessionsPanel`) render `BotTranscript` without a transport. They have no image loader, so a Markdown image there becomes an "Image unavailable" placeholder, not an `<img>`. They are out of scope. If they ever load images, they inherit the shared class and only need the same container declaration.

Today that rule is `max-width: 100%; max-height: 70vh; width: auto; height: auto; object-fit: contain`. The height cap follows the window, not the chat pane. A large bot screenshot in a normal window fills most of the message area (#670).

Inline images have no click behaviour today. `handleBotMarkdownClick` only handles links. This change leaves that untouched.

## Goals / Non-Goals

**Goals:**
- Cap every inline transcript image at 40% of its transcript scroll area's visible content height, at any window, pane or composer size.
- Keep the aspect ratio and keep the existing width cap.
- One rule shared by Chat and thread transcripts.

**Non-Goals:**
- Adding a click-to-enlarge, preview or lightbox.
- Loading images in session transcripts.
- Changing composer pending thumbnails, file chips, inline video players, the Files view preview, Memories or avatars.
- Changing how images are loaded, authorised or stored.

## Decisions

### Size against the transcript with CSS container query units

Make each image-bearing transcript scroll area a size query container (`container-type: size`, `container-name: bots-transcript`): `.bots-msgs` and `.bots-thread__body`. Then set `.bots-inline-image { max-height: 40cqh; }`. `cqh` resolves against the content box of the nearest size container. That is the scroll area's visible height minus its padding, not its scrollable content height. The spec defines the bound on that same box, and tests measure `clientHeight` minus vertical padding. The browser tracks every resize, so the window, a pane, the rail or a growing composer needs no script.

`.bots-sdetail` is not a container. Memories also uses that class, and session transcripts show no images.

Alternatives considered:
- **`max-height: 40vh`.** This is the smallest diff, but it is the window height. A short pane or a grown composer can still leave the image as most of the visible area, which is the reported bug.
- **A `ResizeObserver` that writes a CSS variable.** This works, but it adds renderer state and a re-render path for something CSS already handles.

Size containment means a scroll area's own content no longer sets its height. Both containers already get their height from a flex parent (`flex: 1`, `min-height: 0`), so their layout does not change. E2E checks confirm each one keeps a usable height and still scrolls.

### Keep the aspect ratio with `width: auto; height: auto` plus both max bounds

Keep `max-width: 100%`, `width: auto`, `height: auto` and `object-fit: contain`. When both maxima apply, the browser scales replaced elements to satisfy both while keeping their ratio. An image within both bounds keeps its natural size, because nothing upscales it.

`botMarkdown.ts` imports `nativeActions` with an explicit `.ts` specifier, as `triggersModel.ts` already does, so `node --test` can load it for the shared-class unit test.

No architectural or security boundary is crossed. This is renderer CSS only. It touches no preload, IPC, server, project/window or terminal-session boundary.

## Risks / Trade-offs

- [A transcript container that is not height-constrained would collapse under size containment] → Only the two flex-sized scroll areas get the container type. E2E asserts that they have a non-zero height and scroll. If an image renders outside any size container, `cqh` falls back to the small viewport height, so the cap degrades to 40% of the window rather than breaking.
- [Very short panes make images small] → This is intended. The image stays legible relative to the space available, and its natural ratio is kept.

## Migration Plan

None. This is a stylesheet change that ships with the renderer. To roll back, revert the commit.

## Open Questions

None.
