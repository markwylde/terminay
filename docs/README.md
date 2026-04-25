# Termide Documentation Site

This is the documentation and landing page for Termide, built with Astro.

## Adding Screenshots

Landing page screenshots live in `public/screenshots/` and are referenced by name from `src/pages/index.astro`.

The current generated assets are:

- `termide-hero-workspace.png`
- `termide-workspace.png`
- `termide-command-bar.png`
- `termide-macros.png`
- `termide-files.png`
- `termide-folders.png`
- `termide-settings.png`
- `termide-shortcuts.png`
- `termide-remote-access.png`

From the repository root, regenerate them with:

```bash
npm run docs:screenshots
```

If you add or rename screenshots manually, update the `heroScreenshot` or `featureScreenshots` constants in `src/pages/index.astro`.

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Deployment

This site is configured for GitHub Pages deployment at `https://markwylde.github.io/termide/`.

The build output is in the `dist/` folder. The Pages workflow builds from `docs/` and deploys committed screenshot assets; the root `npm run docs:build` workflow regenerates screenshots before building.
