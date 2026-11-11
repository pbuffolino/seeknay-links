/* global gtag */
// Theme toggling and share functionality.
const body = document.body;
let toastTimeout = null;

function applyTheme(isDark) {
  body.classList.toggle("dark-mode", isDark);
  const themeBtn = document.getElementById("theme-toggle");
  const icon = themeBtn?.querySelector("i");
  if (icon) {
    icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
    themeBtn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", getComputedStyle(body).getPropertyValue("--bg").trim());
}

function initTheme() {
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("theme");
  } catch {
    // localStorage unavailable (e.g. Safari private browsing)
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme === "dark" || (!savedTheme && prefersDark));
}

function toggleTheme() {
  const isDark = !body.classList.contains("dark-mode");
  applyTheme(isDark);
  try {
    localStorage.setItem("theme", isDark ? "dark" : "light");
  } catch {
    // localStorage unavailable
  }
  if (typeof gtag === "function") {
    gtag("event", "theme_toggle", { theme: isDark ? "dark" : "light" });
  }
}

/**
 * SHARE FUNCTIONALITY
 */
async function shareProfile() {
  const shareData = {
    title: "seeknay",
    text: "Check out seeknay's links!",
    url: window.location.href,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      // Fallback for desktop/unsupported browsers
      await navigator.clipboard.writeText(window.location.href);
      showToast("Link copied to clipboard!");
    }

    if (typeof gtag === "function") {
      gtag("event", "share", { method: navigator.share ? "native" : "clipboard" });
    }
  } catch (err) {
    if (err.name !== "AbortError")
      showToast("Could not share this link. Copy the address from your browser.");
  }
}

function showToast(message) {
  let toast = document.getElementById("ui-toast");

  // Create if doesn't exist
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "ui-toast";
    toast.className = "toast-notification";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  toast.textContent = message;

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  // Restart the hide timer so rapid clicks don't hide the toast early.
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2500);
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  document.querySelector(".header-actions")?.removeAttribute("hidden");

  initTheme();
  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
  document.getElementById("share-profile")?.addEventListener("click", shareProfile);
});
