<div align="center">

# 🔗 seeknay Links

**An open-source link-in-bio template. Fork it, customize it, deploy it for free.**

A self-hosted alternative to Linktree, built with no frameworks and no build step. Just vanilla HTML, CSS, and JavaScript, all driven by simple JSON files.

[![Live Site](https://img.shields.io/badge/🌐_Visit_Site-links.seeknay.com-4f46e5?style=for-the-badge)](https://links.seeknay.com/)
[![CI](https://img.shields.io/github/actions/workflow/status/pbuffolino/seeknay-links/ci.yml?style=for-the-badge&label=CI)](https://github.com/pbuffolino/seeknay-links/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-222?style=for-the-badge&logo=githubpages&logoColor=white)

[**Live Demo**](https://links.seeknay.com/) · [**Report Bug**](https://github.com/pbuffolino/seeknay-links/issues/new/choose) · [**Request Feature**](https://github.com/pbuffolino/seeknay-links/issues/new/choose)

![Preview of seeknay links page](assets/og.png)

</div>

---

## Features

| Feature                   | Description                                                    |
| ------------------------- | -------------------------------------------------------------- |
| **🎨 Modern Design**      | Glass-style cards, smooth animations, and a clean look         |
| **🌓 Dark/Light Mode**    | Theme toggle built in                                          |
| **📱 Mobile Friendly**    | Responsive layout for phones, tablets, and desktops            |
| **📊 Follower Counts**    | Displays live follower counts fetched daily via GitHub Actions |
| **📈 Analytics**          | GA4 event tracking for link clicks                             |
| **🔗 Easy Sharing**       | Share button with Web Share API fallback                       |
| **⭐ Featured Spotlight** | Highlight a piece of content with a special card               |
| **⚡ Fast Loading**       | No heavy frameworks; minimal, dependency-free code             |

---

## Fork and Customize

### 1. Fork and clone

```bash
git clone https://github.com/YOUR_USERNAME/seeknay-links.git
cd seeknay-links
```

### 2. Replace profile content

- Swap `assets/avatar.jpg` with your photo
- Edit the name, bio, and spotlight card in `index.html` (search for `<!-- Profile Section -->` and `<!-- Spotlight Section -->`)
- Update the spotlight card's `href`, `h3`, `p`, and `data-link-name` attributes

### 3. Update your links

Edit `assets/links.json`. This file drives all the link cards:

```json
{
  "name": "Platform Name",
  "url": "https://yourlink.com",
  "icon": "fa-brands fa-icon-name",
  "networkId": "optional-id-for-metrics",
  "delay": 300
}
```

- **icon**: Find names at [Font Awesome](https://fontawesome.com/icons)
- **delay**: Animation stagger in milliseconds
- **networkId**: Matches a key in `assets/social-metrics.json` to display follower counts; set to `null` if not used

### 4. Set your accent color

Edit the top of `css/styles.css`:

```css
:root {
  --accent: #4f46e5; /* Main accent color */
  --bg: #f8fafc; /* Background color */
}
```

### 5. Set up analytics (optional)

Replace the GA4 measurement ID in `index.html`:

```html
<script src="https://www.googletagmanager.com/gtag/js?id=YOUR-ID-HERE"></script>
```

Remove both the GTM script tag and the `gtag` initialization block entirely if you don't want analytics.

### 6. Deploy to GitHub Pages

1. Push to a GitHub repository
2. Go to **Settings** → **Pages**
3. Set source to **Deploy from a branch**, select `main`
4. (Optional) Add a custom domain

The site will be live at `https://yourusername.github.io/repo-name/`.

---

## Follower Counts

A GitHub Actions workflow runs daily at 14:17 UTC, fetches counts from each platform's API, and commits the results to `assets/social-metrics.json`. The page reads that file on load.

**Supported platforms:** TikTok, YouTube, Instagram, Bluesky, Facebook

### Required secrets

Add these to **Repository Settings → Secrets and variables → Actions**:

| Secret Name            | Platform  | What It Is                                                         |
| ---------------------- | --------- | ------------------------------------------------------------------ |
| `YT_API_KEY`           | YouTube   | YouTube Data API v3 key                                            |
| `YT_CHANNEL_ID`        | YouTube   | Your channel ID                                                    |
| `IG_ACCESS_TOKEN`      | Instagram | Facebook Graph API token                                           |
| `IG_USER_ID`           | Instagram | Your Instagram user ID                                             |
| `TIKTOK_SESSION_ID`    | TikTok    | `sessionid` cookie from browser                                    |
| `TIKTOK_MS_TOKEN`      | TikTok    | `msToken` cookie from browser                                      |
| `TIKTOK_USERNAME`      | TikTok    | Your TikTok username                                               |
| `BSKY_HANDLE`          | Bluesky   | Your Bluesky handle                                                |
| `FB_PAGE_ACCESS_TOKEN` | Facebook  | Facebook Page access token                                         |
| `FB_PAGE_ID`           | Facebook  | Your Facebook Page ID                                              |
| `METRICS_PAT`          | GitHub    | Personal access token used to open the daily metrics PR so CI runs |

> **Tip:** If a token expires or an API call fails, the site keeps showing the last cached count from `social-metrics.json`.

### Adding a new platform

1. Add a link entry to `assets/links.json` with a `networkId`
2. Add a fetch handler in `scripts/update-social-metrics.mjs`
3. Add the required secrets to `.github/workflows/update-social-metrics.yml`

---

## Project Structure

```
seeknay-links/
├── assets/
│   ├── avatar.jpg                     # Profile picture
│   ├── og.png                         # Open Graph preview image
│   ├── links.json                     # Source of truth for link cards
│   └── social-metrics.json            # Follower counts (auto-updated daily)
├── css/
│   └── styles.css                     # All styling; CSS custom properties for theming
├── js/
│   ├── analytics.js                   # GA4 event tracking
│   ├── followers.js                   # Renders follower counts
│   ├── links.js                       # Renders link cards from links.json
│   └── ui.js                          # Theme toggle and share button
├── scripts/
│   └── update-social-metrics.mjs      # Fetches live metrics (runs in CI)
├── .github/workflows/
│   ├── ci.yml                         # Lint + link-check + audit on push/PR
│   └── update-social-metrics.yml      # Daily metrics update
└── index.html                         # Single-page entry point
```

---

## Local Development

No build step or local server is required. Open `index.html` directly in a browser. The only tooling is for linting and formatting:

```bash
npm install        # Install dev dependencies (ESLint, Prettier)
npm run lint       # ESLint + Prettier check (also runs as `npm test`)
npm run format     # Auto-fix formatting with Prettier
```

CI runs `lint → link-check (Lychee) → npm audit` on every push and pull request.

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the workflow and coding standards before opening a pull request.

---

## Security

Found a vulnerability? Please follow the responsible-disclosure process in [SECURITY.md](.github/SECURITY.md). Do not open a public issue.

---

## License

MIT. Free to fork, customize, and use for your own link-in-bio page. See [LICENSE](LICENSE).
