## Context

`PixelCompanion` renders the dock button and owns the `@markwylde/pet`
instance. The pet reflects its lifecycle in its root element's `data-state`
(`hidden`, `showing`, `shown`, `hiding`). Its `show` and `hide` events fire
only when a transition finishes.

## Goals / Non-Goals

- Goal: the dock ghosts as Pixel leaps out and is whole again as it lands.
- Non-goal: any change to the pet library.

## Decisions

- **Out means any state but `hidden`.** The dock ghosts as soon as the pet
  starts showing and stays ghosted through `hiding`, so Pixel never appears
  twice and the full icon returns exactly as Pixel lands.
- **Observe `data-state` rather than the events.** The `show` event fires only
  after the leap ends, which would leave a full icon in the dock during the
  leap. A `MutationObserver` on the pet's root sees every transition as it
  starts.
- **The ghost is CSS on a `data-out` attribute.** Reduced opacity and
  greyscale on the icon only, so the state badge stays fully visible.

## Risks / Trade-offs

- [Relies on the pet's `data-state` attribute] → It is part of the library's
  shipped stylesheet, which hides the pet with `[data-state='hidden']`.

## Migration Plan

None.
