# Security and health operations

## Dependency updates

Dependabot checks npm and GitHub Actions daily. Routine version updates wait three days after
release. The cooldown does not delay security updates. Dependabot security updates and alerts
must remain enabled in repository settings.
[Dependabot configuration reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

The Dependabot auto-merge workflow permits patch and minor updates. It verifies the PR author,
same-repository branch, single signed Dependabot commit, original event SHA, and metadata for
every updated dependency. Major updates, maintainer changes, unknown metadata, renamed files,
and unexpected changes require review. npm updates can modify only `package.json` and
`package-lock.json`. Action updates can modify only existing workflow action SHA pins, keeping
the action identity and major version. Missing or truncated patches stop automatic merging.

The privileged merge job checks out only the trusted default branch. It never executes code
from the dependency PR and never installs packages. Metadata collection has read-only access.
CI runs separately without repository secrets. Keep commit verification enabled in
`dependabot/fetch-metadata`.
[GitHub workflow security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

Before merging, the publisher requires successful pull-request CI for the exact PR head and
strict branch protection with `lint`, `link-check`, `security-audit`, `browser-test`, and
`dependency-review` checks from GitHub Actions. Additional native protections still apply.
The merge request includes the expected head SHA and does not bypass protection. The job
stops after twelve minutes if checks, review requirements, or branch freshness block it.
Dependabot can rebase an outdated PR; inspect failed publisher runs rather than bypassing CI.
[GitHub Dependabot automation guidance](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions).

After verifying the merge, the workflow explicitly requests a legacy Pages build. A build
request is not delivery proof. Verify the completed deployment and live resources. If a build
request fails after a successful merge, investigate the failed run and request a Pages rebuild
after verifying the merged revision. Do not revert a valid security fix just because publication
failed. [Workflow trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

## Continuous checks

CI runs on pull requests, pushes to `main`, manual dispatch, and a daily schedule. The npm audit
blocks all reported vulnerability severities, including development dependencies. Dependency
review blocks newly introduced vulnerable dependencies on PRs. Installs disable package
lifecycle scripts. This project currently needs none for its test tools.

Keep CodeQL default setup enabled for JavaScript/TypeScript and GitHub Actions. Check that
both languages actually produce successful analyses; enabled settings alone do not prove
coverage. Require their checks in branch protection after the initial scans succeed. Secret
scanning and push protection must remain enabled. Keep the Actions default token read-only,
third-party actions restricted, and full SHA pinning required.
[CodeQL default setup](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning).

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

Technical repairs should use a narrowly scoped PR with relevant verification. Every visible
copy, styling, layout, control, or interaction change needs explicit owner approval. Do not
change credentials, DNS, TLS settings, alert dismissals, or branch protections during a routine
weekly review. Automatic merging is limited to the dependency policy above. To stop it,
disable the Dependabot auto-merge workflow in Actions. Dependabot alerts and CI remain active.
