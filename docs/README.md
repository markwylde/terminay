# Termide Documentation Site

This is the documentation and landing page for Termide, built with Astro.

## Adding Screenshots

To add screenshots to the landing page:

1. Add landscape-oriented PNG images to `/public/screenshots/` folder
2. Name them sequentially: `1.png`, `2.png`, `3.png`, etc.
3. The site will automatically detect and display them

The hero section will use the first screenshot (`1.png`) as the main hero image.

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
