// Credentials stay in environment variables; never log request URLs or upstream error bodies.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = "assets/social-metrics.json";
export const NETWORKS = ["youtube", "instagram", "tiktok", "bluesky", "facebook"];
export const validCount = (count) => Number.isSafeInteger(count) && count >= 0;

export function formatCount(count, network) {
  if (!validCount(count)) throw new Error("Invalid follower count");
  return `${new Intl.NumberFormat("en-US").format(count)} ${
    network === "youtube" ? "subscribers" : "followers"
  }`;
}

export async function readJson(filename) {
  try {
    const data = JSON.parse(await fs.readFile(filename, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid existing metrics");
    }
    return data;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error("Cannot read existing metrics; refusing to replace cached data", {
      cause: error,
    });
  }
}

export async function safeUpdate(existing, network, fetcher, now = new Date().toISOString()) {
  try {
    const count = await fetcher();
    if (!validCount(count)) throw new Error("Invalid follower count");
    return {
      ...existing,
      [network]: {
        count,
        display: formatCount(count, network),
        lastSuccessAt: now,
        lastAttemptAt: now,
      },
    };
  } catch {
    return {
      ...existing,
      [network]: {
        ...(existing[network] ?? {}),
        lastAttemptAt: now,
        lastError: "Update failed",
      },
    };
  }
}

export function countFrom(value) {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) {
    throw new Error("Missing or invalid follower count");
  }
  const count = Number(value);
  if (!validCount(count)) throw new Error("Invalid follower count");
  return count;
}

export function parseTikTokProfile(html, username) {
  for (const [, body] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    const info = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo;
    if (info?.user?.uniqueId?.toLowerCase() === username.toLowerCase()) {
      return countFrom(info.stats?.followerCount);
    }
    const users = data?.UserModule?.users;
    if (users) {
      for (const [id, user] of Object.entries(users)) {
        if (user.uniqueId?.toLowerCase() === username.toLowerCase()) {
          return countFrom(data.UserModule.stats?.[id]?.followerCount);
        }
      }
    }
  }
  throw new Error("No matching TikTok profile statistics");
}

export function createFetchers({ env = process.env, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  async function request(url, headers = {}, responseType = "json") {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    return responseType === "text" ? response.text() : response.json();
  }
  function required(...names) {
    if (names.some((name) => !env[name])) throw new Error("Missing platform configuration");
  }
  function graphUrl(id, token) {
    const version = env.META_GRAPH_VERSION || "v19.0";
    if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid Graph API version");
    return `https://graph.facebook.com/${version}/${encodeURIComponent(id)}?fields=followers_count&access_token=${encodeURIComponent(token)}`;
  }
  return {
    youtube: async () => {
      required("YT_API_KEY", "YT_CHANNEL_ID");
      const data = await request(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(env.YT_CHANNEL_ID)}&key=${encodeURIComponent(env.YT_API_KEY)}`
      );
      return countFrom(data?.items?.[0]?.statistics?.subscriberCount);
    },
    instagram: async () => {
      required("IG_ACCESS_TOKEN", "IG_USER_ID");
      const data = await request(graphUrl(env.IG_USER_ID, env.IG_ACCESS_TOKEN));
      return countFrom(data?.followers_count);
    },
    tiktok: async () => {
      required("TIKTOK_SESSION_ID");
      const username = env.TIKTOK_USERNAME || "seeknay747";
      const headers = {
        Cookie: `sessionid=${env.TIKTOK_SESSION_ID}`,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://www.tiktok.com/",
      };
      try {
        const data = await request(
          `https://www.tiktok.com/api/user/detail/?uniqueId=${encodeURIComponent(username)}&msToken=${encodeURIComponent(env.TIKTOK_MS_TOKEN || "")}`,
          headers
        );
        const info = data?.userInfo;
        if (info?.user?.uniqueId?.toLowerCase() === username.toLowerCase()) {
          const count = countFrom(info?.stats?.followerCount);
          if (validCount(count)) return count;
        }
      } catch {
        // All API failures use the matching profile's embedded statistics as a fallback.
      }
      const html = await request(
        `https://www.tiktok.com/@${encodeURIComponent(username)}`,
        headers,
        "text"
      );
      return parseTikTokProfile(html, username);
    },
    bluesky: async () => {
      required("BSKY_HANDLE");
      const data = await request(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(env.BSKY_HANDLE)}`
      );
      return countFrom(data?.followersCount);
    },
    facebook: async () => {
      required("FB_PAGE_ACCESS_TOKEN", "FB_PAGE_ID");
      const data = await request(graphUrl(env.FB_PAGE_ID, env.FB_PAGE_ACCESS_TOKEN));
      return countFrom(data?.followers_count);
    },
  };
}

export async function refreshMetrics(existing, fetchers, now = new Date().toISOString()) {
  let data = { ...existing, lastAttemptAt: now };
  const results = [];
  for (const network of NETWORKS) {
    data = await safeUpdate(data, network, fetchers[network], now);
    const success = !data[network].lastError;
    results.push({ network, success });
    console.log(`${success ? "OK" : "FAILED"}: ${network}`);
  }
  const successes = results.filter((result) => result.success).length;
  if (successes) data.updatedAt = now;
  return { data, results, successes, failures: results.length - successes };
}

export async function main({ filename = OUT, fetchers = createFetchers() } = {}) {
  const result = await refreshMetrics(await readJson(filename), fetchers);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Social metrics\n\n${result.results
        .map(
          (entry) => `- ${entry.network}: ${entry.success ? "updated" : "failed, cached data kept"}`
        )
        .join("\n")}\n`
    );
  }
  if (!result.successes) throw new Error("All platform updates failed; cached file left unchanged");
  await fs.writeFile(filename, JSON.stringify(result.data, null, 2) + "\n");
  if (result.failures) {
    console.warn(`::warning::${result.failures} platform updates failed; cached counts preserved`);
  }
  console.log(`Saved ${result.successes} successful platform updates`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("::error::Metrics update failed. Check the platform summary and configuration.");
    process.exitCode = 1;
  });
}
