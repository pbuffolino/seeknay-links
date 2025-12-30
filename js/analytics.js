/**
 * ANALYTICS MODULE
 * Initializes Google Analytics 4 (GA4) and handles event tracking.
 * - Tracks 'link_click' events with custom parameters
 * - Handles 'contact_copy' events
 */
window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments);
}

gtag("js", new Date());
gtag("config", "G-C9JSC7H6WW", { anonymize_ip: true });

const linkSelector = "a[data-link-name]";

const sendLinkEvent = (linkName, linkUrl) => {
  if (typeof gtag !== "function") {
    return;
  }

  gtag("event", "link_click", {
    link_name: linkName,
    link_url: linkUrl,
    transport: "beacon",
  });
};

document.addEventListener("click", (event) => {
  const anchor = event.target.closest(linkSelector);
  if (!anchor) {
    return;
  }

  const href = anchor.getAttribute("href");
  if (!href) {
    return;
  }

  const linkName = anchor.dataset.linkName || anchor.textContent.trim();
  const linkUrl = anchor.dataset.linkUrl || href;

  sendLinkEvent(linkName, linkUrl);
});

const copyText = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

const copyButtons = document.querySelectorAll("[data-copy]");
copyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const text = button.dataset.copy;
    if (!text) {
      return;
    }

    try {
      await copyText(text);
    } catch (error) {
      return;
    }

    button.classList.add("is-copied");

    if (typeof gtag === "function") {
      gtag("event", "contact_copy", { method: "clipboard" });
    }

    if (button.copyTimer) {
      clearTimeout(button.copyTimer);
    }

    button.copyTimer = setTimeout(() => {
      button.classList.remove("is-copied");
    }, 2000);
  });
});
