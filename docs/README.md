# Termide Documentation Site

This is the documentation and landing page for Termide, built with Astro.

## Adding Screenshots

To add screenshots to the landing page:

1. Add landscape-oriented PNG images to `/public/screenshots/` folder
2. Name them clearly, such as `screenshot1.png`, `screenshot2.png`, `screenshot3.png`, and `screenshot4.png`
3. Update the `screenshots` array in `/src/pages/index.astro` if you add or rename files

The hero section uses the first screenshot in the array as the main hero image.

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

This site is configured for GitHub Pages deployment at `markwylde.com/termide`.

The build output is in the `dist/` folder which can be deployed to GitHub Pages.
