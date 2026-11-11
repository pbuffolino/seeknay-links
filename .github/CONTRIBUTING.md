# Contributing to seeknay-links

Thanks for taking the time to help.

Building your own page? You do not need to contribute anything back. Fork the repository and follow the [customization guide](../docs/customizing.md).

## Sending a change

1. Fork the repository and create a branch (`git checkout -b fix/short-description`).
2. Make your change. Changes to `assets/links.json` also need `npm run sync-links`.
3. Run `npm run format`.
4. Run the local checks: `npm ci --ignore-scripts`, `npx playwright install chromium`, install the [lychee](https://github.com/lycheeverse/lychee) CLI, then `npm run check:local`.
5. Review the staged diff for private data, then commit and push.
6. Open a pull request with the exact candidate commit and your local check results.

## What happens next

Every code change gets an independent Codex code and security review on the exact candidate commit before merge. Hosted CodeQL is a separate required check. A changed candidate needs fresh results.

## Ground rules

- **UX changes need approval first.** Visible copy, layout, styling, controls and interaction behavior all count. Open an issue describing the change and wait for the owner's approval before building it.
- Keep the site clean, simple, fast and mobile first.
- Spell the brand `seeknay` in lowercase everywhere.
- This repository is public. Keep secrets, credentials and personal data out of code, commits, issues and pull requests.

## Reporting bugs

Use the [issue form](https://github.com/pbuffolino/seeknay-links/issues/new/choose). Include a clear description, steps to reproduce, and your browser and operating system.

Report security problems privately. See the [security policy](SECURITY.md).

## For maintainers

After merging a pull request, remove its feature branch and worktree. For squash merges, verify that the local branch tip matches the merged pull request head and that the merge commit is in `main`. Preserve uncommitted work and private notes before cleanup. Keep active and automated branches.
