// ⚠️ SECURITY: This script reads ALL credentials from environment variables only.
// NO hardcoded API keys, tokens, or secrets. Safe to commit publicly.

import fs from "node:fs/promises";

const OUT = "assets/social-metrics.json";

/**
 * UTILITY: Format raw numbers into human-readable strings (e.g., 1200 -> "1.2k followers")
 * @param {number} count - The raw follower/subscriber count
 * @returns {string|null} - Formatted string or null if input is invalid
 */
function formatCount(count) {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  // Use exact count with comma separators (e.g., 11,234 followers)
  const formatted = new Intl.NumberFormat("en-US").format(count);
  return `${formatted} followers`;
}

/**
 * Safely read JSON file, returning empty object if it doesn't exist
 */
async function readJson(path) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return { updatedAt: null };
  }
}

/**
 * Write JSON file with pretty formatting
 */
async function writeJson(path, obj) {
  await fs.writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/**
 * CORE LOGIC: Safely updates a platform's metrics.
 * On success: Updates the count and display string.
 * On failure: Keeps the previous count but records the error message.
 * @param {object} existing - Current state of the JSON data
 * @param {string} key - Platform key (e.g., 'youtube', 'instagram')
 * @param {function} fetcher - Async function that returns the raw count
 * @returns {object} - Updated state object
 */
async function safeUpdate(existing, key, fetcher) {
  try {
    const count = await fetcher();
    console.log(`✓ ${key}: ${count} (${formatCount(count)})`);
    return {
      ...existing,
      [key]: {
        count,
        display: formatCount(count),
        lastSuccessAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const msg = String(error?.message ?? error);
    console.warn(`✗ ${key}: ${msg}`);
    // Keep last known count, record error only
    return {
      ...existing,
      [key]: {
        ...(existing[key] ?? {}),
        lastError: msg,
      },
    };
  }
}

/**
 * Fetch YouTube subscriber count
 * Requires: YT_API_KEY, YT_CHANNEL_ID
 */
async function getYouTubeSubs() {
  const apiKey = process.env.YT_API_KEY;
  const channelId = process.env.YT_CHANNEL_ID;

  if (!apiKey || !channelId) {
    throw new Error("Missing YT_API_KEY or YT_CHANNEL_ID");
  }

  const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(
    channelId
  )}&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const subscriberCount = data?.items?.[0]?.statistics?.subscriberCount;

  if (subscriberCount == null) {
    throw new Error("subscriberCount missing (hidden or invalid channel ID)");
  }

  return Number(subscriberCount);
}

/**
 * Fetch Instagram follower count
 * Requires: IG_ACCESS_TOKEN, IG_USER_ID
 */
async function getInstagramFollowers() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;

  if (!token || !igUserId) {
    throw new Error("Missing IG_ACCESS_TOKEN or IG_USER_ID");
  }

  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(
    igUserId
  )}?fields=followers_count&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Instagram API error ${res.status}: ${JSON.stringify(data)}`);
  }

  if (data?.followers_count == null) {
    throw new Error("followers_count missing");
  }

  return Number(data.followers_count);
}

/**
 * Fetch TikTok follower count (Session-based approach)
 * Requires: TIKTOK_SESSION_ID, TIKTOK_MS_TOKEN, TIKTOK_USERNAME
 */
async function getTikTokFollowers() {
  const sessionId = process.env.TIKTOK_SESSION_ID;
  const msToken = process.env.TIKTOK_MS_TOKEN || "";
  const username = process.env.TIKTOK_USERNAME || "seeknay747";

  if (!sessionId) {
    throw new Error("Missing TIKTOK_SESSION_ID");
  }

  const url = `https://www.tiktok.com/api/user/detail/?uniqueId=${encodeURIComponent(
    username
  )}&msToken=${encodeURIComponent(msToken)}`;

  // Attempt 1: Internal API (Fastest)
  const apiRes = await fetch(url, {
    headers: {
      "Cookie": `sessionid=${sessionId}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.tiktok.com/",
    },
  });

  if (apiRes.ok) {
    const text = await apiRes.text();
    try {
      const data = JSON.parse(text);
      const count = data?.userInfo?.stats?.followerCount;
      if (count != null) return Number(count);
    } catch (e) {
      // Fall through to scraping
    }
  }

  // Attempt 2: Scrape Profile Page (More Reliable)
  const pageRes = await fetch(`https://www.tiktok.com/@${username}`, {
    headers: {
      "Cookie": `sessionid=${sessionId}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const html = await pageRes.text();

  // Look for the "followerCount":1234 pattern in the embedded JSON
  const match = html.match(/"followerCount":\s*(\d+)/);
  if (match && match[1]) {
    return Number(match[1]);
  }

  throw new Error("Could not find follower count in API or profile page HTML");
}

/**
 * Fetch X/Twitter follower count
 * Requires: X_BEARER_TOKEN, X_USERNAME
 */
async function getXFollowers() {
  const bearer = process.env.X_BEARER_TOKEN;
  const username = process.env.X_USERNAME;

  if (!bearer || !username) {
    throw new Error("Missing X_BEARER_TOKEN or X_USERNAME");
  }

  const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(
    username
  )}?user.fields=public_metrics`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}` },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`X API error ${res.status}: ${JSON.stringify(data)}`);
  }

  const count = data?.data?.public_metrics?.followers_count;

  if (count == null) {
    throw new Error("followers_count missing");
  }

  return Number(count);
}

/**
 * Fetch Bluesky follower count
 * Requires: BSKY_HANDLE
 */
async function getBlueskyFollowers() {
  const handle = process.env.BSKY_HANDLE;

  if (!handle) {
    throw new Error("Missing BSKY_HANDLE");
  }

  const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(
    handle
  )}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bluesky API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const count = data?.followersCount;

  if (count == null) {
    throw new Error("followersCount missing");
  }

  return Number(count);
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
  console.log("🔄 Starting Social Metrics Update...");
  console.log(`📡 Current Time: ${new Date().toISOString()}\n`);

  // 1. Read existing data (to preserve counts on API failure)
  const existing = await readJson(OUT);
  let next = {
    ...existing,
    updatedAt: new Date().toISOString()
  };

  // 2. Sequential updates for clarity and stability
  // To add a new platform: 
  //   a. Create a getPlatformFollowers() function
  //   b. Add a safeUpdate() call here
  //   c. Add the key to assets/social-metrics.json
  next = await safeUpdate(next, "youtube", getYouTubeSubs);
  next = await safeUpdate(next, "instagram", getInstagramFollowers);
  next = await safeUpdate(next, "tiktok", getTikTokFollowers);
  next = await safeUpdate(next, "x", getXFollowers);
  next = await safeUpdate(next, "bluesky", getBlueskyFollowers);

  // 3. Write back to disk (GitHub Action will commit this file)
  await writeJson(OUT, next);
  console.log(`\n✅ Metrics saved to ${OUT}`);
}

main().catch(err => {
  console.error("❌ Critical script failure:", err);
  process.exit(1);
});
