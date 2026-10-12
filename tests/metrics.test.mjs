import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  countFrom,
  safeUpdate,
  parseTikTokProfile,
  refreshMetrics,
  main,
  createFetchers,
  NETWORKS,
} from "../scripts/update-social-metrics.mjs";
import { matchingRun, safeMetricsPR } from "../scripts/publish-metrics.mjs";
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
test("publication matches the exact SHA, branch, event, and dispatch time", () => {
  const run = {
    head_sha: "a".repeat(40),
    head_branch: "chore/update-social-metrics",
    event: "workflow_dispatch",
    created_at: now,
  };
  assert.equal(matchingRun([run], run.head_sha, Date.parse(now)), run);
  assert.equal(matchingRun([run], "b".repeat(40), Date.parse(now)), undefined);
  assert.equal(matchingRun([run], run.head_sha, Date.parse(now) + 2000), undefined);
  const pr = {
    state: "open",
    base: { ref: "main" },
    head: { ref: run.head_branch, sha: run.head_sha },
  };
  assert(safeMetricsPR(pr, [{ filename: "assets/social-metrics.json", status: "modified" }]));
  assert(!safeMetricsPR(pr, [{ filename: "js/analytics.js", status: "modified" }]));
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
