import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreOwnedRef } from "../scripts/native-dependabot-refresh.mjs";
import { requiredChecks } from "../scripts/merge-dependabot.mjs";

const repo = "pbuffolino/seeknay-links",
  head = "a".repeat(40),
  base = "b".repeat(40);
const machine = { login: "github-actions[bot]", type: "Bot" },
  bot = { login: "dependabot[bot]", type: "Bot" };
function fixture() {
  const intent = `r7-${base}-1`,
    branch = "dependabot/npm_and_yarn/example-1.1.0";
  const pr = {
    number: 7,
    state: "closed",
    merged: false,
    draft: false,
    commits: 1,
    changed_files: 1,
    user: bot,
    head: { sha: head, ref: branch, repo: { full_name: repo } },
    base: { ref: "main", repo: { full_name: repo } },
    labels: [
      {
        name: "dependency-refresh-intent",
        description: "Reserved for crash-recoverable signed dependency refreshes by GitHub Actions",
      },
      { name: intent, description: `7 ${head} ${base} 1` },
    ],
  };
  const files = [{ filename: "package-lock.json", status: "modified" }],
    commits = [{ sha: head, author: bot, commit: { verification: { verified: true } } }];
  const events = [
    { id: 1, event: "labeled", actor: machine, label: { name: "dependency-refresh-intent" } },
    { id: 2, event: "labeled", actor: machine, label: { name: intent } },
    { id: 3, event: "closed", actor: machine },
    { id: 4, event: "head_ref_deleted", actor: bot },
  ];
  const main = {
    commit: { sha: base },
    protected: true,
    protection: {
      enabled: true,
      required_status_checks: {
        enforcement_level: "everyone",
        checks: requiredChecks.map((context) => ({ context, app_id: 15368 })),
      },
    },
  };
  const env = {
    GITHUB_REPOSITORY: repo,
    DEPENDABOT_PR: "7",
    DEPENDABOT_SHA: head,
    DEPENDABOT_METADATA: JSON.stringify([
      {
        updateType: "version-update:semver-minor",
        maintainerChanges: false,
        directory: "/",
        targetBranch: "main",
        packageEcosystem: "npm_and_yarn",
      },
    ]),
  };
  const flags = { missing: true },
    writes = [],
    restored = new Set();
  const request = async (...args) => {
    const endpoint = args.find((arg) => arg.startsWith?.("repos/"));
    if (args.includes("--method")) {
      writes.push(args);
      assert.equal(args[args.indexOf("--method") + 1], "POST");
      assert(endpoint.endsWith("/git/refs"));
      flags.missing = false;
      if (flags.concurrent) {
        const error = new Error("exists");
        error.status = 422;
        throw error;
      }
      return {};
    }
    if (endpoint.endsWith("/pulls/7")) return pr;
    if (endpoint.includes("/files?")) return files;
    if (endpoint.includes("/commits?")) return commits;
    if (endpoint.includes("/events?")) return structuredClone(events);
    if (endpoint.endsWith("/branches/main")) return main;
    if (endpoint.includes("/compare/"))
      return { merge_base_commit: { sha: flags.nonancestor ? "e".repeat(40) : base } };
    if (endpoint.includes("/git/ref/heads/")) {
      if (flags.missing) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      return {
        ref: `refs/heads/${branch}`,
        object: { type: "commit", sha: flags.wrongRef ? "e".repeat(40) : head },
      };
    }
    throw new Error("Unexpected ref fixture request");
  };
  return {
    env,
    request,
    pr,
    files,
    commits,
    events,
    main,
    flags,
    writes,
    restored,
    intent,
    branch,
  };
}

test("restores only an absent exact bot ref at its original signed SHA without updating or force", async () => {
  const f = fixture();
  assert(await restoreOwnedRef(f));
  assert.equal(f.writes.length, 1);
  assert(f.writes[0].includes(`ref=refs/heads/${f.branch}`));
  assert(f.writes[0].includes(`sha=${head}`));
  assert(!f.writes[0].some((arg) => arg.startsWith("force=")));
  assert.equal(await restoreOwnedRef(f), false);
  assert.equal(f.writes.length, 1);
});

test("an existing changed ref is never overwritten", async () => {
  const f = fixture();
  f.flags.missing = false;
  f.flags.wrongRef = true;
  await assert.rejects(restoreOwnedRef(f), /never overwrite/);
  assert.equal(f.writes.length, 0);
});

test("human, obsolete, unmarked, unsigned, major or unexpected-scope closures never restore", async () => {
  for (const mutate of [
    (f) => {
      f.events[2].actor = { login: "human", type: "User" };
    },
    (f) => {
      f.events[2].actor = bot;
    },
    (f) => {
      f.pr.labels = [];
    },
    (f) => {
      f.commits[0].commit.verification.verified = false;
    },
    (f) => {
      f.env.DEPENDABOT_METADATA = f.env.DEPENDABOT_METADATA.replace("semver-minor", "semver-major");
    },
    (f) => {
      f.files[0].filename = "index.html";
    },
    (f) => {
      f.pr.head.ref = "main";
    },
    (f) => {
      f.pr.merged = true;
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(restoreOwnedRef(f));
    assert.equal(f.writes.length, 0);
  }
});

test("deletion must be by Dependabot after this machine closure, without a restoration/deletion replay", async () => {
  for (const mutate of [
    (f) => {
      f.events.pop();
    },
    (f) => {
      f.events[3].actor = { login: "human", type: "User" };
    },
    (f) => {
      f.events[3].id = 0;
    },
    (f) => {
      f.events.push(
        { id: 5, event: "head_ref_restored", actor: machine },
        { id: 6, event: "head_ref_deleted", actor: bot }
      );
    },
    (f) => {
      f.restored.add(f.intent);
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(restoreOwnedRef(f));
    assert.equal(f.writes.length, 0);
  }
});

test("crash recovery permits protected-main advancement only when the intent base remains its ancestor", async () => {
  const f = fixture();
  f.main.commit.sha = "c".repeat(40);
  assert(await restoreOwnedRef(f));
  const g = fixture();
  g.main.commit.sha = "c".repeat(40);
  g.flags.nonancestor = true;
  await assert.rejects(restoreOwnedRef(g), /no longer on protected main/);
  assert.equal(g.writes.length, 0);
  const h = fixture();
  h.main.commit.sha = "c".repeat(40);
  await assert.rejects(restoreOwnedRef({ ...h, expectedBase: base }), /base\/protection changed/);
  assert.equal(h.writes.length, 0);
});

test("a concurrent create is accepted only if the exact ref and signed SHA verify", async () => {
  const f = fixture();
  f.flags.concurrent = true;
  assert(await restoreOwnedRef(f));
  const g = fixture();
  g.flags.concurrent = true;
  g.flags.wrongRef = true;
  await assert.rejects(restoreOwnedRef(g));
});

test("unexpected returned ref SHA fails the restoration receipt without an overwrite", async () => {
  const f = fixture();
  f.flags.wrongRef = true;
  await assert.rejects(restoreOwnedRef(f), /does not match/);
  assert.equal(f.writes.length, 1);
});
