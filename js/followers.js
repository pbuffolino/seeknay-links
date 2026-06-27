/**
 * FOLLOWERS.JS
 * Fetches JSON metrics and populates the UI.
 * Handles both individual link counts and the aggregate "Community Stats" card.
 */

let metricsData = null;

// Expose global function for other scripts (like links.js) to trigger updates
window.updateSocialCounts = () => {
  if (metricsData) {
    updateUI(metricsData);
    return;
  }

  fetch("assets/social-metrics.json")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      return response.json();
    })
    .then((data) => {
      metricsData = data;
      updateUI(data);
    })
    .catch((error) => {
      console.error("Error loading social metrics:", error);
      const totalEl = document.getElementById("total-followers");
      if (totalEl) totalEl.textContent = "---";
    });
};

document.addEventListener("DOMContentLoaded", () => {
  window.updateSocialCounts();
});

function updateUI(data) {
  let totalFollowers = 0;

  // Networks to include in the total count
  const networks = ["tiktok", "youtube", "instagram", "bluesky", "facebook"];

  networks.forEach((network) => {
    const metric = data[network];

    // Safety check: ensure metric exists
    if (metric && typeof metric.count === "number") {
      // 1. Update Total Aggregate
      totalFollowers += metric.count;

      // 2. Update Stats Card Breakdown (Mini Counts)
      // Finds elements like: <span data-network="tiktok" class="stat-mini-count">
      const miniCountEl = document.querySelector(`.stat-mini-count[data-network="${network}"]`);
      if (miniCountEl) {
        miniCountEl.textContent = formatCompactNumber(metric.count);
      }
    }

    // 3. Update Link Button Labels (Existing functionality)
    // Finds elements like: <span class="link-followers" data-network="tiktok">
    // Prefer the 'display' string from JSON if available, otherwise fallback
    const followersEl = document.querySelector(`.link-followers[data-network="${network}"]`);
    if (followersEl && metric) {
      if (metric.display) {
        followersEl.textContent = metric.display;
      } else if (typeof metric.count === "number") {
        followersEl.textContent = `${formatNumber(metric.count)} followers`;
      }
    }
  });

  // 4. Update Big Total Display
  const totalEl = document.getElementById("total-followers");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Only animate if content is not already set or different (to avoid jumpiness on re-runs)
  if (totalEl && totalEl.textContent === "Loading...") {
    if (prefersReducedMotion) {
      totalEl.textContent = formatCompactNumber(totalFollowers);
    } else {
      animateValue(totalEl, 0, totalFollowers, 1500);
    }
  } else if (totalEl) {
    // If already loaded, just ensure it's formatted (no animation on re-render)
    totalEl.textContent = formatCompactNumber(totalFollowers);
  }
}

/**
 * Formats a number to a compact string (e.g., 1200 -> 1.2K)
 */
function formatCompactNumber(num) {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(num);
}

/**
 * Formats a number with commas (e.g., 1200 -> 1,200)
 */
function formatNumber(num) {
  return new Intl.NumberFormat("en-US").format(num);
}

/**
 * Animates a number from start to end
 */
function animateValue(obj, start, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);

    // Ease out quart
    const easeProgress = 1 - Math.pow(1 - progress, 4);

    const current = Math.floor(easeProgress * (end - start) + start);

    // Once we get close, switch to formatted string
    if (progress === 1) {
      obj.textContent = formatCompactNumber(end);
    } else {
      obj.textContent = formatNumber(current);
    }

    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}
