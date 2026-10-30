# AGENTS.md — seeknay-links

## Project Overview

Link-in-bio static site deployed to GitHub Pages at links.seeknay.com. No build step — vanilla HTML/CSS/JS only. All content is driven by JSON data files.

**This repository is public.** Never commit secrets, tokens, API keys, or personal data. All credentials must go through GitHub Secrets / environment variables.

---

## Development Commands

```bash
npm run lint          # ESLint + Prettier check (also what `npm test` runs)
npm run format        # Auto-fix formatting with Prettier
npm run update-metrics  # Fetch live follower counts (requires env vars; normally runs via GitHub Actions)
```

---

## Architecture

| File/Dir                            | Purpose                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `index.html`                        | Single-page entry point; hardened CSP; **no inline scripts allowed**    |
| `assets/links.json`                 | Source of truth for link cards — edit here, not in HTML                 |
| `assets/social-metrics.json`        | Auto-committed daily by GitHub Actions; **do not manually edit**        |
| `css/styles.css`                    | All styling; uses CSS custom properties for theming                     |
| `js/links.js`                       | Renders link cards from `links.json`                                    |
| `js/followers.js`                   | Displays follower/subscriber metrics                                    |
| `js/ui.js`                          | Theme toggle and share functionality                                    |
| `js/analytics.js`                   | GA4 event tracking                                                      |
| `scripts/update-social-metrics.mjs` | Node.js script to fetch live metrics; all credentials via env vars only |

---

## CI/CD

- **`ci.yml`** — Runs on every push/PR: lint → link-check (Lychee) → `npm audit`
- **`update-social-metrics.yml`** — Runs daily at 14:17 UTC; commits updated `social-metrics.json`

---

## Key Conventions

- **UX approval:** Every UX change requires explicit approval from the repository owner before implementation or publication. This includes visible copy, layout, styling, controls, and interaction behavior. General repair instructions do not authorize UX changes. Present the proposed change and wait for approval.
- **UX direction:** Keep the site clean, simple, fast, and mobile first. Favor essential content and compact layouts.
- **Brand spelling:** Always spell the brand `seeknay` in lowercase, including copy, metadata, shared text, artwork, and profile links.
- **Branch cleanup:** Remove completed merged feature branches and clean Orca worktrees as work progresses. For squash merges, verify that the branch tip matches the merged PR head and that the PR merge commit is in `main`. Preserve uncommitted work and private handoff notes. Keep active runs, runtime-owned preparation checkouts, and reusable bot branches. Completed disposable automation checkouts are eligible for owner-authorized cleanup after run output and private evidence are archived; an unresolved review finding must remain visible in durable records. Verify removal through filesystem, Git, and Orca readbacks because a removal acknowledgment can precede deletion. Do not delete the workspace of a running agent.
- **Review artifacts:** Deliver standalone rendered Markdown or HTML files and open them in Orca with the intended repository selected. Verify the rendered title and content. Do not make TSX/canvas source the only review deliverable. Opening a private local artifact does not authorize public publication.
- **Formatting:** 2-space indent, double quotes, ES5 trailing commas, 100-char line width (Prettier)
- **CSP:** No inline scripts in HTML — the Content Security Policy in `index.html` enforces this
- **Secrets:** No hardcoded credentials anywhere — all secrets via GitHub Actions environment variables
- **Adding a new social platform:** add an entry to `assets/links.json`, add a handler in `scripts/update-social-metrics.mjs`, and add the required secrets to `.github/workflows/update-social-metrics.yml`

---

## Things to Be Careful About

- `assets/social-metrics.json` is auto-managed by CI; manual edits will be overwritten on the next daily run
- The CSP in `index.html` must be updated if new external script or style domains are added
- `npm audit --audit-level=high` runs in CI — keep dependencies free of high/critical vulnerabilities
- **All changes should be reviewed for privacy/security risk before committing** — this is a public repository
