# CLAUDE.md — seeknay-links

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

- **Formatting:** 2-space indent, double quotes, ES5 trailing commas, 100-char line width (Prettier)
- **CSP:** No inline scripts in HTML — the Content Security Policy in `index.html` enforces this
- **Secrets:** No hardcoded credentials anywhere — all secrets via GitHub Actions environment variables
- **Adding a new social platform:** add an entry to `assets/links.json` and add a handler in `scripts/update-social-metrics.mjs`

---

## Things to Be Careful About

- `assets/social-metrics.json` is auto-managed by CI; manual edits will be overwritten on the next daily run
- The CSP in `index.html` must be updated if new external script or style domains are added
- `npm audit --audit-level=high` runs in CI — keep dependencies free of high/critical vulnerabilities
- **All changes should be reviewed for privacy/security risk before committing** — this is a public repository
