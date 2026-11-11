# Edge and header configuration

This page applies when the site runs on a custom domain behind Cloudflare. A fork on the default GitHub Pages domain can skip it.

## Content Security Policy

The CSP in `index.html` restricts resource loading and forbids inline executable scripts, inline styles and event handlers. Analytics destinations follow [Google's CSP guidance](https://developers.google.com/tag-platform/security/guides/csp). Local SVG icons avoid third-party font requests.

Update the CSP when you add a new external script or style domain.

## Response headers

Frame protection must be delivered as HTTP response headers. A meta CSP cannot enforce `frame-ancestors`.

Apply `config/cloudflare-response-headers.json` as a host-specific Response Header Transform Rule in the `http_response_headers_transform` phase. Preserve other rules in the zone, and change the hostname when forking. See the [Cloudflare rule API documentation](https://developers.cloudflare.com/rules/transform/response-header-modification/create-api/).

## Cloudflare Web Analytics

Apply `config/cloudflare-links-settings.json` as a host-specific Configuration Rule in the `http_config_settings` phase. It disables automatic Cloudflare Web Analytics injection for this hostname. The beacon has no site consent integration and is intentionally absent from the CSP allowlist.

This configuration rule works without adding a Web Analytics exclusion rule. Preserve other zone rules, and change the hostname when forking. See the [Cloudflare Configuration Rules documentation](https://developers.cloudflare.com/rules/configuration-rules/settings/).

## Origin TLS

The configuration rule also uses Full TLS for the connection to the origin. Full encrypts that connection but does not validate the origin certificate. Use `strict` after the origin presents a trusted certificate for the custom hostname.

GitHub Pages currently has no certificate for this hostname, so its HTTPS enforcement setting remains unavailable. The owner accepted Full TLS as the intended architecture on 2026-11-11 (#186): traffic between Cloudflare and GitHub is encrypted but the origin is not authenticated. Moving to `strict` needs DNS changes and a certificate renewal plan. See [Cloudflare TLS modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full/) and [GitHub Pages certificate provisioning](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

## Applying the rules

Both configuration files contain individual rule payloads. When creating a new zone ruleset through the API, put the payload in its `rules` array and supply the corresponding phase and `kind: "zone"`.

After applying, verify the deployed HTML contains no injected beacon, and test the headers on both the homepage and a nested 404. `npm run health:live` from a fresh default-branch checkout checks the deployed site and reports the origin certificate state.
