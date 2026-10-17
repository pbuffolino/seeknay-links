import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  intentLabel,
  ownedIntent,
  recoverablePRs,
  refreshNative,
} from "../scripts/native-dependabot-refresh.mjs";
import { classify, prepare } from "../scripts/reconcile-dependabot.mjs";

const repo = "pbuffolino/seeknay-links";
const head = "a".repeat(40),
  base = "b".repeat(40),
  next = "c".repeat(40);
const machine = { login: "github-actions[bot]", type: "Bot" };
const description = "Reserved for crash-recoverable signed dependency refreshes by GitHub Actions";
const binder = (attempt = 1) => `r7-${base}-${attempt}`;
function fixture() {
  let time = 1200000,
    id = 0;
  const pr = {
    number: 7,
    state: "open",
    merged: false,
    draft: false,
    commits: 1,
    changed_files: 1,
    user: { login: "dependabot[bot]" },
    base: { ref: "main", repo: { full_name: repo } },
    head: { ref: "dependabot/npm_and_yarn/example-1.1.0", sha: head, repo: { full_name: repo } },
    labels: [{ name: "dependencies", description: "preserve" }],
    reviews: [{ state: "APPROVED" }],
  };
  const files = [{ filename: "package-lock.json", status: "modified" }];
  const commits = [
    {
      sha: head,
      author: { login: "dependabot[bot]" },
      commit: { verification: { verified: true } },
    },
  ];
  const dependencies = [
    {
      updateType: "version-update:semver-minor",
      maintainerChanges: false,
      directory: "/",
      targetBranch: "main",
      packageEcosystem: "npm_and_yarn",
    },
  ];
  const env = {
    GITHUB_REPOSITORY: repo,
    DEPENDABOT_PR: "7",
    DEPENDABOT_SHA: head,
    DEPENDABOT_METADATA: JSON.stringify(dependencies),
  };
  const events = [],
    writes = [],
    definitions = new Map();
  const flags = {
    failOpen: false,
    changeClosed: false,
    failCleanup: false,
    upToDate: false,
    headOnPoll: true,
    closeResponseLost: false,
    manualCloseRace: false,
  };
  function event(type, label, actor = machine, at = time) {
    events.push({
      id: ++id,
      event: type,
      label: label ? { name: label } : undefined,
      actor,
      created_at: new Date(at).toISOString(),
    });
  }
  function addIntent(attempt = 1, at = time) {
    definitions.set(intentLabel, { name: intentLabel, description });
    definitions.set(binder(attempt), {
      name: binder(attempt),
      description: `7 ${head} ${base} ${attempt}`,
    });
    for (const name of [intentLabel, binder(attempt)]) {
      pr.labels.push(definitions.get(name));
      event("labeled", name, machine, at);
    }
  }
  const request = async (...args) => {
    const endpoint = args.find((v) => v.startsWith?.("repos/"));
    const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
    const field = (name) => args.find((v) => v.startsWith?.(`${name}=`))?.slice(name.length + 1);
    if (method !== "GET") writes.push({ method, endpoint, args });
    if (endpoint.includes("/events?")) return structuredClone(events);
    if (endpoint.includes("/issues?"))
      return pr.state === "closed" && pr.labels.some((l) => l.name === intentLabel)
        ? [{ number: 7, pull_request: {} }]
        : [];
    if (endpoint.endsWith("/branches/main")) return { commit: { sha: base } };
    if (endpoint.includes("/compare/"))
      return { merge_base_commit: { sha: flags.upToDate ? base : "d".repeat(40) } };
    if (endpoint.includes("/files?")) return structuredClone(files);
    if (endpoint.includes("/commits?")) return structuredClone(commits);
    if (endpoint.endsWith("/pulls/7")) {
      if (method === "PATCH") {
        if (field("state") === "open" && flags.failOpen) throw new Error("Reopen unavailable");
        pr.state = field("state");
        event(
          pr.state === "open" ? "reopened" : "closed",
          null,
          flags.manualCloseRace ? { login: "owner", type: "User" } : machine
        );
        if (pr.state === "closed" && flags.changeClosed) pr.head.sha = next;
        if (pr.state === "closed" && flags.closeResponseLost)
          throw new Error("Close response unavailable");
      }
      return structuredClone(pr);
    }
    if (endpoint.endsWith("/issues/7/labels") && method === "POST") {
      for (const arg of args.filter((v) => v.startsWith?.("labels[]="))) {
        const name = arg.slice(9);
        pr.labels.push(definitions.get(name));
        event("labeled", name);
      }
      return structuredClone(pr.labels);
    }
    if (endpoint.includes("/issues/7/labels/") && method === "DELETE") {
      const name = decodeURIComponent(endpoint.split("/labels/")[1]);
      if (flags.failCleanup && name === binder()) throw new Error("Cleanup unavailable");
      pr.labels = pr.labels.filter((l) => l.name !== name);
      event("unlabeled", name);
      return [];
    }
    if (endpoint.endsWith("/labels") && method === "POST") {
      const value = { name: field("name"), description: field("description") };
      definitions.set(value.name, value);
      return value;
    }
    if (endpoint.includes("/labels/")) {
      const value = definitions.get(decodeURIComponent(endpoint.split("/labels/")[1]));
      if (!value) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      return value;
    }
    throw new Error(`Unexpected fixture request: ${method}`);
  };
  return {
    pr,
    files,
    commits,
    env,
    events,
    writes,
    definitions,
    flags,
    event,
    addIntent,
    request,
    approve: async () => {},
    now: () => time,
    sleep: async (ms) => {
      time += ms;
      if (flags.headOnPoll) pr.head.sha = next;
    },
    age: () => {
      time += 700000;
    },
  };
}

test("native refresh labels intent before closing, reopens, and preserves labels/reviews", async () => {
  const f = fixture();
  assert.equal(await refreshNative(f), next);
  const mutations = f.writes.filter((w) => w.method === "PATCH");
  assert.deepEqual(
    mutations.map((w) => w.args.find((v) => v.startsWith?.("state="))),
    ["state=closed", "state=open"]
  );
  assert(
    f.writes.findIndex((w) => w.endpoint.endsWith("/issues/7/labels")) <
      f.writes.findIndex((w) => w.method === "PATCH")
  );
  assert.deepEqual(
    f.pr.labels.map((l) => l.name),
    ["dependencies"]
  );
  assert.deepEqual(f.pr.reviews, [{ state: "APPROVED" }]);
  assert(
    f.writes.every((w) => !w.endpoint.includes("comments") && !w.endpoint.includes("/git/refs"))
  );
});

test("up-to-date signed dependencies cause no mutation", async () => {
  const f = fixture();
  f.flags.upToDate = true;
  assert.equal(await refreshNative(f), head);
  assert.equal(f.writes.length, 0);
});

test("a terminated runner's labelled machine-closed PR is rediscovered and recovered without another close", async () => {
  const f = fixture();
  f.addIntent();
  f.pr.state = "closed";
  f.event("closed");
  assert.deepEqual(await recoverablePRs(f.request), [7]);
  assert.equal((await prepare(f)).state, "closed");
  assert.equal(await classify(f), true);
  assert.equal(await refreshNative(f), next);
  assert.equal(f.pr.state, "open");
  assert(!f.writes.some((w) => w.args.includes("state=closed")));
  assert(!f.pr.labels.some((l) => l.name === intentLabel));
});

test("reopen failure leaves durable intent and a later sweep restores the PR", async () => {
  const f = fixture();
  f.flags.failOpen = true;
  await assert.rejects(refreshNative(f), /Reopen unavailable/);
  assert.equal(f.pr.state, "closed");
  assert(f.pr.labels.some((l) => l.name === intentLabel));
  assert.deepEqual(await recoverablePRs(f.request), [7]);
  f.flags.failOpen = false;
  await refreshNative(f);
  assert.equal(f.pr.state, "open");
  assert.deepEqual(
    f.pr.labels.map((l) => l.name),
    ["dependencies"]
  );
});

test("a lost close response still runs finally and verifies the reopened state", async () => {
  const f = fixture();
  f.flags.closeResponseLost = true;
  await assert.rejects(refreshNative(f), /Close response unavailable/);
  assert.equal(f.pr.state, "open");
  assert.deepEqual(
    f.pr.labels.map((label) => label.name),
    ["dependencies"]
  );
});

test("a concurrent manual closure is never reversed by finally", async () => {
  const f = fixture();
  f.flags.manualCloseRace = true;
  await assert.rejects(refreshNative(f), /not owned/);
  assert.equal(f.pr.state, "closed");
  assert(!f.writes.some((write) => write.args.includes("state=open")));
});

test("head changes between close and open fail closed and are not automatically recovered", async () => {
  const f = fixture();
  f.flags.changeClosed = true;
  await assert.rejects(refreshNative(f), /SHA/);
  assert.equal(f.pr.state, "closed");
  assert.equal(await ownedIntent(f.pr, f.request), null);
  assert(!f.writes.some((w) => w.args.includes("state=open")));
});

test("unsigned, major, maintainer and unexpected-scope changes cannot be closed or reopened", async () => {
  for (const mutate of [
    (f) => {
      f.commits[0].commit.verification.verified = false;
    },
    (f) => {
      f.env.DEPENDABOT_METADATA = f.env.DEPENDABOT_METADATA.replace("semver-minor", "semver-major");
    },
    (f) => {
      f.env.DEPENDABOT_METADATA = f.env.DEPENDABOT_METADATA.replace(
        '"maintainerChanges":false',
        '"maintainerChanges":true'
      );
    },
    (f) => {
      f.files[0].filename = "index.html";
    },
  ]) {
    const f = fixture();
    f.addIntent();
    f.pr.state = "closed";
    f.event("closed");
    mutate(f);
    await assert.rejects(refreshNative(f), /guard/);
    assert.equal(f.writes.length, 0);
  }
});

test("unmarked, human-closed, obsolete Dependabot-closed and merged PRs are never reopened", async () => {
  for (const actor of [
    { login: "owner", type: "User" },
    { login: "dependabot[bot]", type: "Bot" },
    { login: "github-actions[bot]", type: "User" },
  ]) {
    const f = fixture();
    f.addIntent();
    f.pr.state = "closed";
    f.event("closed", null, actor);
    assert.equal(await ownedIntent(f.pr, f.request), null);
    assert.deepEqual(await recoverablePRs(f.request), []);
    await assert.rejects(refreshNative(f), /not owned/);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  f.pr.state = "closed";
  f.event("closed");
  assert.equal(await ownedIntent(f.pr, f.request), null);
  const g = fixture();
  g.addIntent();
  g.pr.state = "closed";
  g.pr.merged = true;
  g.event("closed");
  assert.equal(await ownedIntent(g.pr, g.request), null);
});

test("forged label ownership or PR authorship never permits crash recovery", async () => {
  const f = fixture();
  f.addIntent();
  f.pr.state = "closed";
  f.event("closed");
  f.events[0].actor = { login: "human", type: "User" };
  assert.equal(await ownedIntent(f.pr, f.request), null);
  const g = fixture();
  g.addIntent();
  g.pr.state = "closed";
  g.event("closed");
  g.pr.user.login = "human";
  assert.equal(await ownedIntent(g.pr, g.request), null);
  const h = fixture();
  h.addIntent();
  h.pr.state = "closed";
  h.event("closed");
  h.pr.labels[2].description = `7 ${head} ${"e".repeat(40)} 1`;
  assert.equal(await ownedIntent(h.pr, h.request), null);
});

test("crashes before close or after reopen clean only owned intent markers on verified open state", async () => {
  for (const afterReopen of [false, true]) {
    const f = fixture();
    f.addIntent();
    if (afterReopen) {
      f.event("closed");
      f.event("reopened");
    }
    await assert.rejects(refreshNative(f), /already pending/);
    assert.equal(f.pr.state, "open");
    assert.deepEqual(
      f.pr.labels.map((l) => l.name),
      ["dependencies"]
    );
    assert(!f.writes.some((w) => w.method === "PATCH"));
  }
});

test("partial intent cleanup resumes without deleting any unrelated label", async () => {
  const f = fixture();
  f.flags.failCleanup = true;
  await assert.rejects(refreshNative(f), /Cleanup unavailable/);
  assert.equal(f.pr.state, "open");
  assert(!f.pr.labels.some((l) => l.name === intentLabel));
  f.flags.failCleanup = false;
  await assert.rejects(refreshNative(f), /already pending/);
  assert.deepEqual(
    f.pr.labels.map((l) => l.name),
    ["dependencies"]
  );
});

test("persistent attempt evidence limits each PR/base to two native requests", async () => {
  const f = fixture();
  f.event("labeled", binder(1), machine, 0);
  f.event("labeled", binder(2), machine, 0);
  await assert.rejects(refreshNative(f), /limit reached/);
  assert.equal(f.writes.length, 0);
  const g = fixture();
  g.addIntent();
  g.pr.labels = g.pr.labels.filter((label) => label.name === "dependencies");
  await assert.rejects(refreshNative(g), /already pending/);
  assert.equal(g.writes.length, 0);
});

test("an unchanged pending head is never requested again after the cooldown expires", async () => {
  const f = fixture();
  f.addIntent();
  f.pr.labels = f.pr.labels.filter((label) => label.name === "dependencies");
  f.age();
  await assert.rejects(refreshNative(f), /already pending/);
  assert.equal(f.writes.length, 0);
});

test("a changed signed head may use the second bounded attempt on the same base", async () => {
  const f = fixture();
  f.addIntent();
  f.pr.labels = f.pr.labels.filter((label) => label.name === "dependencies");
  f.definitions.get(binder()).description = `7 ${"e".repeat(40)} ${base} 1`;
  f.age();
  assert.equal(await refreshNative(f), next);
  assert(f.events.some((event) => event.label?.name === binder(2)));
});

test("a nearly exhausted budget never closes a dependency PR", async () => {
  const f = fixture();
  f.env.DEPENDENCY_DEADLINE = String(f.now() + 1000);
  await assert.rejects(refreshNative(f), /Insufficient maintenance budget/);
  assert.equal(f.writes.length, 0);
});

test("refresh polling approves only while the same verified head remains open", async () => {
  const f = fixture();
  let approvals = 0;
  f.approve = async ({ verify, number, approvedRuns }) => {
    const current = await verify();
    assert.equal(current.state, "open");
    assert.equal(current.head.sha, head);
    assert.equal(number, 7);
    assert(approvedRuns instanceof Set);
    approvals++;
  };
  assert.equal(await refreshNative(f), next);
  assert.equal(approvals, 1);
});

test("default sweeps defer stale heads without label or state churn", async () => {
  const f = fixture();
  assert.deepEqual(await refreshNative({ ...f, phase: "stage" }), { status: "deferred" });
  assert.equal(f.writes.length, 0);
  f.flags.upToDate = true;
  assert.deepEqual(await refreshNative({ ...f, phase: "stage" }), { status: "ready" });
});

test("owner-assisted staging labels but never closes before artifact publication", async () => {
  const f = fixture();
  const staged = await refreshNative({ ...f, phase: "stage", ownerAssisted: true });
  assert.equal(staged.status, "staged");
  assert.equal(f.pr.state, "open");
  assert(!f.writes.some((write) => write.method === "PATCH"));
  assert.equal((await ownedIntent(f.pr, f.request)).name, staged.intent.name);
});

test("machine close and owner-only reopen retain markers until backend cleanup", async () => {
  const f = fixture();
  const staged = await refreshNative({ ...f, phase: "stage", ownerAssisted: true });
  f.flags.headOnPoll = false;
  const advance = f.sleep;
  let ownerSawMarker = false;
  const sleep = async (ms) => {
    await advance(ms);
    if (f.pr.state === "closed") {
      ownerSawMarker = f.pr.labels.some((label) => label.name === intentLabel);
      f.pr.state = "open";
      f.event("reopened", null, { login: "pbuffolino", type: "User" });
    } else f.pr.head.sha = next;
  };
  assert.equal(
    await refreshNative({
      ...f,
      phase: "finish",
      stagedIntent: staged.intent,
      ownerAssisted: true,
      sleep,
    }),
    next
  );
  assert(ownerSawMarker);
  assert.deepEqual(
    f.writes
      .filter((write) => write.method === "PATCH")
      .map((write) => write.args.find((arg) => arg.startsWith?.("state="))),
    ["state=closed"]
  );
  assert.deepEqual(
    f.pr.labels.map((label) => label.name),
    ["dependencies"]
  );
});

test("owner timeout restores open as the machine and clears only its own markers", async () => {
  const f = fixture();
  const staged = await refreshNative({ ...f, phase: "stage", ownerAssisted: true });
  f.flags.headOnPoll = false;
  await assert.rejects(
    refreshNative({ ...f, phase: "finish", stagedIntent: staged.intent, ownerAssisted: true }),
    /handoff timed out/
  );
  assert.equal(f.pr.state, "open");
  assert.deepEqual(
    f.pr.labels.map((label) => label.name),
    ["dependencies"]
  );
});

test("a new head during owner reopening keeps markers until fresh metadata verifies cleanup", async () => {
  const f = fixture();
  const staged = await refreshNative({ ...f, phase: "stage", ownerAssisted: true });
  f.flags.headOnPoll = false;
  const advance = f.sleep;
  const sleep = async (ms) => {
    await advance(ms);
    f.pr.state = "open";
    f.pr.head.sha = next;
    f.event("reopened", null, { login: "pbuffolino", type: "User" });
  };
  assert.equal(
    await refreshNative({
      ...f,
      phase: "finish",
      stagedIntent: staged.intent,
      ownerAssisted: true,
      sleep,
    }),
    next
  );
  assert(f.pr.labels.some((label) => label.name === intentLabel));
  f.env.DEPENDABOT_SHA = next;
  f.commits[0].sha = next;
  await refreshNative({ ...f, phase: "cleanup" });
  assert.deepEqual(
    f.pr.labels.map((label) => label.name),
    ["dependencies"]
  );
});

test("the workflow CLI defaults to native refresh without enabling comment requests", async () => {
  const cli = await fs.readFile(
    new URL("../scripts/reconcile-dependabot.mjs", import.meta.url),
    "utf8"
  );
  assert.match(cli, /mode === "refresh"[\s\S]*?await refreshNative\(/);
  const workflow = await fs.readFile(
    new URL("../.github/workflows/dependabot-reconcile-pr.yml", import.meta.url),
    "utf8"
  );
  assert(!workflow.includes("DEPENDABOT_REBASE_COMMENTS_APPROVED"));
  assert(!workflow.includes("allow-rebase"));
});
