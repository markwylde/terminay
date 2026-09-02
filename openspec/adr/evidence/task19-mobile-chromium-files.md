# Task 19 locally emulated mobile-Chromium file evidence

This is deterministic local Chromium device emulation, not evidence from a
physical phone, mobile Safari, Android packaging, a real soft keyboard, or a
mobile network.

At a touch-enabled `390 × 820` viewport,
`e2e/shared-production-routes.spec.ts` loads the production shared Folder route,
waits for its server-owned catalog, taps the accessible `README.md` tree item,
and verifies both its selected state and the exact open callback identity
(`open:README.md`). A second touch workflow crosses the production
`FileViewerClient` boundary to open and read the text session, edit and save a
draft, preserve an external-conflict failure, select bounded performant ranged
text for a 101 MiB file, and keep binary content out of text mode while reading
its bounded HEX rows.

Run:

```sh
npx playwright test e2e/shared-production-routes.spec.ts \
  -g "touch-mobile Chromium (opens a server-owned file entry|edits, saves, conflicts)"
```

This completes the reproducible mobile-web file/file-viewer contract. Downloads,
soft-keyboard behavior, and physical-mobile execution remain operational
follow-ups rather than project-code matrix requirements.
