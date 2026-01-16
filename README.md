# seeknay Links

> 🔗 My personal link-in-bio page — one place for all my social profiles and contact info.

[![Live Site](https://img.shields.io/badge/🌐_Visit_Site-links.seeknay.com-4f46e5?style=for-the-badge)](https://links.seeknay.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

![Preview of seeknay links page](assets/og.png)

---

## 👋 What Is This?

This is the source code for my personal "link-in-bio" landing page at [links.seeknay.com](https://links.seeknay.com/). Think of it like Linktree, but built from scratch with a modern design.

**Why build my own?** Full control over the design, no subscriptions, and I get to track my own analytics!

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **🎨 Modern Design** | Glass-style cards, smooth animations, and a clean look |
| **🌓 Dark/Light Mode** | Click the moon icon to switch themes |
| **📱 Mobile Friendly** | Looks great on phones, tablets, and desktops |
| **📊 Follower Counts** | Automatically displays my follower counts across platforms |
| **📈 Analytics** | Tracks which links get clicked (using Google Analytics) |
| **🔗 Easy Sharing** | Click the share button to send my page to others |
| **⚡ Fast Loading** | No heavy frameworks — just clean, simple code |

---

## 🌐 Live Site

**Visit:** [links.seeknay.com](https://links.seeknay.com/)

The site updates automatically whenever I push changes to this repository.

---

## 🚀 Quick Start (For Developers)

Want to run this locally or fork it for yourself? Here's how:

### Prerequisites

- A web browser (Chrome, Firefox, Edge, Safari)
- [Node.js](https://nodejs.org/) (optional, for local server)

### Run Locally

```bash
# Clone the repository
git clone https://github.com/pbuffolino/seeknay-links.git
cd seeknay-links

# Start a local server (pick one):
npx -y serve .              # Node.js method
python -m http.server 3000  # Python method
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📂 Project Structure

```
seeknay-links/
├── assets/                 # Images and data
│   ├── avatar.jpg          # My profile picture
│   ├── og.png              # Image shown when sharing links
│   └── social-metrics.json # Follower counts (auto-updated daily)
├── css/
│   └── styles.css          # All the styling
├── js/
│   ├── analytics.js        # Google Analytics tracking
│   ├── followers.js        # Displays follower counts
│   └── ui.js               # Theme toggle and share button
├── scripts/
│   └── update-social-metrics.mjs  # Script that fetches follower counts
├── .github/workflows/
│   └── update-social-metrics.yml  # Runs the script daily
├── index.html              # The main page
├── robots.txt              # Instructions for search engines
├── sitemap.xml             # Helps search engines find the page
└── README.md               # You're reading this!
```

---

## 🎨 Customization

### Want to use this for yourself?

1. **Fork this repository**
2. **Replace my info with yours:**
   - Update `assets/avatar.jpg` with your photo
   - Edit the name and bio in `index.html`
   - Change the social links to your profiles
3. **Deploy for free** using [GitHub Pages](https://pages.github.com/)

### Changing Colors

Edit the colors at the top of `css/styles.css`:

```css
:root {
  --accent: #4f46e5;  /* Main accent color (purple) */
  --bg: #f8fafc;      /* Background color */
}
```

### Adding a New Social Link

Add this HTML inside the `<nav class="links">` section:

```html
<a class="link-button" href="https://yourlink.com" rel="noopener noreferrer">
  <span class="link-main">
    <i class="fa-brands fa-icon-name link-icon"></i>
    <span class="link-label">Platform Name</span>
  </span>
</a>
```

Find icon names at [Font Awesome](https://fontawesome.com/icons).

---

## 📊 How Follower Counts Work

The page shows live follower counts for each platform. Here's how it works:

1. **Daily Automation**: A GitHub Action runs once per day
2. **Fetches Data**: It contacts each platform's API to get current counts
3. **Saves Results**: The counts are saved to `assets/social-metrics.json`
4. **Displays on Site**: The page reads this file and shows the numbers

**Platforms Supported:**
- TikTok
- YouTube
- Instagram
- Bluesky
- Facebook

### Setting Up Follower Counts (For Your Own Fork)

You'll need API credentials for each platform. Store them securely in **GitHub Secrets** (never in the code!).

Go to: **Repository Settings** → **Secrets and variables** → **Actions**

| Secret Name | Platform | What It Is |
|-------------|----------|------------|
| `YT_API_KEY` | YouTube | Your YouTube API key |
| `YT_CHANNEL_ID` | YouTube | Your channel ID |
| `IG_ACCESS_TOKEN` | Instagram | Facebook Graph API token |
| `IG_USER_ID` | Instagram | Your Instagram user ID |
| `TIKTOK_SESSION_ID` | TikTok | Session cookie from browser |
| `TIKTOK_USERNAME` | TikTok | Your TikTok username |
| `BSKY_HANDLE` | Bluesky | Your Bluesky handle |
| `FB_PAGE_ACCESS_TOKEN` | Facebook | Facebook Page access token |
| `FB_PAGE_ID` | Facebook | Your Facebook Page ID |

> 💡 **Tip:** If a token expires or API fails, the site keeps showing the last known count.

---

## 🚀 Deployment

This site is hosted for **free** on [GitHub Pages](https://pages.github.com/).

### How to Deploy Your Own

1. Push your code to a GitHub repository
2. Go to **Settings** → **Pages**
3. Under "Source," select **Deploy from a branch**
4. Choose the `main` branch
5. (Optional) Add a custom domain in the **Custom domain** field

Your site will be live at `https://yourusername.github.io/repo-name/`

---

## 📈 Analytics

The site uses **Google Analytics 4** to track:
- Page views
- Which links get clicked
- Device and location info (anonymized)

To use your own analytics, replace the GA4 ID in `index.html`:

```html
<script src="https://www.googletagmanager.com/gtag/js?id=YOUR-ID-HERE"></script>
```

---

## 🛡️ Security

- ✅ **No API keys in code** — all secrets stored in GitHub Secrets
- ✅ **Content Security Policy** — restricts what scripts can run
- ✅ **IP anonymization** — respects visitor privacy in analytics
- ✅ **HTTPS enforced** — via GitHub Pages

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| HTML5 | Page structure |
| CSS3 | Styling and animations |
| Vanilla JavaScript | Interactivity (no frameworks!) |
| Font Awesome | Icons |
| GitHub Actions | Automated follower count updates |
| GitHub Pages | Free hosting |

---

## 📝 License

This project is open source under the **MIT License**. 

Feel free to fork it, customize it, and use it for your own link-in-bio page!

---

## 🙏 Acknowledgments

- [Font Awesome](https://fontawesome.com/) — Icon library
- [Google Antigravity](https://antigravity.google/) — AI coding assistant that helped build this
- [GitHub Pages](https://pages.github.com/) — Free hosting

---

## 📬 Contact

- **Website:** [seeknay.com](https://seeknay.com)
- **Links Page:** [links.seeknay.com](https://links.seeknay.com)
- **Email:** contact@seeknay.com

---

<p align="center">
  <strong>Built with ❤️ by <a href="https://seeknay.com">seeknay</a> using <a href="https://antigravity.google/">Google Antigravity</a></strong>
</p>
