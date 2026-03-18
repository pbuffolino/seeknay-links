/**
 * ANALYTICS MODULE
 * Initializes Google Analytics 4 (GA4) conditionally based on user cookie consent.
 * Consent state is persisted in localStorage under the key 'analytics_consent'.
 * Values: 'granted' | 'denied' | absent (no decision yet — show banner)
 *
 * H1 FIX: GA4 is never loaded without explicit user consent.
 */

const GA_ID = "G-C9JSC7H6WW";
const CONSENT_KEY = "analytics_consent";

function loadGA() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(script);

  window.gtag("js", new Date());
  window.gtag("config", GA_ID, { anonymize_ip: true });
}

function initConsent() {
  const consent = localStorage.getItem(CONSENT_KEY);

  if (consent === "granted") {
    loadGA();
    return;
  }

  if (consent === "denied") {
    return;
  }

  // No decision yet — show the banner
  const banner = document.getElementById("cookie-consent-banner");
  if (!banner) return;
  banner.hidden = false;

  document.getElementById("consent-accept").addEventListener("click", function () {
    localStorage.setItem(CONSENT_KEY, "granted");
    banner.hidden = true;
    loadGA();
  });

  document.getElementById("consent-decline").addEventListener("click", function () {
    localStorage.setItem(CONSENT_KEY, "denied");
    banner.hidden = true;
  });
}

// Link click tracking — only fires if gtag is available (i.e., consent was granted)
document.addEventListener("click", function (event) {
  const anchor = event.target.closest("a[data-link-name]");
  if (!anchor) return;

  const href = anchor.getAttribute("href");
  if (!href) return;

  if (typeof window.gtag !== "function") return;

  window.gtag("event", "link_click", {
    link_name: anchor.dataset.linkName || anchor.textContent.trim(),
    link_url: anchor.dataset.linkUrl || href,
    transport: "beacon",
  });
});

document.addEventListener("DOMContentLoaded", initConsent);
