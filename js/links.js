/**
 * LINKS LOADER
 * Fetches links from assets/links.json and renders them to the DOM.
 */

const LINKS_URL = "assets/links.json";
const CONTAINER_ID = "links-container";

async function loadLinks() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  try {
    const response = await fetch(LINKS_URL);
    if (!response.ok) throw new Error("Failed to load links");
    const links = await response.json();

    renderLinks(links, container);
  } catch (error) {
    console.error("Error loading links:", error);
    // Fallback or error UI could go here
    container.innerHTML = `<p style="text-align:center; color: var(--muted);">Unable to load links.</p>`;
  }
}

function renderLinks(links, container) {
  const fragment = document.createDocumentFragment();

  links.forEach((link) => {
    // L3: Validate URL to prevent javascript: injection from a compromised links.json
    const url = link.url;
    if (typeof url !== "string" || (!url.startsWith("https://") && !url.startsWith("http://"))) {
      return;
    }

    const a = document.createElement("a");
    a.className = "link-button";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    // Accessibility & Tracking Data
    a.dataset.linkName = link.name;
    a.dataset.linkUrl = link.url;

    // Animation Delay
    // We set the style directly for the animation delay variable
    a.style.setProperty("--delay", `${link.delay}ms`);

    // Inner HTML Structure
    const linkMain = document.createElement("span");
    linkMain.className = "link-main";

    const icon = document.createElement("i");
    icon.className = `${link.icon} link-icon`;
    icon.setAttribute("aria-hidden", "true");

    const infoGroup = document.createElement("span");
    infoGroup.className = "link-info-group";

    const label = document.createElement("span");
    label.className = "link-label";
    label.textContent = link.name; // Safe XSS prevention

    infoGroup.appendChild(label);

    if (link.networkId) {
      const networkSpan = document.createElement("span");
      networkSpan.className = "link-followers";
      networkSpan.dataset.network = link.networkId;
      infoGroup.appendChild(networkSpan);
    }

    linkMain.appendChild(icon);
    linkMain.appendChild(infoGroup);

    const arrow = document.createElement("i");
    arrow.className = "fa-solid fa-arrow-up-right-from-square link-arrow";
    arrow.setAttribute("aria-hidden", "true");

    a.appendChild(linkMain);
    a.appendChild(arrow);

    fragment.appendChild(a);
  });

  container.appendChild(fragment);

  // Trigger followers update if the followers script is loaded
  if (window.updateSocialCounts) {
    window.updateSocialCounts();
  }
}

// Initialize on DOM Ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadLinks);
} else {
  loadLinks();
}
