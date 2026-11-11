import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  countFrom,
  safeUpdate,
  parseTikTokProfile,
  tiktokFollowerCount,
  refreshMetrics,
  main,
  createFetchers,
  NETWORKS,
} from "../scripts/update-social-metrics.mjs";
import {
  matchingRun,
  safeMetricsPR,
  NETWORKS as PUBLISHED_NETWORKS,
} from "../scripts/publish-metrics.mjs";
const now = "2026-01-02T00:00:00.000Z";
const cached = { count: 25, lastSuccessAt: "2026-01-01T00:00:00.000Z", display: "25 followers" };
for (const count of [
  NaN,
  Infinity,
  -1,
  1.2,
  null,
  undefined,
  [],
  {},
  true,
  "",
  " ",
  Number.MAX_SAFE_INTEGER + 1,
]) {
  test(`invalid count ${String(count)} preserves cached count and freshness`, async () => {
    const result = await safeUpdate({ youtube: cached }, "youtube", async () => count, now);
    assert.equal(result.youtube.count, 25);
    assert.equal(result.youtube.lastSuccessAt, cached.lastSuccessAt);
    assert.equal(result.youtube.lastAttemptAt, now);
    assert.equal(result.youtube.lastError, "Update failed");
    assert.throws(() => countFrom(count));
  });
}
test("zero is valid and YouTube uses subscribers", async () => {
  const result = await safeUpdate({}, "youtube", async () => 0, now);
  assert.equal(result.youtube.display, "0 subscribers");
  assert.equal(result.youtube.lastSuccessAt, now);
  assert.equal(countFrom("123"), 123);
});
test("partial failure preserves cache and reports degradation", async () => {
  const fetchers = Object.fromEntries(
    NETWORKS.map((network) => [
      network,
      async () => {
        if (network === "youtube") throw new Error("sensitive upstream data");
        return 50;
      },
    ])
  );
  const result = await refreshMetrics({ youtube: cached }, fetchers, now);
  assert.equal(result.successes, 4);
  assert.equal(result.data.youtube.count, 25);
  assert.equal(result.data.updatedAt, now);
  assert(!JSON.stringify(result).includes("sensitive upstream data"));
});
test("all failures and corrupt caches leave the file unchanged", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "metrics-test-"));
  const filename = path.join(dir, "metrics.json");
  const fetchers = Object.fromEntries(
    NETWORKS.map((network) => [
      network,
      async () => {
        throw new Error("upstream failure");
      },
    ])
  );
  try {
    for (const source of [
      JSON.stringify({ youtube: cached, updatedAt: cached.lastSuccessAt }),
      "invalid json",
    ]) {
      await fs.writeFile(filename, source);
      await assert.rejects(main({ filename, fetchers }));
      assert.equal(await fs.readFile(filename, "utf8"), source);
    }
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});
test("TikTok fallback only reads matching structured profile statistics", () => {
  const info = {
    __DEFAULT_SCOPE__: {
      "webapp.user-detail": {
        userInfo: { user: { uniqueId: "test" }, stats: { followerCount: 17 } },
      },
    },
  };
  const html = `<script>{"followerCount":999999}</script><script>${JSON.stringify(info)}</script>`;
  assert.equal(parseTikTokProfile(html, "test"), 17);
  assert.throws(() => parseTikTokProfile(html, "other"));
  info.__DEFAULT_SCOPE__["webapp.user-detail"].userInfo.stats.followerCount = null;
  assert.throws(() => parseTikTokProfile(`<script>${JSON.stringify(info)}</script>`, "test"));
});
test("platform requests have deadlines and rejected responses cannot become zero counts", async () => {
  let signal;
  const fetchers = createFetchers({
    env: { BSKY_HANDLE: "example.test" },
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return { ok: true, json: async () => ({ followersCount: null }) };
    },
  });
  await assert.rejects(fetchers.bluesky());
  assert(signal instanceof AbortSignal);
});
test("publication accepts only the exact PR workflow and trusted metrics-only changes", () => {
  const repo = "owner/repo";
  const number = 42;
  const run = {
    head_sha: "a".repeat(40),
    head_branch: "chore/update-social-metrics",
    event: "pull_request",
    path: ".github/workflows/codeql.yml",
    pull_requests: [{ number }],
  };
  assert.equal(matchingRun([run], run.head_sha, number), run);
  const scan = { ...run, path: ".github/workflows/ci.yml" };
  assert.equal(matchingRun([scan], run.head_sha, number), undefined);
  assert.equal(matchingRun([scan], run.head_sha, number, scan.path), scan);
  assert.equal(
    matchingRun([{ ...scan, head_sha: "b".repeat(40) }], run.head_sha, number, scan.path),
    undefined
  );
  assert.equal(
    matchingRun([{ ...scan, pull_requests: [{ number: 999 }] }], run.head_sha, number, scan.path),
    undefined
  );
  assert.equal(matchingRun([run], "b".repeat(40), number), undefined);
  assert.equal(matchingRun([run], run.head_sha, number + 1), undefined);
  assert.equal(
    matchingRun([{ ...run, event: "workflow_dispatch" }], run.head_sha, number),
    undefined
  );
  const pr = {
    state: "open",
    base: { ref: "main", repo: { full_name: repo } },
    head: { ref: run.head_branch, sha: run.head_sha, repo: { full_name: repo } },
    user: { login: "github-actions[bot]" },
  };
  const files = [{ filename: "assets/social-metrics.json", status: "modified" }];
  assert(safeMetricsPR(pr, files, repo));
  assert(!safeMetricsPR(pr, [{ filename: "js/analytics.js", status: "modified" }], repo));
  assert(!safeMetricsPR({ ...pr, user: { login: "contributor" } }, files, repo));
  assert(!safeMetricsPR(pr, files, "other/repo"));
});

test("TikTok transport failure falls back to the requested profile", async () => {
  let calls = 0;
  const fetchers = createFetchers({
    env: { TIKTOK_SESSION_ID: "test-fixture", TIKTOK_USERNAME: "test" },
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error("transport failure");
      return {
        ok: true,
        text: async () =>
          '<script>{"UserModule":{"users":{"123":{"uniqueId":"test"}},"stats":{"123":{"followerCount":23}}}}</script>',
      };
    },
  });
  assert.equal(await fetchers.tiktok(), 23);
  assert.equal(calls, 2);
});

test("TikTok prefers the exact statsV2 count over the rounded stats count", () => {
  assert.equal(tiktokFollowerCount({ followerCount: 11300 }, { followerCount: "11282" }), 11282);
  assert.equal(tiktokFollowerCount({ followerCount: 11300 }, undefined), 11300);
  for (const bad of [11282, "11.2K", "", "-1", null]) {
    assert.equal(tiktokFollowerCount({ followerCount: 11300 }, { followerCount: bad }), 11300);
  }
  assert.throws(() => tiktokFollowerCount({}, { followerCount: "9".repeat(30) }));
  assert.throws(() => tiktokFollowerCount(undefined, undefined));
  const userInfo = {
    user: { uniqueId: "test" },
    stats: { followerCount: 11300 },
    statsV2: { followerCount: "11282" },
  };
  const modern = { __DEFAULT_SCOPE__: { "webapp.user-detail": { userInfo } } };
  assert.equal(parseTikTokProfile(`<script>${JSON.stringify(modern)}</script>`, "test"), 11282);
  const legacy = {
    UserModule: {
      users: { 1: { uniqueId: "test" } },
      stats: { 1: { followerCount: 11300 } },
      statsV2: { 1: { followerCount: "11282" } },
    },
  };
  assert.equal(parseTikTokProfile(`<script>${JSON.stringify(legacy)}</script>`, "test"), 11282);
});

test("TikTok API response uses the exact count without fetching the profile", async () => {
  let calls = 0;
  const fetchers = createFetchers({
    env: { TIKTOK_USERNAME: "test" },
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({
          userInfo: {
            user: { uniqueId: "Test" },
            stats: { followerCount: 11300 },
            statsV2: { followerCount: "11282" },
          },
        }),
      };
    },
  });
  assert.equal(await fetchers.tiktok(), 11282);
  assert.equal(calls, 1);
});

test("TikTok works without a session cookie and retries anonymously when the cookie fails", async () => {
  const profile =
    '<script>{"__DEFAULT_SCOPE__":{"webapp.user-detail":{"userInfo":{"user":{"uniqueId":"test"},"statsV2":{"followerCount":"42"}}}}}</script>';
  const seen = [];
  const fetchImpl = async (_url, options) => {
    seen.push(options.headers.Cookie);
    if (options.headers.Cookie) return { ok: false, status: 403 };
    return { ok: true, json: async () => ({}), text: async () => profile };
  };
  const anonymous = createFetchers({ env: { TIKTOK_USERNAME: "test" }, fetchImpl });
  assert.equal(await anonymous.tiktok(), 42);
  assert.deepEqual(seen, [undefined, undefined]);
  seen.length = 0;
  const expired = createFetchers({
    env: { TIKTOK_SESSION_ID: "test-fixture", TIKTOK_USERNAME: "test" },
    fetchImpl,
  });
  assert.equal(await expired.tiktok(), 42);
  assert.deepEqual(seen, [
    "sessionid=test-fixture",
    "sessionid=test-fixture",
    undefined,
    undefined,
  ]);
});

test("Publisher network list matches the collector", () => {
  assert.deepEqual([...PUBLISHED_NETWORKS].sort(), [...NETWORKS].sort());
});
