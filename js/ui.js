/**
 * UI CONTROLLER
 * Handles Theme Toggling and Share functionality.
 */

// DOM Elements
const body = document.body;

/**
 * THEME MANAGEMENT
 */
function initTheme() {
  const savedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  // Apply theme if saved or if system prefers dark and no save exists
  if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
    body.classList.add("dark-mode");
  }
}

function toggleTheme() {
  body.classList.toggle("dark-mode");
  const isDark = body.classList.contains("dark-mode");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  updateThemeIcon();
}

function updateThemeIcon() {
  const themeBtn = document.getElementById("theme-toggle");
  if (!themeBtn) return;

  // We expect an <i> element inside the button
  const icon = themeBtn.querySelector("i");
  if (!icon) return;

  if (body.classList.contains("dark-mode")) {
    icon.className = "fa-solid fa-sun";
  } else {
    icon.className = "fa-solid fa-moon";
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
    document.body.appendChild(toast);
  }

  toast.textContent = message;

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  // Hide after timeout
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  // 1. Initialize Theme
  initTheme();

  // 2. Bind Theme Toggle
  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    // Set initial icon state based on what initTheme() did
    updateThemeIcon();
    themeBtn.addEventListener("click", toggleTheme);
  }

  // 3. Bind Share Button
  const shareBtn = document.getElementById("share-profile");
  if (shareBtn) {
    shareBtn.addEventListener("click", shareProfile);
  }
});
