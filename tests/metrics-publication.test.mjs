import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { publishMetrics, validateMetricsBlob } from "../scripts/publish-metrics.mjs";

const source = JSON.parse(await fs.readFile("assets/social-metrics.json", "utf8"));
const repo = "pbuffolino/seeknay-links";
const sha = "a".repeat(40);
const blob = (value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    type: "file",
    encoding: "base64",
    size: bytes.length,
    content: bytes.toString("base64"),
  };
};
function fixture() {
  const f = {
    pr: {
      state: "open",
      base: { ref: "main", repo: { full_name: repo } },
      head: { ref: "chore/update-social-metrics", sha, repo: { full_name: repo } },
      user: { login: "github-actions[bot]" },
    },
    files: [{ filename: "assets/social-metrics.json", status: "modified" }],
    content: blob(source),
    conclusion: "success",
    writes: [],
    reads: [],
  };
  f.request = async (...args) => {
    const endpoint = args.find((arg) => typeof arg === "string" && arg.startsWith("repos/"));
    if (args.includes("--method")) {
      f.writes.push(args);
      return JSON.stringify(endpoint.endsWith("/merge") ? { merged: true } : {});
    }
    f.reads.push(endpoint);
    if (endpoint.endsWith("/files")) return JSON.stringify(f.files);
    if (endpoint.includes("/contents/")) return JSON.stringify(f.content);
    if (endpoint.includes("/actions/runs?"))
      return JSON.stringify({
        workflow_runs: [
          {
            id: 7,
            head_sha: sha,
            head_branch: f.pr.head.ref,
            event: "pull_request",
            path: ".github/workflows/codeql.yml",
            pull_requests: [{ number: 42 }],
            status: "completed",
            conclusion: f.conclusion,
          },
        ],
      });
    if (endpoint.endsWith("/pulls/42"))
      return JSON.stringify({ ...f.pr, ...(f.writes.length ? { merged: true } : {}) });
    throw new Error("Unexpected request");
  };
  return f;
}
const publish = (f) => publishMetrics({ repo, number: "42", request: f.request });

test("publisher validates only immutable generated data and dispatches no general CI", async () => {
  const f = fixture();
  await publish(f);
  assert(f.reads.includes(`repos/${repo}/contents/assets/social-metrics.json?ref=${sha}`));
  assert.equal(f.writes.length, 3);
  assert(f.writes[0].includes(`sha=${sha}`));
  assert(f.writes[1].includes(`repos/${repo}/actions/workflows/codeql.yml/dispatches`));
  assert(f.writes[2].includes(`repos/${repo}/pages/builds`));
  assert(!f.writes.flat().some((value) => value.includes("ci.yml")));
});

test("malformed, oversized, injected or incomplete metrics cannot reach a write", async () => {
  for (const content of [
    { ...blob(source), size: 65537 },
    { ...blob(source), size: 1 },
    blob({ ...source, injected: "unexpected" }),
    blob({ ...source, youtube: { ...source.youtube, count: -1 } }),
    blob({ ...source, youtube: { ...source.youtube, lastError: "private provider response" } }),
    blob({ ...source, instagram: undefined }),
  ]) {
    const f = fixture();
    f.content = content;
    await assert.rejects(publish(f));
    assert.equal(f.writes.length, 0);
  }
  assert.deepEqual(validateMetricsBlob(blob(source)), source);
});

test("failed CodeQL and code-bearing PRs remain blocked before merge", async () => {
  const failed = fixture();
  failed.conclusion = "failure";
  await assert.rejects(publish(failed), /CodeQL did not succeed/);
  assert.equal(failed.writes.length, 0);
  const code = fixture();
  code.files = [{ filename: "js/ui.js", status: "modified" }];
  await assert.rejects(publish(code), /unexpected changes/);
  assert.equal(code.writes.length, 0);
});

test("head changes after data validation prevent publication", async () => {
  const f = fixture();
  const request = f.request;
  let prReads = 0;
  f.request = (...args) => {
    if (args.some((arg) => arg === `repos/${repo}/pulls/42`) && ++prReads > 1)
      f.pr.head.sha = "b".repeat(40);
    return request(...args);
  };
  await assert.rejects(publish(f), /changed during publication/);
  assert.equal(f.writes.length, 0);
});
