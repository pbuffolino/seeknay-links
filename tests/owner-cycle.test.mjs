import { test } from "node:test";
import assert from "node:assert/strict";
import { assistRequest } from "../scripts/dependency-owner-driver.mjs";
import {
  cycleGrant,
  decodeCycleGrant,
  ownerClosureGrant,
  attachCycleGrant,
} from "../scripts/owner-cycle-intent.mjs";
import { ownedIntent } from "../scripts/native-dependabot-refresh.mjs";
import { requiredChecks } from "../scripts/merge-dependabot.mjs";

const repo = "pbuffolino/seeknay-links",
  head = "a".repeat(40),
  base = "b".repeat(40),
  workflowSha = "c".repeat(40);
const start = Date.parse("2026-10-17T00:00:00Z"),
  bot = { login: "dependabot[bot]", type: "Bot" },
  machine = { login: "github-actions[bot]", type: "Bot" },
  owner = { login: "pbuffolino", type: "User" };
function fixture(closed = false) {
  const intent = { name: `r7-${base}-1`, head, base, attempt: 1 };
  const value = {
    schema: 1,
    repository: repo,
    workflow: ".github/workflows/dependabot-automerge.yml",
    runId: 123,
    runAttempt: 1,
    workflowSha,
    number: 7,
    head,
    base,
    intent,
    createdAt: start + 1000,
    expiresAt: start + 290000,
    mode: "owner-cycle",
    initialState: closed ? "closed" : "open",
    closureId: closed ? 3 : 0,
    dependencies: [
      {
        updateType: "version-update:semver-minor",
        maintainerChanges: false,
        directory: "/",
        targetBranch: "main",
        packageEcosystem: "npm_and_yarn",
      },
    ],
  };
  const grant = cycleGrant(value);
  const pr = {
    number: 7,
    state: closed ? "closed" : "open",
    merged: false,
    draft: false,
    commits: 1,
    changed_files: 1,
    user: bot,
    head: { sha: head, ref: "dependabot/npm_and_yarn/example-1.1.0", repo: { full_name: repo } },
    base: { ref: "main", repo: { full_name: repo } },
    labels: [
      {
        name: "dependency-refresh-intent",
        description: "Reserved for crash-recoverable signed dependency refreshes by GitHub Actions",
      },
      { name: intent.name, description: `7 ${head} ${base} 1` },
      grant,
      { name: "preserve" },
    ],
  };
  const run = {
    id: 123,
    workflow_id: 9,
    path: value.workflow,
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: workflowSha,
    repository: { id: 1, full_name: repo },
    head_repository: { id: 1, full_name: repo },
    actor: owner,
    triggering_actor: owner,
    run_attempt: 1,
    status: "in_progress",
    created_at: new Date(start).toISOString(),
    referenced_workflows: [
      {
        path: `${repo}/.github/workflows/dependabot-reconcile-pr.yml@${workflowSha}`,
        sha: workflowSha,
      },
    ],
  };
  const artifact = {
    id: 42,
    name: "dependency-refresh-123-1-7",
    digest: `sha256:${"d".repeat(64)}`,
    size_in_bytes: 512,
    expired: false,
    created_at: new Date(start + 3000).toISOString(),
    workflow_run: {
      id: 123,
      repository_id: 1,
      head_repository_id: 1,
      head_sha: workflowSha,
      head_branch: "main",
    },
  };
  const events = [
    {
      id: 1,
      event: "labeled",
      actor: machine,
      label: { name: "dependency-refresh-intent" },
      created_at: new Date(start).toISOString(),
    },
    {
      id: 2,
      event: "labeled",
      actor: machine,
      label: { name: intent.name },
      created_at: new Date(start).toISOString(),
    },
  ];
  if (closed)
    events.push({
      id: 3,
      event: "closed",
      actor: machine,
      created_at: new Date(start + 500).toISOString(),
    });
  events.push({
    id: 4,
    event: "labeled",
    actor: machine,
    label: { name: grant.name },
    created_at: new Date(start + 2000).toISOString(),
  });
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
  const commits = [{ sha: head, author: bot, commit: { verification: { verified: true } } }],
    files = [{ filename: "package-lock.json", status: "modified" }],
    writes = [],
    flags = { missing: false };
  let id = 4,
    timestamp = start + 4000;
  function event(name, actor = owner) {
    const e = {
      id: ++id,
      event: name,
      actor,
      created_at: new Date((timestamp += 1000)).toISOString(),
    };
    events.push(e);
    return e;
  }
  const request = async (...args) => {
    const endpoint = args.find((a) => a.startsWith?.("repos/")) || args[1];
    const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
    if (method !== "GET") {
      writes.push({ endpoint, args });
      if (endpoint.endsWith("/git/refs")) {
        flags.missing = false;
        return {};
      }
      if (endpoint.endsWith("/pulls/7")) {
        if (args.includes("state=closed")) {
          pr.state = "closed";
          event("closed");
          if (flags.deleteOnClose) {
            flags.missing = true;
            event("head_ref_deleted", bot);
          }
          if (flags.failAfterClose)
            throw Object.assign(new Error("close receipt failed"), { status: 500 });
        } else {
          if (flags.failReopen) throw Object.assign(new Error("reopen failed"), { status: 500 });
          if (flags.missing) throw Object.assign(new Error("head missing"), { status: 422 });
          pr.state = "open";
          event("reopened");
        }
        return structuredClone(pr);
      }
      return {};
    }
    if (endpoint === "user") return flags.spoof ? bot : owner;
    if (endpoint.endsWith("/pulls/7")) return structuredClone(pr);
    if (endpoint.includes("/files?")) return files;
    if (endpoint.includes("/commits?")) return commits;
    if (endpoint.includes("/events?")) return structuredClone(events);
    if (endpoint.endsWith("/branches/main")) return main;
    if (endpoint.includes("/compare/"))
      return {
        merge_base_commit: {
          sha: flags.nonancestor ? head : endpoint.split("/compare/")[1].split("...")[0],
        },
      };
    if (endpoint.endsWith("/actions/workflows/dependabot-automerge.yml")) return { id: 9 };
    if (endpoint.endsWith("/actions/runs/123")) return run;
    if (endpoint.includes("/jobs?"))
      return {
        total_count: 1,
        jobs: [
          {
            name: "reconcile (7) / inspect",
            status: "completed",
            conclusion: flags.failedInspect ? "failure" : "success",
          },
        ],
      };
    if (endpoint.includes("/git/ref/")) {
      if (flags.missing) throw Object.assign(new Error("missing"), { status: 404 });
      return {
        ref: `refs/heads/${pr.head.ref}`,
        object: { type: "commit", sha: flags.wrongRef ? base : head },
      };
    }
    if (endpoint.includes("/labels/")) {
      const label = pr.labels.find(
        (l) => encodeURIComponent(l.name) === endpoint.split("/labels/")[1]
      );
      if (label) return label;
      throw Object.assign(new Error("absent"), { status: 404 });
    }
    throw new Error("Unexpected owner cycle fixture endpoint");
  };
  return {
    value,
    artifact,
    run,
    pr,
    events,
    main,
    commits,
    files,
    writes,
    flags,
    event,
    request,
    sshRestore: async ({ ref, sha, verifyAbsent }) => {
      await verifyAbsent();
      writes.push({ endpoint: "ssh:create-only", args: [`ref=${ref}`, `sha=${sha}`] });
      flags.missing = false;
    },
    now: () => start + 10000,
  };
}

test("compact durable grant preserves all full SHAs and stays inside native API limits", () => {
  const f = fixture();
  const grant = cycleGrant(f.value),
    decoded = decodeCycleGrant(grant);
  assert(grant.name.length <= 50);
  assert(grant.description.length <= 100);
  assert.equal(decoded.head, head);
  assert.equal(decoded.base, base);
  assert.equal(decoded.workflowSha, workflowSha);
  assert.equal(decoded.createdAt, f.value.createdAt);
  assert.equal(decoded.expiresAt, f.value.expiresAt);
  assert.equal(decodeCycleGrant({ ...grant, description: grant.description + "x" }), null);
});
test("fresh owner artifact authorizes one complete owner close/reopen cycle and preserves labels", async () => {
  const f = fixture();
  await assistRequest(f);
  assert.equal(f.pr.state, "open");
  assert.equal(f.pr.labels.length, 4);
  assert.deepEqual(
    f.writes
      .filter((w) => w.endpoint.endsWith("/pulls/7"))
      .map((w) => w.args.find((a) => a.startsWith("state="))),
    ["state=closed", "state=open"]
  );
  await assistRequest(f);
  assert.equal(f.writes.filter((w) => w.args.includes("state=closed")).length, 1);
});
test("fresh current-run artifact recovers old machine closure and missing signed ref before full owner cycle", async () => {
  const f = fixture(true);
  f.flags.missing = true;
  f.flags.deleteOnClose = true;
  f.event("head_ref_deleted", bot);
  await assistRequest(f);
  assert.equal(f.pr.state, "open");
  assert.equal(f.writes[0].endpoint, "ssh:create-only");
  assert.deepEqual(
    f.writes
      .filter((w) => w.endpoint.endsWith("/pulls/7"))
      .map((w) => w.args.find((a) => a.startsWith("state="))),
    ["state=open", "state=closed", "state=open", "state=open"]
  );
});
test("owner close followed by helper termination remains authenticated and resumes without another close", async () => {
  const f = fixture();
  f.pr.state = "closed";
  f.event("closed");
  assert(await ownedIntent(f.pr, f.request));
  await assistRequest(f);
  assert.equal(f.pr.state, "open");
  assert(!f.writes.some((w) => w.args.includes("state=closed")));
});
test("finally reopens a successfully closed PR after a failed close receipt", async () => {
  const f = fixture();
  f.flags.failAfterClose = true;
  await assert.rejects(assistRequest(f), /close receipt failed/);
  assert.equal(f.pr.state, "open");
});
test("reopen failure leaves durable recovery, later same request resumes and never closes twice", async () => {
  const f = fixture();
  f.flags.failReopen = true;
  await assert.rejects(assistRequest(f), /reopen failed/);
  assert.equal(f.pr.state, "closed");
  assert(await ownedIntent(f.pr, f.request));
  f.flags.failReopen = false;
  await assistRequest(f);
  assert.equal(f.pr.state, "open");
  assert.equal(f.writes.filter((w) => w.args.includes("state=closed")).length, 1);
});
test("owner cycle restores only a deleted absent exact signed branch, never changed existing refs", async () => {
  const f = fixture();
  f.flags.deleteOnClose = true;
  await assistRequest(f);
  assert.equal(f.pr.state, "open");
  assert.equal(f.writes.filter((w) => w.endpoint === "ssh:create-only").length, 1);
  const changed = fixture();
  changed.flags.wrongRef = true;
  changed.pr.state = "closed";
  changed.event("closed");
  await assert.rejects(assistRequest(changed), /never overwrite/);
  assert.equal(changed.writes.length, 0);
});
test("unknown identities, signature/scope/base/inspection changes and malformed timestamps cannot authorize owner writes", async () => {
  const mutations = [
    (f) => (f.flags.spoof = true),
    (f) => (f.commits[0].commit.verification.verified = false),
    (f) => (f.files[0].filename = "index.html"),
    (f) => (f.main.commit.sha = head),
    (f) => (f.flags.nonancestor = true),
    (f) => (f.flags.failedInspect = true),
    (f) => (f.events.at(-1).actor = owner),
    (f) => (f.events.at(-1).created_at = "bad"),
    (f) => (f.run.created_at = "bad"),
    (f) => (f.artifact.created_at = "bad"),
    (f) => (f.run.referenced_workflows = []),
    (f) => (f.value.dependencies[0].updateType = "version-update:semver-major"),
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    await assert.rejects(assistRequest(f));
    assert.equal(f.writes.length, 0);
  }
});
test("manual/obsolete closures, closure outside grant, duplicate/unknown transitions and malformed closure times stay closed", async () => {
  for (const mutate of [
    (f) => f.event("closed", bot),
    (f) => {
      f.event("closed").created_at = "bad";
    },
    (f) => {
      f.event("closed").created_at = new Date(start + 400000).toISOString();
    },
    (f) => {
      f.event("closed");
      f.event("reopened");
      f.event("closed");
    },
  ]) {
    const f = fixture();
    f.pr.state = "closed";
    mutate(f);
    await assert.rejects(assistRequest(f));
    assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  f.pr.state = "closed";
  f.event("closed");
  f.pr.labels = f.pr.labels.filter((l) => !l.name.startsWith("dependency-owner-"));
  assert.equal(await ownedIntent(f.pr, f.request), null);
});
test("expired grant blocks new owner work but preserves authenticated interrupted-closure recovery evidence", async () => {
  const f = fixture();
  f.pr.state = "closed";
  f.event("closed");
  f.now = () => start + 400000;
  await assert.rejects(assistRequest(f), /expired/);
  assert(await ownerClosureGrant(f.pr, f.events, f.request));
  assert.equal(f.writes.length, 0);
});
test("grant publication rejects duplicate unchanged head/base requests before writes", async () => {
  const f = fixture();
  await assert.rejects(attachCycleGrant(f.value, f.request), /already requested/);
  assert.equal(f.writes.length, 0);
});

test("backend waits for the full owner cycle before cleanup, then requires a new head", async () => {
  const { refreshNative } = await import("../scripts/native-dependabot-refresh.mjs");
  const f = fixture(true);
  let clock = start + 10000,
    sleeps = 0;
  const next = "e".repeat(40);
  const result = await refreshNative({
    env: {
      GITHUB_REPOSITORY: repo,
      DEPENDABOT_PR: "7",
      DEPENDABOT_SHA: head,
      DEPENDABOT_METADATA: JSON.stringify(f.value.dependencies),
    },
    request: f.request,
    phase: "finish",
    ownerAssisted: true,
    stagedIntent: f.value.intent,
    stagedRequest: f.value,
    now: () => clock,
    approve: async () => {},
    sleep: async (ms) => {
      clock += ms;
      sleeps++;
      if (sleeps === 1) await assistRequest(f);
      else f.pr.head.sha = next;
    },
  });
  assert.equal(result, next);
  assert.equal(f.writes.filter((w) => w.args.includes("state=closed")).length, 1);
  const finish = f.writes.findIndex((w) => w.args.includes("state=closed"));
  const cleanup = f.writes.findIndex((w) => w.args.includes("DELETE"));
  assert(finish >= 0 && cleanup > finish);
});
test("a head advancing before backend finish is only a signal for fresh metadata, without writes", async () => {
  const { refreshNative } = await import("../scripts/native-dependabot-refresh.mjs");
  const f = fixture();
  f.pr.head.sha = "e".repeat(40);
  const result = await refreshNative({
    env: {
      GITHUB_REPOSITORY: repo,
      DEPENDABOT_PR: "7",
      DEPENDABOT_SHA: head,
      DEPENDABOT_METADATA: JSON.stringify(f.value.dependencies),
    },
    request: f.request,
    phase: "finish",
    ownerAssisted: true,
    stagedIntent: f.value.intent,
    stagedRequest: f.value,
  });
  assert.equal(result, f.pr.head.sha);
  assert.equal(f.writes.length, 0);
});
test("a fresh inspected recovery-only request recovers an expired authorized owner closure without another close", async () => {
  const f = fixture();
  f.pr.state = "closed";
  const closure = f.event("closed");
  const oldRun = f.run;
  const value = {
    ...f.value,
    runId: 124,
    createdAt: start + 400000,
    expiresAt: start + 690000,
    initialState: "closed",
    closureId: closure.id,
    recoverOnly: true,
  };
  const run = { ...oldRun, id: 124, created_at: new Date(start + 390000).toISOString() };
  const grant = cycleGrant(value);
  f.pr.labels.push(grant);
  const attached = f.event("labeled", machine);
  attached.label = { name: grant.name };
  attached.created_at = new Date(start + 401000).toISOString();
  const artifact = {
    ...f.artifact,
    name: "dependency-refresh-124-1-7",
    created_at: new Date(start + 402000).toISOString(),
    workflow_run: { ...f.artifact.workflow_run, id: 124 },
  };
  const request = async (...args) => {
    const endpoint = args.find((a) => a.startsWith?.("repos/"));
    if (endpoint?.endsWith("/actions/runs/124")) return run;
    if (endpoint?.includes("/actions/runs/124/attempts/"))
      return {
        total_count: 1,
        jobs: [{ name: "reconcile (7) / inspect", status: "completed", conclusion: "success" }],
      };
    return f.request(...args);
  };
  await assistRequest({ value, run, artifact, request, now: () => start + 405000 });
  assert.equal(f.pr.state, "open");
  assert(!f.writes.some((w) => w.args.includes("state=closed")));
});

test("owner grants bound changed-head attempts to two per PR/base with a pending interval", async () => {
  const f = fixture();
  const prior = {
    ...f.value,
    runId: 122,
    head: "d".repeat(40),
    createdAt: start - 1000000,
    expiresAt: start - 800000,
  };
  const label = cycleGrant(prior);
  f.pr.labels.push(label);
  const e = f.event("labeled", machine);
  e.label = { name: label.name };
  f.value.head = "e".repeat(40);
  f.value.createdAt = start + 1000000;
  f.value.expiresAt = start + 1200000;
  await assert.rejects(attachCycleGrant(f.value, f.request), /limit reached/);
  assert.equal(f.writes.length, 0);
  const pending = fixture();
  pending.value.head = "e".repeat(40);
  pending.value.createdAt = start + 2000;
  await assert.rejects(attachCycleGrant(pending.value, pending.request), /still pending/);
  assert.equal(pending.writes.length, 0);
});

test("unknown or denied guard reads never trigger SSH, and owner restore makes no REST ref-creation attempt", async () => {
  for (const status of [403, 404, 429, 500]) {
    const f = fixture(true);
    f.flags.missing = true;
    f.event("head_ref_deleted", bot);
    let sshCalls = 0;
    const original = f.request;
    const request = async (...args) => {
      if (args.some((a) => a.includes?.("/files?")))
        throw Object.assign(new Error("guard denied"), { status });
      return original(...args);
    };
    await assert.rejects(
      assistRequest({
        ...f,
        request,
        sshRestore: async () => {
          sshCalls++;
        },
      })
    );
    assert.equal(sshCalls, 0);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(true);
  f.flags.missing = true;
  f.event("head_ref_deleted", bot);
  const original = f.request;
  const request = async (...args) => {
    if (args.includes("POST") && args.some((a) => a.endsWith?.("/git/refs")))
      throw Object.assign(new Error("unexpected owner REST POST"), { status: 404 });
    return original(...args);
  };
  await assistRequest({ ...f, request });
  assert.equal(f.pr.state, "open");
  assert(f.writes.some((w) => w.endpoint === "ssh:create-only"));
});

test("fast cycle has no API roundtrip between close and immediate reopen, then verifies the full timeline", async () => {
  const f = fixture(),
    calls = [],
    original = f.request;
  const request = async (...args) => {
    calls.push(args);
    return original(...args);
  };
  await assistRequest({ ...f, request });
  const closed = calls.findIndex((a) => a.includes("state=closed"));
  assert(closed > 10);
  assert(calls[closed + 1].includes("state=open"));
  assert(calls.slice(closed + 2).some((a) => a.some((v) => v.includes?.("/events?"))));
  assert.equal(f.pr.state, "open");
  assert.equal(f.writes.filter((w) => w.args.includes("state=closed")).length, 1);
});
test("malformed close receipt cannot authorize the fast reopen; only fully guarded recovery may open", async () => {
  const f = fixture(),
    calls = [],
    original = f.request;
  const request = async (...args) => {
    calls.push(args);
    const value = await original(...args);
    if (args.includes("state=closed")) return { ...value, head: { ...value.head, sha: base } };
    return value;
  };
  await assert.rejects(assistRequest({ ...f, request }), /close receipt changed/);
  const closed = calls.findIndex((a) => a.includes("state=closed"));
  assert(!calls[closed + 1].includes("state=open"));
  assert.equal(f.pr.state, "open");
});
test("malformed open receipt reports failure and does not authorize another mutation", async () => {
  const f = fixture(),
    original = f.request;
  const request = async (...args) => {
    const value = await original(...args);
    return args.includes("state=open") ? { ...value, state: "closed" } : value;
  };
  await assert.rejects(assistRequest({ ...f, request }), /immediate reopen receipt failed/);
  assert.equal(f.pr.state, "open");
  assert.equal(f.writes.length, 2);
});
test("unknown closed head at close receipt remains fail-closed without reopening or merging", async () => {
  const f = fixture(),
    original = f.request;
  const request = async (...args) => {
    const value = await original(...args);
    if (args.includes("state=closed")) {
      f.pr.head.sha = base;
      return { ...value, head: { ...value.head, sha: base } };
    }
    return value;
  };
  await assert.rejects(assistRequest({ ...f, request }));
  assert.equal(f.pr.state, "closed");
  assert.equal(f.writes.length, 1);
});
test("post-cycle unknown actor cannot verify success or authorize further writes", async () => {
  const f = fixture(),
    original = f.request;
  const request = async (...args) => {
    const value = await original(...args);
    if (args.includes("state=open")) f.events.at(-1).actor = { login: "unknown", type: "User" };
    return value;
  };
  await assert.rejects(assistRequest({ ...f, request }));
  assert.equal(f.pr.state, "open");
  assert.equal(f.writes.length, 2);
});
test("an open changed head is a nonwriting signal and leaves all eligibility to fresh backend metadata", async () => {
  const f = fixture();
  f.pr.head.sha = "e".repeat(40);
  f.commits[0].commit.verification.verified = false;
  await assistRequest(f);
  assert.equal(f.writes.length, 0);
  const { refreshNative } = await import("../scripts/native-dependabot-refresh.mjs");
  await refreshNative({
    env: {
      GITHUB_REPOSITORY: repo,
      DEPENDABOT_PR: "7",
      DEPENDABOT_SHA: head,
      DEPENDABOT_METADATA: JSON.stringify(f.value.dependencies),
    },
    request: f.request,
    phase: "cleanup",
  });
  assert.equal(f.writes.length, 0);
  assert(f.pr.labels.some((l) => l.name === "dependency-refresh-intent"));
});
test("head advancing immediately after fast reopen causes no stale-signature cleanup failure or additional write", async () => {
  const f = fixture(),
    original = f.request;
  const request = async (...args) => {
    const value = await original(...args);
    if (args.includes("state=open")) {
      f.pr.head.sha = "e".repeat(40);
      f.commits[0].commit.verification.verified = false;
    }
    return value;
  };
  await assistRequest({ ...f, request });
  assert.equal(f.pr.state, "open");
  assert.equal(f.writes.length, 2);
});

test("a nearly expired owner grant cannot start a new close cycle", async () => {
  const f = fixture();
  f.now = () => start + 170000;
  await assert.rejects(assistRequest(f), /Insufficient grant lifetime/);
  assert.equal(f.writes.length, 0);
});
test("a close event outside the grant window cannot pass post-cycle verification", async () => {
  const f = fixture(),
    original = f.request;
  const request = async (...args) => {
    const value = await original(...args);
    if (args.includes("state=open"))
      f.events.find((e) => e.event === "closed").created_at = new Date(
        start + 400000
      ).toISOString();
    return value;
  };
  await assert.rejects(assistRequest({ ...f, request }), /post-receipt timeline/);
  assert.equal(f.pr.state, "open");
  assert.equal(f.writes.length, 2);
});

test("completed backend cleanup after a verified owner reopen is only a nonwriting signal", async () => {
  for (const afterReopen of [false, true]) {
    const f = fixture(),
      original = f.request;
    const definitions = new Map(f.pr.labels.map((label) => [label.name, label]));
    const finish = () => {
      f.pr.head.sha = "e".repeat(40);
      for (const name of [
        "dependency-refresh-intent",
        f.value.intent.name,
        cycleGrant(f.value).name,
      ]) {
        const removed = f.event("unlabeled", machine);
        removed.label = { name };
      }
      f.pr.labels = [{ name: "preserve" }];
    };
    if (!afterReopen) {
      f.event("closed");
      f.event("reopened");
      finish();
    }
    const request = async (...args) => {
      const endpoint = args.find((arg) => arg.startsWith?.("repos/"));
      if (endpoint?.includes("/labels/")) {
        const label = definitions.get(decodeURIComponent(endpoint.split("/labels/")[1]));
        if (label) return label;
      }
      const result = await original(...args);
      if (afterReopen && args.includes("state=open")) finish();
      return result;
    };
    await assistRequest({ ...f, request });
    assert.equal(f.pr.state, "open");
    assert.equal(f.writes.length, afterReopen ? 2 : 0);
    assert.deepEqual(f.pr.labels, [{ name: "preserve" }]);
  }
});

test("missing cleanup intent never authorizes a write or hides a closed or unchanged head", async () => {
  for (const mutate of [
    () => {},
    (f) => {
      f.pr.head.sha = "e".repeat(40);
      f.pr.state = "closed";
    },
    (f) => {
      f.pr.head.sha = "e".repeat(40);
      f.pr.head.repo.full_name = "other/repo";
    },
    (f) => {
      f.pr.head.sha = "e".repeat(40);
      f.pr.user = owner;
    },
    (f) => {
      f.pr.head.sha = "e".repeat(40);
      f.run.run_attempt = 2;
    },
  ]) {
    const f = fixture();
    f.pr.labels = [{ name: "preserve" }];
    mutate(f);
    await assert.rejects(assistRequest(f));
    assert.equal(f.writes.length, 0);
  }
});

test("cleanup acknowledgement requires the exact durable grant, owner timeline and machine removals", async () => {
  for (const mutate of [
    (f) => {
      f.events.at(-1).actor = owner;
    },
    (f) => {
      f.events.find((event) => event.event === "reopened").actor = bot;
    },
    (f) => {
      f.events.find((event) => event.event === "closed").created_at = new Date(
        start + 400000
      ).toISOString();
    },
    (f) => {
      f.event("closed");
    },
    (f) => {
      f.events.at(-1).id = 1;
    },
    (f, definitions) => {
      definitions.get(cycleGrant(f.value).name).description = "forged";
    },
    (f) => {
      f.flags.failedInspect = true;
    },
    (f) => {
      f.run.head_sha = "f".repeat(40);
    },
    (f) => {
      f.artifact.digest = "invalid";
    },
    (f) => {
      f.value.expiresAt = start;
    },
  ]) {
    const f = fixture(),
      original = f.request;
    const definitions = new Map(f.pr.labels.map((label) => [label.name, { ...label }]));
    f.event("closed");
    f.event("reopened");
    for (const name of [
      "dependency-refresh-intent",
      f.value.intent.name,
      cycleGrant(f.value).name,
    ]) {
      const removed = f.event("unlabeled", machine);
      removed.label = { name };
    }
    f.pr.head.sha = "e".repeat(40);
    f.pr.labels = [{ name: "preserve" }];
    mutate(f, definitions);
    const request = async (...args) => {
      const endpoint = args.find((arg) => arg.startsWith?.("repos/"));
      if (endpoint?.includes("/labels/")) {
        const label = definitions.get(decodeURIComponent(endpoint.split("/labels/")[1]));
        if (label) return label;
      }
      return original(...args);
    };
    await assert.rejects(assistRequest({ ...f, request }));
    assert.equal(f.writes.length, 0);
  }
});
