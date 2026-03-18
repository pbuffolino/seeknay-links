/**
 * UI CONTROLLER
 * Handles Theme Toggling and Share functionality.
 */
/* global gtag */

// DOM Elements
const body = document.body;

// Stored timeout ID for toast (prevents race condition on rapid clicks)
let toastTimeout = null;

/**
 * THEME MANAGEMENT
 */
function initTheme() {
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("theme");
  } catch {
    // localStorage unavailable (e.g. Safari private browsing)
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
    body.classList.add("dark-mode");
  }
}

function toggleTheme() {
  body.classList.toggle("dark-mode");
  const isDark = body.classList.contains("dark-mode");

  try {
    localStorage.setItem("theme", isDark ? "dark" : "light");
  } catch {
    // localStorage unavailable
  }

  updateThemeIcon();
  updateThemeColor();

  if (typeof gtag === "function") {
    gtag("event", "theme_toggle", { theme: isDark ? "dark" : "light" });
  }
}

function updateThemeIcon() {
  const themeBtn = document.getElementById("theme-toggle");
  if (!themeBtn) return;

  const icon = themeBtn.querySelector("i");
  if (!icon) return;

  if (body.classList.contains("dark-mode")) {
    icon.className = "fa-solid fa-sun";
    themeBtn.setAttribute("aria-label", "Switch to light mode");
  } else {
    icon.className = "fa-solid fa-moon";
    themeBtn.setAttribute("aria-label", "Switch to dark mode");
  }
}

function updateThemeColor() {
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) return;
  metaThemeColor.setAttribute(
    "content",
    body.classList.contains("dark-mode") ? "#0f172a" : "#f8fafc"
  );
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
    console.warn("Share canceled or failed:", err);
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

  // Clear any existing timeout to prevent premature hide on rapid clicks
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
    toastTimeout = null;
  }, 2500);
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  // 1. Initialize Theme
  initTheme();

  // 2. Bind Theme Toggle
  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    updateThemeIcon();
    updateThemeColor();
    themeBtn.addEventListener("click", toggleTheme);
  }

  // 3. Bind Share Button
  const shareBtn = document.getElementById("share-profile");
  if (shareBtn) {
    shareBtn.addEventListener("click", shareProfile);
  }
});
