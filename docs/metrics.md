# Follower metrics

A scheduled GitHub Actions workflow keeps the follower counts on the page current. It is optional. The site works without it and shows the last saved counts.

## How it works

`.github/workflows/update-social-metrics.yml` runs daily at 14:17 UTC and can also be started by hand from the Actions tab.

1. `scripts/update-social-metrics.mjs` fetches each platform's public follower total.
2. The workflow opens or updates one pull request that changes only `assets/social-metrics.json`.
3. `scripts/publish-metrics.mjs` validates the file against a bounded schema at that exact commit, waits for its CodeQL scan, then requests a protected merge and a Pages build.

The publisher cannot merge code changes. It uses the repository-scoped workflow token, so no personal access token is required.

Do not edit `assets/social-metrics.json` by hand. The next run overwrites it.

## Secrets

Add the secrets for the platforms you use under Settings → Secrets and variables → Actions.

| Platform  | Secrets                                                             |
| --------- | ------------------------------------------------------------------- |
| YouTube   | `YT_API_KEY`, `YT_CHANNEL_ID`                                       |
| Instagram | `IG_ACCESS_TOKEN`, `IG_USER_ID`                                     |
| TikTok    | `TIKTOK_USERNAME`. Optional: `TIKTOK_SESSION_ID`, `TIKTOK_MS_TOKEN` |
| Bluesky   | `BSKY_HANDLE`                                                       |
| Facebook  | `FB_PAGE_ACCESS_TOKEN`, `FB_PAGE_ID`                                |

The optional `META_GRAPH_VERSION` environment value selects the Graph API version used for Instagram and Facebook.

Never put credential values in code, issues, screenshots, commit messages or logs.

## TikTok

TikTok has no simple public API for follower counts, so the updater reads the public profile. This is sensitive to changes on TikTok's side.

- The updater reads the exact `statsV2.followerCount` and falls back to the rounded `stats.followerCount`.
- The session cookie is optional. When set, the updater tries it first, then retries anonymously.

## When something fails

- An invalid count or a single platform failure keeps that platform's last successful count and timestamp.
- A partial failure produces a warning and a per-platform summary on the workflow run.
- If every platform fails, the job fails and the saved file is left unchanged.

The page labels cached or partial data using each platform's last successful update time. The combined total adds the platform counts together. It does not represent unique people or audience reach.

## Adding a platform

Update the link data, the fetcher, the supported-network lists, the workflow secrets and the regression tests.
