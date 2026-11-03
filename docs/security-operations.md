# Security and health operations

## Local code validation and Codex review

Owner policy, November 3, 2026: run code checks locally and obtain independent native
Codex review before merging code, configuration and dependency changes. Hosted CI
and hourly dependency auto-merge/reconciliation workflows have been removed. The
retired helper CLIs stop before any provider action; fixtures under
`tests/fixtures/retired-workflows/` preserve historical safety regression cases.
Dependabot alerts, security updates and routine update PRs remain enabled.

Prepare locked tooling with `npm ci --ignore-scripts`, install Playwright Chromium
with `npx playwright install chromium`, and install the `lychee` CLI. Then run:

```bash
npm run check:local
```

This executes lint/format checks, unit/site validation, an all-severity npm audit,
Chromium browser/accessibility tests and the same external link checks as the old
hosted workflow. The Instagram profile remains excluded because it challenges HTTP
clients; verify it separately when changing that link. External link/audit network
failures remain incomplete checks, not passing results. CodeQL remains hosted for
GitHub-integrated code-scanning/merge protection; it does not replace Codex review.
Record the exact candidate SHA, local results and independent code/security review
dispositions in each PR. A changed candidate requires updated evidence. Never
infer local success from the absence of hosted CI or weaken remaining CodeQL rules.

## Necessary hosted publication

The daily metrics publisher still collects and publishes its own generated data.
Its trusted workflow validates a closed, bounded JSON schema fetched from the exact
verified metrics-only PR SHA, waits for that SHA's CodeQL analyses, then uses the
normal protected merge API and requests Pages publication. It never runs candidate
code or tests and cannot merge code changes. There is no general CI dispatch.
CodeQL and native Pages deployment remain hosted. Secret scanning/push protection
and Dependabot alerts remain enabled. No self-hosted runner or new scheduler is
registered by this migration.

Branch protection must no longer require retired `lint`, `link-check`,
`security-audit`, `browser-test`, `dependency-review` or
`dependency-metadata-adapter` jobs. Keep CodeQL protection and all unrelated
protections. This requires an explicit settings migration and independent readback;
removing YAML alone does not update a protection rule.

## Weekly review

The owner maintains a separate Orca schedule. Its configuration, local paths, private evidence,
and run reports do not belong in this public repository. Use a fresh `origin/main` checkout.

```bash
npm ci --ignore-scripts
npm test
npx playwright install chromium
npm run test:browser
npm audit --audit-level=low
npm run health:live
```

The live check is read-only. It verifies HTTP redirection, HTTPS, homepage and nested 404
headers, deployed HTML and resources against the checkout, per-platform metrics freshness,
absence of an injected analytics beacon, and the Pages origin certificate. A nonzero exit
requires review. A successful metrics job does not prove every platform updated successfully.

Also inspect current GitHub settings, open Dependabot and code-scanning alerts, the most recent
secret-scanning result available to the authenticated account, failed or stalled Actions runs,
open dependency PRs, scheduled-run recency, and the Pages deployment revision. Exercise the live
page in a browser at desktop and mobile widths, checking console errors, CSP violations,
navigation, themes, consent, and assets. Automated link checks exclude the Instagram profile
because it challenges CI clients; verify it in a browser or report access as unverified.

If access is denied or a scan is absent, report coverage as unverified. Never infer an empty
alert list from an API error. Do not print secret values, full credential-bearing logs, or
private findings into public issues or PRs. Report vulnerabilities privately through
[SECURITY.md](../.github/SECURITY.md).

## Origin TLS and repair boundaries

The edge configuration is in `config/`. Verify the deployed settings independently before
changing them. Full TLS encrypts the origin connection without validating its certificate.
Full (strict) requires a valid certificate for the custom hostname. Coordinate certificate
provisioning and DNS changes before switching modes; an invalid origin certificate can break
delivery. Do not mark this risk resolved merely because the public edge certificate works.
[Cloudflare Full TLS](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full/).

Technical repairs use a narrowly scoped PR with local validation and independent Codex review. Every visible copy, styling, layout, control or interaction change needs explicit owner approval. Do not change credentials, DNS, TLS settings or alert dismissals during a routine review. Dependency updates now require the same local validation and Codex review as other code changes.
