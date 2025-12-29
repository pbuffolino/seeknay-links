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
- **👥 Dynamic Follower Counts**: Real-time follower count display for supported platforms (Bluesky)
- **📋 Copy-to-Clipboard**: One-click email copy functionality
- **⚡ Zero Dependencies**: Pure HTML/CSS/JavaScript - no build tools required

---

## 📂 Project Structure

```text
seeknay-links/
├── assets/             # Static images
│   ├── avatar.jpg      # Profile avatar
│   └── og.png          # Open Graph preview image
├── css/
│   └── styles.css      # Main stylesheet with CSS custom properties
├── js/
│   ├── analytics.js    # GA4 tracking & link click event handling
│   └── followers.js    # Dynamic follower count fetching (Bluesky API)
├── index.html          # Main HTML entry point
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

| Variable | Color | Usage |
|----------|-------|-------|
| `--bg` | `#f8fafc` | Background (Slate 50) |
| `--card` | `#ffffff` | Card backgrounds |
| `--accent` | `#4f46e5` | Primary accent (Indigo 600) |
| `--text` | `#0f172a` | Primary text (Slate 900) |
| `--muted` | `#64748b` | Secondary text (Slate 500) |
| `--border` | `#e2e8f0` | Default borders (Slate 200) |
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
<a class="link-button" 
   data-link-name="Platform"           <!-- REQUIRED for analytics -->
   data-link-url="https://example.com" <!-- REQUIRED for analytics -->
   href="https://example.com"
   rel="noopener noreferrer"
   style="--delay: 0ms">               <!-- REQUIRED for staggered animation -->
```

**Follower Count Structure:**
```html
<span class="link-info-group">
  <span class="link-label">Platform</span>
  <span class="link-followers" data-network="platform"></span> <!-- Updated by followers.js -->
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
- Fetches real-time follower counts from platform APIs
- **Currently Supported**: Bluesky (via AT Protocol API)
- **Extensible**: Add TikTok, YouTube, Instagram by implementing their APIs
- Gracefully fails if API is unavailable (no follower count shown)

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
   <a class="link-button" 
      data-link-name="NewPlatform" 
      data-link-url="https://newplatform.com/@username"
      href="https://newplatform.com/@username" 
      rel="noopener noreferrer" 
      style="--delay: 250ms"> <!-- Increment delay by 50ms -->
     <span class="link-main">
       <i class="fa-brands fa-newplatform link-icon"></i>
       <span class="link-label">NewPlatform</span>
     </span>
     <i class="fa-solid fa-arrow-up-right-from-square link-arrow"></i>
   </a>
   ```

2. **Update JSON-LD** (`index.html`):
   Add the new URL to the `"sameAs"` array in the structured data script.

3. **(Optional) Add Follower Count**:
   Extend `js/followers.js` to fetch and display follower counts for the new platform.

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

**Deployment is automatic**: Push to `main` branch and changes go live within ~1 minute.

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
  --accent: #4f46e5;  /* Change primary accent color */
  --bg: #f8fafc;      /* Change background color */
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
