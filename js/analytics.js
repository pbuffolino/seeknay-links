const GA_ID = "G-C9JSC7H6WW";
const CONSENT_KEY = "analytics_consent";
let consent = null;
let loaded = false;

function saveConsent(value) {
  consent = value;
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // This page's choice still applies when persistent storage is unavailable.
  }
}

function loadGA() {
  window[`ga-disable-${GA_ID}`] = false;
  if (loaded || !GA_ID) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    if (consent === "granted") window.dataLayer.push(arguments);
  };
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
  document.head.appendChild(script);
  window.gtag("js", new Date());
  window.gtag("config", GA_ID);
}

function revokeGA() {
  window[`ga-disable-${GA_ID}`] = true;
  window.gtag = undefined;
  // Clear cookies visible to this host, including cookies set on a parent domain.
  const domains = location.hostname.split(".");
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0];
    if (!/^_ga(?:_|$)/.test(name)) continue;
    document.cookie = `${name}=; Max-Age=0; path=/`;
    for (let i = 0; i < domains.length - 1; i++) {
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${domains.slice(i).join(".")}`;
    }
  }
}

function initConsent() {
  if (!GA_ID) return;
  try {
    consent = localStorage.getItem(CONSENT_KEY);
  } catch {
    consent = null;
  }
  const banner = document.getElementById("cookie-consent-banner");
  const accept = document.getElementById("consent-accept");
  const decline = document.getElementById("consent-decline");
  const settings = document.getElementById("privacy-settings");
  if (!banner || !accept || !decline || !settings) return;
  if (consent === "granted") loadGA();
  banner.hidden = consent === "granted" || consent === "denied";
  settings.hidden = false;
  settings.addEventListener("click", () => {
    banner.hidden = false;
    decline.focus();
  });
  accept.addEventListener("click", () => {
    saveConsent("granted");
    banner.hidden = true;
    // Reload after revocation so an existing GA instance cannot resume independently.
    if (loaded) location.reload();
    else loadGA();
  });
  decline.addEventListener("click", () => {
    saveConsent("denied");
    revokeGA();
    banner.hidden = true;
  });
}

document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[data-link-name]");
  if (!anchor || consent !== "granted" || typeof window.gtag !== "function") return;
  window.gtag("event", "link_click", {
    link_name: anchor.dataset.linkName || anchor.textContent.trim(),
    link_url: anchor.href,
    transport: "beacon",
  });
});
initConsent();
