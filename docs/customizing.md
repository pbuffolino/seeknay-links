# Customization guide

Everything you need to turn a fork of this site into your own. Start with the short list in the [README](../README.md#-make-it-yours), then use this page for the details.

## Run it locally

```bash
npm ci
npm run serve         # http://127.0.0.1:4173
npm test              # lint, formatting, unit tests and site validation
npx playwright install chromium
npm run test:browser  # accessibility and browser regression checks
npm run format        # also refreshes content-based CSS/JS asset versions
```

Opening the HTML as a local file shows the saved navigation, but live metrics and link updates require HTTP.

## Links

Edit `assets/links.json`, then run `npm run sync-links` and commit both changed files. The command rewrites the saved navigation in the HTML, which stays available without JavaScript and during network failures.

Each link has a `name`, `url`, `icon`, `delay` and `networkId`.

- `delay` staggers the entrance animation. Supported values are 0, 50, 100, 150, 200 and 250 milliseconds.
- `networkId` connects a link to its follower count. Use `tiktok`, `youtube`, `instagram`, `bluesky` or `facebook`, or `null` for a link without a count.

## Icons

Icons are local SVG files in `assets/icons/`. To use a new `fa-*` class, add the SVG and its CSS mask mapping first. Keep the icon license and attribution in place.

## Identity and images

- Edit the hero, spotlight, collaboration contact, title, descriptions, structured data and social metadata in `index.html`.
- Replace `assets/avatar.jpg` and the optimized 96px and 192px JPEG variants.
- Replace the favicon files.
- Edit `assets/og.svg`, then export it to `assets/og.png` at 1200 by 630 pixels. This is the image shown when the page is shared.

## Colors

Colors are custom properties in `css/styles.css`. `--accent` is for text. `--accent-fill` is the background for controls with white text. Check contrast in both themes after changing them.

## Domain and URLs

- Set the canonical URL in `index.html` to your full public base URL. Include the repository path for a project site.
- Run `npm run sync-links` to update the absolute asset and return URLs in `404.html`.
- Update the remaining social URLs, `robots.txt`, `sitemap.xml` and structured data to match.
- Replace the hostname in `CNAME`, or delete the file to use the default GitHub Pages domain.
- Update the repository links in the README, the footer and the issue templates.

## Analytics and consent

Set `GA_ID` in `js/analytics.js`, or set it to an empty string to disable Google Analytics. It loads only after a visitor accepts. The privacy settings control lets visitors decline later. When browser storage is unavailable, consent applies only to the current page.

## Follower counts

The committed `assets/social-metrics.json` holds seeknay's numbers. Configure your own secrets and run the workflow once before you publish. See the [metrics guide](metrics.md).

## Deploy

In your repository, open Settings → Pages and select `main` and `/ (root)`. Enable HTTPS after configuring your domain. See the [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

If you use a custom domain behind Cloudflare, see [edge and header configuration](edge-configuration.md).

## Asset versions

CSS and JavaScript references include content hashes, so cached files from an older release cannot mix with new HTML. Run `npm run format` or `npm run version-assets` after changing a runtime asset. JSON fetches bypass the browser cache.

## Where things live

- `assets/links.json`: link data. `npm run sync-links` maintains the saved navigation.
- `assets/social-metrics.json`: workflow-managed counts and update times. Do not edit by hand.
- `index.html`, `404.html`, `css/`, `js/`: the site, served directly by Pages.
- `scripts/`: metrics updater, guarded publication, saved-link generation, validation and the local server.
- `tests/`: unit tests, publication guards and browser/accessibility checks.
- `.github/workflows/`: CodeQL and the daily metrics publication.
