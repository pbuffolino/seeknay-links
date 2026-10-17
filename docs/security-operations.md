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
branch protection with `lint`, `link-check`, `security-audit`, `browser-test`, and
`dependency-review`, `Analyze (actions)`, and `Analyze (javascript-typescript)` checks from
GitHub Actions. It also verifies both CodeQL analyses belong to the exact PR head, have no
coverage warnings, and have no unresolved alerts on the PR reference. Additional native protections still apply.
The merge request includes the expected head SHA and does not bypass protection. The job
checks ancestry against the latest base revision immediately before merging, in addition to
native strict protection. Its token reads the public branch summary rather than requiring
administration access.
The trusted reconciler runs hourly, on dependency PR events, and by manual dispatch on `main`.
It processes a rotating batch of at most six PRs serially. One repository-wide workflow
concurrency group prevents overlapping dependency publishers. Each merge attempt retains a
twelve-minute check deadline; refresh waits at most five minutes and publication verification
at most ten minutes. A shared 85-minute deadline stops further GitHub requests, leaving time
to report within a 90-minute maintenance budget. Failed candidates do not cancel the rest of
the batch. Verified major upgrades are recorded for review and skipped; unknown metadata,
invalid signatures, changed heads, and unexpected scopes fail closed.

Before requesting a refresh, the reconciler can close an untouched signed patch/minor npm
update that is already applied. It reads the original signed commit's sole parent, proposed
head, and current protected main JSON as data, without executing PR code or installing PR
dependencies. Every requested change in every original changed JSON file must be satisfied.
Changed lockfile package entries must match completely, including resolved URLs, integrity,
flags, and metadata. Matching a version alone is insufficient. Unrelated main changes do not
count as satisfying a requested change. Empty/format-only deltas are not automatically closed.
Main CI, CodeQL, and Pages must already be verified. Complete eligibility,
JSON comparisons, main health, and live head/base are rechecked before closure; resulting
closed/unmerged/head/base state must verify. The receipt records `ALREADY APPLIED`, never a
merge. Unknown or incomplete evidence leaves the PR for review. No branch or review is changed.

Scheduled/event runs merge fresh eligible heads and defer stale ones without state churn.
Owner-assisted manual runs use native close/reopen with the existing `pull-requests: write` permission. Before
closing an eligible signed patch/minor PR, the reconciler adds the reserved
`dependency-refresh-intent` label and an attempt label binding the PR number, full head SHA,
full base SHA, and attempt number. The machine publishes a short-lived data-only request
artifact, then closes the PR. An authenticated local owner driver may reopen only that exact
active trusted run's signed eligible machine-owned closure. The driver never closes, comments,
merges, removes labels, or deletes branches. The machine waits at most two minutes for the
handoff, restores open in `finally` on timeout, and removes only its own
markers after verifying the PR is open. Existing labels, reviews, and branches are preserved.
Subsequent sweeps prioritize interrupted refreshes, but recover a closed PR only when its
unchanged signed head remains eligible and label/closure events authenticate GitHub Actions
ownership. Unmarked PRs, human closures, merged PRs, and obsolete updates closed by Dependabot
are never reopened. Incomplete or conflicting evidence requires review.

Dispatch on protected main with `owner-assisted=true`, then run the driver immediately using
the returned run ID and that dispatch's full workflow SHA:

```bash
gh workflow run dependabot-automerge.yml --ref main -f owner-assisted=true
node scripts/dependency-owner-driver.mjs --run RUN_ID --sha WORKFLOW_SHA
```

Use existing owner `gh` authentication. The driver refuses token/host overrides and never
retrieves credentials or changes scopes. It waits through GitHub concurrency states and
requires exact repository, owner actor, workflow path/ID/SHA, reusable workflow SHA, run attempt,
successful inspection job, artifact identity/digest/size/expiry, complete metadata/signature/scope,
protected base, and unreplayed machine label/closure evidence before reopening. ZIP contents
are bounded JSON data with exactly one expected archive path; they are never executed or
extracted into the checkout. Earlier-attempt artifacts are skipped. Unknown current requests
fail closed. The driver waits for backend completion; its receipt is not a substitute for
independently verifying merges, main CI/CodeQL, Pages and live resources. Keep the local host
available for the whole assisted run. No owner driver is needed for a fresh eligible head.

Dependabot may delete a bot head while its machine-owned PR is closed. Recovery may recreate
only an absent exact `refs/heads/dependabot/...` reference at the original verified signed SHA,
using GitHub's native create-reference API. It never updates or force-pushes an existing ref,
creates a commit, or writes main. Full eligibility, authenticated closure/intent, a subsequent
Dependabot deletion event, protected base/ancestry, and unchanged closure/base are required.
The restored ref must read back at the exact signed SHA before reopening. Changed existing
refs, human/obsolete closures, and repeated deletions require review. The refresh job reuses
the publisher's existing contents-write capability for this bounded recovery; the owner
helper uses existing authentication. `finally` and later sweeps can recover a deleted owned
branch even after request expiry. An expired artifact never authorizes owner assistance;
recovery first verifies/open-cleans the old intent, then an assisted run can stage a new
request against current main. Obsolete PRs closed without refresh intent remain closed,
including any branches Dependabot deleted for them.
[GitHub native reference creation](https://docs.github.com/en/rest/git/refs#create-a-reference).

Persistent label definitions and timeline evidence bound attempts to at most two per PR/base.
An unchanged PR/head/base is never requested twice, and changed heads wait at least ten minutes
between requests. Keep reserved label definitions as attempt evidence after removing their
PR attachments. Public rebase comments remain disabled in scheduled/manual/event workflows;
the legacy comment helper still requires explicit owner approval and its separate repository
variable, which must remain unset.
The reconciler never rebases or adds commits itself. A changed head always goes through fresh
signature, metadata, scope, CI, CodeQL, and native protection checks before merging.
When reopening creates approval-required CI or CodeQL runs, the publisher uses its existing
`actions: write` permission to approve only the exact same-repository PR, signed eligible head,
branch, `pull_request` event, and known CI/CodeQL workflow path. Complete dependency and native
protection guards are repeated, and run identity is re-fetched immediately before approval.
Approved runs remain pending until successful; `action_required` is not treated as a failed
test. Unknown runs are never approved, and real current failures still block merging.
[Dependabot rebase triggers](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#rebase-strategy),
[PR labels and permissions](https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue).

Metadata collection runs with read-only permissions. A small Node preload supplies a fresh
REST-fetched PR payload to the immutable `dependabot/fetch-metadata` action before its context
initializes. It does not override GitHub default variables in YAML or modify the runner's
`event.json`. Commit verification remains enabled. A read-only CI job exercises the actual
pinned action against an open dependency PR. The site tooling keeps Node 22; the pinned
metadata action uses its own declared Node runtime.
[GitHub Dependabot automation guidance](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions).

After verifying the merge, the publishers explicitly dispatch CI and CodeQL on `main`, then
request a legacy Pages build. Before processing the next candidate, a separate read-only job
requires successful exact-revision main CI and CodeQL workflows, both warning-free CodeQL
categories, no open main scan alerts, a successful exact-revision Pages build and deployment,
and matching live HTML/resources. Verification jobs check out literal protected `main` with
credentials disabled and assert its local HEAD matches the expected publication SHA before
setup or installation. The latest result per CodeQL category controls retries;
an older failed attempt does not invalidate a newer successful analysis. Main advancing during
verification requires a new receipt. Origin TLS remains a separate weekly security check and
is never bypassed or repaired by the publisher.

Every reconciliation first recovers missing main checks/publication and verifies delivery,
even with no open PRs. This recovers an interrupted publisher after a valid merge without
reverting the dependency fix. The dependency publisher needs `actions: write` for those
dispatches. A build
request is not delivery proof. Verify the completed deployment and live resources. If a build
request fails after a successful merge, investigate the failed run and request a Pages rebuild
after verifying the merged revision. Do not revert a valid security fix just because publication
failed. [Workflow trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

## Continuous checks

The metrics publisher approves and waits for both CI and CodeQL on its verified metrics-only
PR. Workflow identity, PR identity, branch, and SHA must all match before approving a run.

CI runs on pull requests, pushes to `main`, manual dispatch, and a daily schedule. The npm audit
blocks all reported vulnerability severities, including development dependencies. Dependency
review blocks newly introduced vulnerable dependencies on PRs. Installs disable package
lifecycle scripts. This project currently needs none for its test tools.

Keep the explicit CodeQL workflow enabled for JavaScript/TypeScript and GitHub Actions. Check that
both languages actually produce successful analyses; enabled settings alone do not prove
coverage. Require their checks in branch protection after the initial scans succeed. Keep
the CodeQL merge protection ruleset active. The workflow scans every pull request, including
dependency updates, without running a repository build or install. It uploads same-repository
PR results against the exact head. The publisher separately checks analyses and alerts before merging.
[Code scanning merge protection limitations](https://docs.github.com/en/code-security/concepts/code-scanning/merge-protection).
Secret
scanning and push protection must remain enabled. Keep the Actions default token read-only,
third-party actions restricted, and full SHA pinning required.
[CodeQL and Dependabot permissions](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/resource-not-accessible).

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
