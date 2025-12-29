# seeknay Links

A lightweight, static "Linktree-style" landing page for Seeknay.

## 📂 Project Structure

```text
.
├── assets/          # Static images (avatar, icons)
├── css/
│   └── styles.css   # Main stylesheet (CSS Variables, Animations)
├── js/
│   ├── analytics.js # GA4 tracking & link click handling
│   └── followers.js # Dynamic follower count fetching (Bluesky etc.)
├── index.html       # Main HTML entry point
├── README.md
└── robots.txt
```

## 🤖 AI Agent Instructions

### 1. General Architecture
- **Type**: Static Site (HTML/CSS/JS).
- **Theme**: Light mode with gradient backgrounds. Controlled via `:root` variables in `css/styles.css`.
- **Icons**: Font Awesome 6.5.1 (CDN).

### 2. File Specifics

#### `index.html`
- **Link Buttons**: Located in `<nav class="links">`.
- **Requirements**:
  - `data-link-name` & `data-link-url`: REQUIRED for `analytics.js`.
  - `style="--delay: Xms"`: REQUIRED for staggered entrance animations.
  - **Follower Counts**: Inside `.link-info-group` -> `.link-followers` with `data-network="..."`.

#### `js/followers.js`
- Handles fetching follower counts from APIs.
- Currently supports: **Bluesky**.
- **Expansion**: To add TikTok/YouTube, enable their APIs in this file. If an API requires a key, ensure it is handled securely or via a proxy if possible (though this is a static site).

#### `js/analytics.js`
- Intercepts clicks for GA4 tracking.
- **Critical**: Do not remove `event.preventDefault()` logic on links unless replacing with a beacon/navigator.sendBeacon approach, as it ensures data is sent before navigation.

### 3. Development Rules
- **No Build Tools**: Maintain as pure static files. Do not introduce npm/webpack unless explicitly requested.
- **Formatting**: Keep code clean and indented (2 spaces).
- **Paths**: dynamic assets use relative paths (e.g. `css/styles.css`).

### 4. Local Testing
```bash
python -m http.server 4321
# Open http://localhost:4321
```
