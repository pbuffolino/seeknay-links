<div align="center">

<img src="assets/avatar-192.jpg" width="96" height="96" alt="seeknay" />

# seeknay links

**A fast, tiny link-in-bio page you can make your own in ten minutes.**

Plain HTML, CSS and JavaScript. No framework. No build step. Free to host.

[**See it live**](https://links.seeknay.com/) · [Make it yours](#-make-it-yours) · [Report a bug](https://github.com/pbuffolino/seeknay-links/issues/new/choose)

![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f)
![No build step](https://img.shields.io/badge/build%20step-none-blue)
![Hosted on GitHub Pages](https://img.shields.io/badge/hosted%20on-GitHub%20Pages-222)

</div>

## ✨ What you get

- ⚡ **Instant loads.** Static files served straight from GitHub Pages.
- 🔗 **One file for your links.** Edit `assets/links.json` and you are done.
- 📈 **Live follower counts.** An optional daily GitHub Action refreshes TikTok, YouTube, Instagram, Bluesky and Facebook totals.
- 🌗 **Light and dark themes**, mobile first.
- ♿ **Accessibility tested** in both themes, and the links still work with JavaScript turned off.
- 🔒 **Private by default.** Strict Content Security Policy, local icons, and analytics that load only after a visitor says yes.

## 🚀 Quick start

```bash
git clone https://github.com/pbuffolino/seeknay-links.git
cd seeknay-links
npm ci
npm run serve   # http://127.0.0.1:4173
```

Use the local server instead of opening `index.html` directly. The page fetches its JSON over HTTP.

## 🎨 Make it yours

Fork it, clone it, rename it. That is what it is here for.

1. **Links.** Edit `assets/links.json`, then run `npm run sync-links`.
2. **Identity.** Change the name, bio, titles and social metadata in `index.html`. Replace the avatar and share images in `assets/`.
3. **Colors.** Adjust the custom properties at the top of `css/styles.css`.
4. **Domain.** Put your hostname in `CNAME`, or delete the file to use the default GitHub Pages address. Update the canonical URL in `index.html`.
5. **Analytics.** Set your own `GA_ID` in `js/analytics.js`, or set it to an empty string to turn analytics off.
6. **Deploy.** In your repository, open Settings → Pages and publish `main` from `/ (root)`.

The [customization guide](docs/customizing.md) covers every step in detail. Follower counts need a few repository secrets, explained in the [metrics guide](docs/metrics.md).

## 🧰 Commands

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm run serve`        | Serve the site locally                                    |
| `npm run sync-links`   | Rebuild the saved navigation after editing `links.json`   |
| `npm run format`       | Format the code and refresh asset version hashes          |
| `npm test`             | Lint, unit tests and site validation                      |
| `npm run test:browser` | Browser and accessibility checks (needs Playwright)       |
| `npm run check:local`  | Everything above plus a dependency audit and link checker |

## 📚 More

- [Customization guide](docs/customizing.md)
- [Follower metrics](docs/metrics.md)
- [Edge and header configuration](docs/edge-configuration.md)
- [Security and health operations](docs/security-operations.md)
- [Contributing](.github/CONTRIBUTING.md) · [Security policy](.github/SECURITY.md)

## 📄 License

[MIT](LICENSE). Use it, change it, ship it under your own name. Keep the license file, and please swap out my name, avatar, links and analytics ID before you publish.

The bundled Font Awesome icons are CC BY 4.0. See [their license](assets/icons/LICENSE.txt).
