## Context

`.bots-video` is a grid with `aspect-ratio: 16 / 9` and `overflow: hidden`. The
`<video>` inside has `height: 100%`, which does not resolve against the grid's
auto row, so it takes its natural height for the frame's width and is clipped.

## Goals / Non-Goals

- Goal: every video is fully visible at its own aspect ratio.
- Goal: releasing and reloading a video does not change its frame.
- Non-goal: storing video dimensions on the attachment record.

## Decisions

- **Read the shape from `loadedmetadata`.** `videoWidth` and `videoHeight` account
  for the display size. Measuring on the server would add parsing and stored
  state for no visible gain.
- **Position the video absolutely inside the frame.** Its size then comes from
  the frame alone, so `object-fit: contain` applies in every state.
- **Keep the ratio in component state.** It outlives the blob URL, so a released
  player holds its shape.

## Risks / Trade-offs

- A video that is not 16:9 changes height once when its metadata first loads.
  Loading starts well before the viewport, and the transcript's pinned-to-bottom
  observer follows the change.
