# Contributing to seeknay-links

First off, thanks for taking the time to contribute!

## How to Contribute

1. **Fork the repository**
2. **Create a new branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Run tests** (`npm test`) - This runs lint, formatting, unit tests, and site validation
5. **Commit your changes** (`git commit -m 'feat: Add amazing feature'`)
6. **Run browser checks** (`npx playwright install chromium && npm run test:browser`)
7. **Push to the branch** (`git push origin feature/amazing-feature`)
8. **Open a Pull Request**

## Coding Standards

- Every UX change requires explicit approval from the repository owner before implementation or publication. This includes changes to visible copy, layout, styling, controls, and interaction behavior. General repair instructions do not authorize UX changes. Present the proposed change and wait for approval.
- Keep the site clean, simple, fast, and mobile first. Favor essential content and compact layouts.
- We use **ESLint** and **Prettier** to maintain code quality.
- Run `npm run format` to automatically format your code before committing.
- Ensure all links are valid.

## Reporting Bugs

Please include:

- A clear description of the issue
- Steps to reproduce
- Browser and OS version

Changes to `assets/links.json` require `npm run sync-links`. Review the staged diff for private data before committing. Keep commit messages and PR descriptions focused on the public implementation.
