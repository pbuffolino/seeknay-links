# seeknay Links

> A modern, lightweight "Linktree-style" landing page for seeknay's social media profiles and contact information.

[![Live Site](https://img.shields.io/badge/live-links.seeknay.com-4f46e5)](https://links.seeknay.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🚀 Features

- **🎨 Modern Design**: Clean, centered layout with subtle gradient backgrounds and smooth animations
- **📱 Fully Responsive**: Works seamlessly on mobile, tablet, and desktop
- **♿ Accessible**: ARIA labels, semantic HTML, keyboard navigation support
- **🔍 SEO Optimized**:
  - JSON-LD structured data for search engines
  - Open Graph and Twitter Card meta tags
  - Performance optimizations (preconnect hints)
- **📊 Analytics**: Google Analytics 4 (GA4) integration with click tracking
- **👥 Dynamic Follower Counts**: Automated follower count display for all platforms (YouTube, Instagram, TikTok, X, Bluesky) using GitHub Actions.
- **📋 Copy-to-Clipboard**: One-click email copy functionality
- **⚡ Zero Dependencies**: Pure HTML/CSS/JavaScript - no build tools required

---

## 📂 Project Structure

```text
seeknay-links/
├── assets/             # Static images and metrics
│   ├── avatar.jpg      # Profile avatar
│   ├── og.png          # Open Graph preview image
│   └── social-metrics.json # Persistent follower counts (updated by GitHub Actions)
├── css/
│   └── styles.css      # Main stylesheet with CSS custom properties
├── js/
│   ├── analytics.js    # GA4 tracking & link click event handling
│   └── followers.js    # Renders metrics from JSON
├── scripts/
│   └── update-social-metrics.mjs # GitHub Actions background update script (Node.js)
├── .github/workflows/
│   └── update-social-metrics.yml # Scheduled daily update workflow
├── index.html          # Main HTML entry point
├── package.json        # Node.js project config for background scripts
├── robots.txt          # Search engine crawler directives
├── sitemap.xml         # Site map for SEO
├── CNAME               # Custom domain configuration
└── README.md           # This file
```

---

## 🛠️ Technology Stack

- **HTML5**: Semantic markup with accessibility features
- **CSS3**: Custom properties (variables), animations, flexbox/grid
- **Vanilla JavaScript**: No frameworks - pure ES6+
- **Font Awesome 6.5.1**: Icon library (CDN)
- **Google Analytics 4**: Web analytics

---

## 🎨 Design System

### Color Palette

All colors are defined as CSS custom properties in `css/styles.css`:

| Variable         | Color     | Usage                            |
| ---------------- | --------- | -------------------------------- |
| `--bg`           | `#f8fafc` | Background (Slate 50)            |
| `--card`         | `#ffffff` | Card backgrounds                 |
| `--accent`       | `#4f46e5` | Primary accent (Indigo 600)      |
| `--text`         | `#0f172a` | Primary text (Slate 900)         |
| `--muted`        | `#64748b` | Secondary text (Slate 500)       |
| `--border`       | `#e2e8f0` | Default borders (Slate 200)      |
| `--hover-border` | `#c7d2fe` | Hover state borders (Indigo 200) |

### Shadow System

- `--shadow-sm`: Subtle elevation
- `--shadow-md`: Medium elevation (cards, hovers)
- `--shadow-lg`: High elevation (tooltips)

---

## 🤖 AI Agent Development Guide

### General Architecture

- **Type**: Static site (no build process)
- **Theme**: Light mode with gradient backgrounds
- **Layout**: Centered column (max-width: 580px)
- **Icons**: Font Awesome 6.5.1 via CDN

### File-Specific Instructions

#### `index.html`

The main entry point contains:

- **Meta tags**: SEO, Open Graph, Twitter Cards
- **JSON-LD**: Structured data for search engines
- **Hero section**: Avatar and bio (`<header class="hero">`)
- **Links section**: Social media buttons (`<nav class="links">`)
- **Contact section**: Email with copy button (`<section class="contact">`)

**Link Button Requirements:**

```html
<a class="link-button" data-link-name="Platform" <!-- REQUIRED for analytics -->
  data-link-url="https://example.com"
  <!-- REQUIRED for analytics -->
  href="https://example.com" rel="noopener noreferrer" style="--delay: 0ms">
  <!-- REQUIRED for staggered animation --></a
>
```

**Follower Count Structure:**

```html
<span class="link-info-group">
  <span class="link-label">Platform</span>
  <!-- data-network MUST match a key in assets/social-metrics.json -->
  <span class="link-followers" data-network="platform"></span>
</span>
```

#### `css/styles.css`

- All code is well-commented with section headers
- Uses CSS custom properties (`:root` variables)
- Animations: `buttonIn` keyframe for staggered entrance
- Responsive breakpoint: `640px` (tablet/desktop)

**Key Classes:**

- `.hero`: Centered flex column layout
- `.link-button`: Social link cards with hover effects
- `.copy-button`: Email copy functionality with tooltip
- `.link-followers`: Dynamically populated follower counts

#### `js/analytics.js`

- Initializes Google Analytics 4
- Intercepts link clicks for event tracking
- **Critical**: Uses `event.preventDefault()` + `setTimeout` to ensure GA4 events fire before navigation
- Events tracked: `click_link` with `link_name` and `link_url` parameters

#### `js/followers.js`

- Renders follower counts exclusively from `assets/social-metrics.json`.
- **Pure Display Logic**: Does NO fetching or API calls. All data is pre-fetched by GitHub Actions.
- **Security**: Contains NO API keys or credentials. Safe for public browsers.

### Development Rules

1. **No Build Tools**: Keep as pure static files. No npm, webpack, or bundlers unless explicitly requested.
2. **Formatting**: Use 2-space indentation. Keep code clean and commented.
3. **Relative Paths**: All asset references use relative paths (`css/styles.css`, `assets/avatar.jpg`).
4. **Accessibility**: Maintain ARIA labels, semantic HTML, and keyboard navigation.
5. **SEO**: Keep all meta tags, JSON-LD, and sitemap up to date.
6. **Performance**: Use `preconnect` for external resources, `defer` for scripts.

### Adding New Social Links

1. **Update HTML** (`index.html`):

   ```html
   <a
     class="link-button"
     data-link-name="NewPlatform"
     data-link-url="https://newplatform.com/@username"
     href="https://newplatform.com/@username"
     rel="noopener noreferrer"
     style="--delay: 250ms"
   >
     <!-- Increment delay by 50ms -->
     <span class="link-main">
       <i class="fa-brands fa-newplatform link-icon"></i>
       <span class="link-info-group">
         <span class="link-label">NewPlatform</span>
         <span class="link-followers" data-network="newplatform"></span>
       </span>
     </span>
     <i class="fa-solid fa-arrow-up-right-from-square link-arrow"></i>
   </a>
   ```

2. **Update JSON-LD** (`index.html`):
   Add the new URL to the `"sameAs"` array in the structured data script.

3. **Verify automated updates**:
   - Add logic to `scripts/update-social-metrics.mjs` to fetch count.
   - Add new key to `assets/social-metrics.json`.
   - Update `on: schedule` frequency if needed in workflow.

---

## 🧪 Local Development

### Option 1: Node.js (Recommended)

```bash
npx -y serve .
# Opens at http://localhost:3000
```

### Option 2: Python

```bash
python -m http.server 4321
# Opens at http://localhost:4321
```

### Option 3: VS Code Live Server

Install the "Live Server" extension and click "Go Live" in the bottom-right corner.

---

## 🚀 Deployment

This site is configured for **GitHub Pages** with a custom domain:

1. **Repository Settings** → **Pages**
2. **Source**: Deploy from `main` branch
3. **Custom Domain**: `links.seeknay.com` (set in `CNAME` file)
4. **SSL**: Automatically provided by GitHub Pages

## 👥 Social Metrics & GitHub Actions

This project uses a **Unified Background Update** approach for follower counts:

1. **Source of Truth**: `assets/social-metrics.json`
2. **Mechanism**: `scripts/update-social-metrics.mjs` runs via GitHub Actions.
3. **Schedule**: Daily (at 2:17 PM UTC) to keep metrics fresh while maintaining API limits.

### 🔒 Security & GitHub Secrets

**NEVER commit API keys or tokens to this repository.** This is a public repository. All credentials MUST be stored in **GitHub Secrets**.

To set up the automated updates:

1. Go to your repository on GitHub.
2. Navigate to **Settings** → **Secrets and variables** → **Actions**.
3. Add the following secrets:

| Secret Name         | Platform  | Usage                             |
| ------------------- | --------- | --------------------------------- |
| `YT_API_KEY`        | YouTube   | YouTube Data API v3 Key           |
| `YT_CHANNEL_ID`     | YouTube   | Your Channel ID (e.g. `UC...`)    |
| `IG_ACCESS_TOKEN`   | Instagram | Long-lived Graph API Token        |
| `IG_USER_ID`        | Instagram | Your Instagram Business ID        |
| `TIKTOK_SESSION_ID` | TikTok    | `sessionid` cookie from browser   |
| `TIKTOK_MS_TOKEN`   | TikTok    | `msToken` cookie from browser     |
| `TIKTOK_USERNAME`   | TikTok    | Your username (e.g. `seeknay747`) |
| `X_BEARER_TOKEN`    | X/Twitter | API v2 Bearer Token               |
| `X_USERNAME`        | X/Twitter | Your username (without @)         |
| `BSKY_HANDLE`       | Bluesky   | Your handle (e.g. `seeknay.com`)  |

### Troubleshooting

- **Last Known Count**: If an API call fails or a token expires, the site will continue to show the last successful count stored in `assets/social-metrics.json`.
- **Manual Trigger**: You can manually trigger an update from the **Actions** tab by selecting the "Update Social Metrics" workflow and clicking "Run workflow".

---

## 📊 Analytics

- **Platform**: Google Analytics 4
- **Property ID**: `G-C9JSC7H6WW` (configured in `index.html`)
- **Events Tracked**:
  - Page views (automatic)
  - Link clicks (`click_link` event with `link_name` and `link_url`)

---

## 🔧 Customization

### Changing Colors

Edit CSS custom properties in `css/styles.css`:

```css
:root {
  --accent: #4f46e5; /* Change primary accent color */
  --bg: #f8fafc; /* Change background color */
}
```

### Updating Bio/Tagline

Edit the `<p class="tagline">` in `index.html`:

```html
<p class="tagline">Your New Bio Here</p>
```

Also update meta descriptions for SEO consistency.

### Adding/Removing Links

- Add/remove `<a class="link-button">` elements in the `<nav class="links">` section
- Update `style="--delay: Xms"` incrementally (0ms, 50ms, 100ms, etc.)
- Update JSON-LD `"sameAs"` array

---

## 📝 License

MIT License - feel free to fork and customize for your own use!

---

## 🙏 Acknowledgments

- **Font Awesome**: Icon library
- **Google Fonts**: Inter font family (system fallback chain)
- **Bluesky AT Protocol**: Follower count API

---

**Built with ❤️ by seeknay using Google's Antigravity, Gemini, and Claude Sonnet**  
🌐 [seeknay.com](https://seeknay.com) | 🔗 [links.seeknay.com](https://links.seeknay.com)
