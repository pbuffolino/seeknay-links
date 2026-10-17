# seeknay Links

A static link-in-bio site using HTML, CSS, JavaScript, and JSON. No framework or deployment build is required.

[Live site](https://links.seeknay.com/) · [CI](https://github.com/pbuffolino/seeknay-links/actions/workflows/ci.yml) · [Report a bug or request a feature](https://github.com/pbuffolino/seeknay-links/issues/new/choose)

![Preview of the links page](assets/preview.png)

## Local development

Use an HTTP server so the browser can fetch the JSON files:

```bash
npm ci
npm run serve         # http://127.0.0.1:4173
npm test              # lint, formatting, unit tests, and site validation
npx playwright install chromium
npm run test:browser  # accessibility and browser regression checks
npm run format        # also refreshes content-based CSS/JS asset versions
```

Opening the HTML as a local file shows saved navigation, but dynamic metrics and link updates require HTTP.

## Fork and customize

- Edit the hero, spotlight, collaboration contact, title, descriptions, structured data, and social metadata in `index.html`.
- Replace `assets/avatar.jpg` and the optimized 96px and 192px JPEG variants. Set your favicon and regenerate `assets/og.png` from the editable `assets/og.svg` at 1200 by 630 pixels. Update the preview screenshot when the design changes.
- Edit `assets/links.json`, then run `npm run sync-links`. This updates the saved HTML navigation, which remains available without JavaScript or during network failures. Commit both files. Supported delay values are 0, 50, 100, 150, 200, and 250 milliseconds.
- Icons are local SVGs in `assets/icons/`. Add an SVG and its CSS mask mapping before using a new `fa-*` class. Preserve the icon license and attribution.
- Set the canonical URL in `index.html` to your full public base URL, including the repository path for a project site. Run `npm run sync-links` to update absolute 404 asset and return URLs. Update the remaining social URLs, `robots.txt`, `sitemap.xml`, and structured data to match.
- Remove `CNAME` for the default GitHub Pages domain, or replace it with your custom hostname. Update repository links in this README, the footer, and issue templates.
- Configure colors in `css/styles.css`. `--accent` is for text; `--accent-fill` is the background for controls with white text. Check contrast in both themes after changing them.
- Set `GA_ID` in `js/analytics.js`, or set it to an empty string to disable Google Analytics. It loads only after acceptance. Privacy settings allows visitors to decline later. When storage is unavailable, consent applies only to the current page.

To deploy, select `main` and `/ (root)` in repository Settings → Pages. Enable HTTPS after configuring your domain. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Metrics publication

The scheduled workflow runs at 14:17 UTC. It fetches public follower totals, opens or updates one metrics PR, validates that the PR contains only the metrics file, approves its token-authored CI run, waits for that exact commit to pass, merges through branch protection, and requests a Pages build. Only `assets/social-metrics.json` may be changed by that PR. CI jobs run in parallel. The Instagram profile is excluded from automated HTTP checks because it redirects CI clients to a rate-limited login page. Its URL and saved navigation are validated locally; verify the profile manually when changing it.

Enable **Allow GitHub Actions to create and approve pull requests** in repository Settings → Actions → General. The workflow requests repository-scoped `contents`, `pull-requests`, `actions`, and `pages` write permissions. It uses the short-lived `GITHUB_TOKEN`; no GitHub personal access token is required. GitHub places token-authored PR runs in an approval-required state. The publisher approves only CI for its same-repository, bot-authored, metrics-only PR. Unexpected changes and failed checks stop publication. Token-authored merges also need an explicit legacy Pages build request. [GitHub workflow trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

Configure the relevant repository Actions secrets:

- YouTube: `YT_API_KEY`, `YT_CHANNEL_ID`.
- Instagram: `IG_ACCESS_TOKEN`, `IG_USER_ID`.
- TikTok: `TIKTOK_SESSION_ID`, `TIKTOK_MS_TOKEN`, `TIKTOK_USERNAME`.
- Bluesky: `BSKY_HANDLE`.
- Facebook: `FB_PAGE_ACCESS_TOKEN`, `FB_PAGE_ID`.

Never put credential values in code, issue reports, screenshots, commit messages, or logs. TikTok's web endpoint and matching-profile HTML fallback are sensitive to upstream changes; failures retain the cached count. Optional `META_GRAPH_VERSION` selects the Graph API version in the updater environment.

Invalid counts and individual API failures preserve the last successful count and timestamp. Partial failures generate a warning and platform summary. If every platform fails, the job fails and leaves the cached file unchanged. The page identifies cached or partial data using each platform's successful update time. Combined followers sums platform counts and does not represent unique people or audience reach.

Do not manually edit the auto-managed metrics file. To add a platform, update the link data, fetcher, supported-network lists, workflow secrets, and regression tests.

## Security and edge configuration

See [security and health operations](docs/security-operations.md) for the dependency auto-merge
policy, required protections, weekly review, and read-only live verification. Use `npm run health:live`
from a fresh default-branch checkout to check the deployed site and origin TLS.

CSS and JavaScript references include content hashes so cached files from an older release cannot mix with new HTML. Run `npm run format` or `npm run version-assets` after changing a runtime asset. JSON fetches bypass the browser cache.

The HTML CSP restricts resource loading and forbids inline executable scripts, inline styles, and event handlers. Analytics destinations follow [Google's CSP guidance](https://developers.google.com/tag-platform/security/guides/csp). Local SVG icons avoid third-party font requests.

Frame protection must be delivered as HTTP response headers. A meta CSP cannot enforce `frame-ancestors`. For the custom domain, apply `config/cloudflare-response-headers.json` as a host-specific Response Header Transform Rule in the `http_response_headers_transform` phase. Preserve other rules in the zone. Change the hostname when forking. [Cloudflare rule API documentation](https://developers.cloudflare.com/rules/transform/response-header-modification/create-api/).

Apply `config/cloudflare-links-settings.json` as a host-specific Configuration Rule in the `http_config_settings` phase. It disables automatic Cloudflare Web Analytics injection for this hostname. The beacon has no site consent integration and is intentionally absent from the CSP allowlist. This configuration rule works without adding a Web Analytics exclusion rule. Preserve other zone rules and change the hostname when forking. [Cloudflare Configuration Rules documentation](https://developers.cloudflare.com/rules/configuration-rules/settings/).

The configuration rule also uses Full TLS for the connection to the origin. Full encrypts that connection but does not validate the origin certificate. Use `strict` after the origin presents a trusted certificate for the custom hostname. GitHub Pages currently has no certificate for this hostname, so its HTTPS enforcement setting remains unavailable. Certificate recovery can require DNS changes; retain the proxy until a maintenance window is planned. [Cloudflare TLS modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full/) and [GitHub Pages certificate provisioning](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

Both configuration files contain individual rule payloads. When creating a new zone ruleset through the API, put the payload in its `rules` array and supply the corresponding phase and `kind: "zone"`. Verify the deployed HTML contains no injected beacon, and test the headers on both the homepage and a nested 404.

This repository is public. Review staged files and generated assets for private information before committing. Report vulnerabilities privately using [SECURITY.md](.github/SECURITY.md).

## Files and checks

- `assets/links.json`: canonical link data; `npm run sync-links` maintains saved navigation.
- `assets/social-metrics.json`: workflow-managed counts and successful update times.
- `index.html`, `404.html`, `css/`, `js/`: runtime site, served directly by Pages.
- `scripts/`: updater, guarded publication, saved-link generation, validation, and local HTTP server.
- `tests/`: metrics failure tests, publication guards, and browser/accessibility checks.
- `.github/workflows/`: parallel CI and daily metrics publication. Required checks must remain enabled before merging.

[Contribution guide](.github/CONTRIBUTING.md). Site code is MIT licensed. The bundled Font Awesome SVGs are CC BY 4.0; see [their license](assets/icons/LICENSE.txt).
