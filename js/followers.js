/**
 * FOLLOWERS MODULE
 * Renders social media follower counts on the page.
 * 
 * NOTE: All data (including Bluesky) is now pre-fetched by GitHub Actions 
 * and stored in 'assets/social-metrics.json'. This script strictly READS 
 * that static file and updates the DOM. It does NOT make external API calls.
 */
/**
 * Load social metrics from the static JSON file.
 * This file is generated/updated monthly by GitHub Actions in the .github/workflows directory.
 * @returns {Promise<object|null>} - The metrics object or null if loading fails
 */
async function loadSocialMetrics() {
    try {
        // Fetch the static asset (no API keys required here!)
        const res = await fetch('assets/social-metrics.json');
        if (!res.ok) throw new Error('Failed to load social metrics');
        return await res.json();
    } catch (e) {
        console.warn('Failed to load social metrics:', e);
        return null;
    }
}

/**
 * MAIN: Orchestrates the update of all follower count elements on the page.
 * Triggered on DOMContentLoaded.
 */
async function updateFollowers() {
    // Select all elements designed to hold follower counts
    const elements = document.querySelectorAll('.link-followers');

    // Load metrics from the pre-generated JSON file
    const metrics = await loadSocialMetrics();

    elements.forEach(el => {
        // The data-network attribute in index.html MUST match the key in social-metrics.json
        const network = el.dataset.network;

        // Implementation Note: All platforms (including Bluesky) are now 
        // managed by the GitHub Actions background script.
        if (metrics && metrics[network]) {
            const platformData = metrics[network];

            // Only show the count if we have a valid, non-empty display string
            if (platformData.display && platformData.display.trim() !== "") {
                el.textContent = platformData.display;
                el.style.display = 'inline'; // Make visible
            } else {
                // Hide completely to avoid showing empty parens or placeholders
                el.style.display = 'none';
            }
        } else {
            // Hide if the network is missing from JSON entirely
            el.style.display = 'none';
        }
    });
}

document.addEventListener('DOMContentLoaded', updateFollowers);
