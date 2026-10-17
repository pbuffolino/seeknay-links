import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ownerRequest, validOwnerRequest } from "../scripts/owner-refresh-protocol.mjs";
import {
  assistRequest,
  trustedRun,
  trustedArtifact,
  ownerDriver,
  downloadRequest,
} from "../scripts/dependency-owner-driver.mjs";
import { requiredChecks } from "../scripts/merge-dependabot.mjs";

const repo = "pbuffolino/seeknay-links",
  root = `repos/${repo}`;
const head = "a".repeat(40),
  base = "b".repeat(40),
  workflowSha = "c".repeat(40);
const start = Date.parse("2026-10-17T00:00:00Z");
const machine = { login: "github-actions[bot]", type: "Bot" },
  owner = { login: "pbuffolino", type: "User" };
function fixture() {
  const env = {
    GITHUB_REPOSITORY: repo,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: workflowSha,
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "2",
    DEPENDABOT_PR: "7",
    DEPENDABOT_SHA: head,
    DEPENDABOT_OWNER_ASSISTED: "true",
    DEPENDENCY_DEADLINE: String(start + 500000),
    DEPENDABOT_METADATA: JSON.stringify([
      {
        updateType: "version-update:semver-minor",
        maintainerChanges: false,
        directory: "/",
        targetBranch: "main",
        packageEcosystem: "npm_and_yarn",
        ignoredUntrustedField: "never copied",
      },
    ]),
  };
  const intent = { name: `r7-${base}-1`, head, base, attempt: 1 };
  const value = ownerRequest(env, intent, start + 1000);
  const run = {
    id: 123,
    workflow_id: 9,
    path: ".github/workflows/dependabot-automerge.yml",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: workflowSha,
    repository: { id: 1, full_name: repo },
    head_repository: { id: 1, full_name: repo },
    actor: owner,
    triggering_actor: owner,
    run_attempt: 2,
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
    name: "dependency-refresh-123-2-7",
    digest: `sha256:${"d".repeat(64)}`,
    size_in_bytes: 1024,
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
  const pr = {
    number: 7,
    state: "closed",
    merged: false,
    draft: false,
    commits: 1,
    changed_files: 1,
    user: { login: "dependabot[bot]" },
    head: { sha: head, ref: "dependabot/npm_and_yarn/example-1.1.0", repo: { full_name: repo } },
    base: { ref: "main", repo: { full_name: repo } },
    labels: [
      {
        name: "dependency-refresh-intent",
        description: "Reserved for crash-recoverable signed dependency refreshes by GitHub Actions",
      },
      { name: intent.name, description: `7 ${head} ${base} 1` },
      { name: "preserve" },
    ],
  };
  const files = [{ filename: "package-lock.json", status: "modified" }],
    commits = [
      {
        sha: head,
        author: { login: "dependabot[bot]" },
        commit: { verification: { verified: true } },
      },
    ];
  const events = [
    {
      id: 1,
      event: "labeled",
      label: { name: "dependency-refresh-intent" },
      actor: machine,
      created_at: new Date(start + 2000).toISOString(),
    },
    {
      id: 2,
      event: "labeled",
      label: { name: intent.name },
      actor: machine,
      created_at: new Date(start + 2000).toISOString(),
    },
    { id: 3, event: "closed", actor: machine, created_at: new Date(start + 4000).toISOString() },
  ];
  const protection = {
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
  const jobs = {
    total_count: 1,
    jobs: [{ name: "reconcile (7) / inspect", status: "completed", conclusion: "success" }],
  };
  const writes = [],
    flags = {};
  let clock = start + 30000,
    loops = 0;
  const request = async (...args) => {
    const endpoint = args.find((arg) => arg.startsWith?.("repos/") || arg === "user");
    if (args.includes("--method")) {
      writes.push(args);
      if (endpoint.endsWith("/git/refs")) {
        flags.missingRef = false;
        return {};
      }
      assert(args.includes("state=open"));
      if (flags.deleteDuringOpen) {
        flags.deleteDuringOpen = false;
        flags.missingRef = true;
        events.push({
          id: Math.max(...events.map((event) => event.id)) + 1,
          event: "head_ref_deleted",
          actor: { login: "dependabot[bot]", type: "Bot" },
          created_at: new Date(clock).toISOString(),
        });
        const error = new Error("reopen validation");
        error.status = 422;
        throw error;
      }
      pr.state = "open";
      events.push({
        id: Math.max(...events.map((event) => event.id)) + 1,
        event: "reopened",
        actor: owner,
        created_at: new Date(clock).toISOString(),
      });
      return structuredClone(pr);
    }
    if (endpoint === "user") return flags.wrongOwner ? { login: "another", type: "User" } : owner;
    if (endpoint.includes("/git/ref/heads/")) {
      if (flags.missingRef) {
        const error = new Error("missing");
        error.status = 404;
        throw error;
      }
      return { ref: `refs/heads/${pr.head.ref}`, object: { type: "commit", sha: head } };
    }
    if (endpoint.endsWith("/actions/workflows/dependabot-automerge.yml")) return { id: 9 };
    if (endpoint.endsWith("/actions/runs/123")) return structuredClone(run);
    if (endpoint.includes("/artifacts?"))
      return { total_count: 1, artifacts: flags.artifacts || [artifact] };
    if (endpoint.includes("/jobs?")) return jobs;
    if (endpoint.includes("/events?")) return events;
    if (endpoint.includes("/files?")) return files;
    if (endpoint.includes("/commits?")) return commits;
    if (endpoint.endsWith("/branches/main")) return protection;
    if (endpoint.includes("/compare/")) return { merge_base_commit: { sha: workflowSha } };
    if (endpoint.endsWith("/pulls/7")) return structuredClone(pr);
    throw new Error("Unexpected owner fixture request");
  };
  return {
    env,
    value,
    run,
    artifact,
    pr,
    events,
    files,
    commits,
    protection,
    jobs,
    writes,
    flags,
    request,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      loops++;
      if (flags.onSleep) flags.onSleep(loops);
    },
  };
}

test("request payload is bounded, dispatch-only, and copies only required public metadata", () => {
  const f = fixture();
  assert(validOwnerRequest(f.value, f.now()));
  assert(!JSON.stringify(f.value).includes("ignoredUntrustedField"));
  for (const change of [
    { GITHUB_EVENT_NAME: "schedule" },
    { GITHUB_REF: "refs/pull/7/head" },
    { DEPENDABOT_OWNER_ASSISTED: "false" },
  ])
    assert.throws(() => ownerRequest({ ...f.env, ...change }, f.value.intent, start + 1000));
  for (const delta of [
    { head: "bad" },
    { runAttempt: 0 },
    { expiresAt: start },
    { intent: { ...f.value.intent, name: "forged" } },
    { dependencies: [null] },
  ])
    assert.equal(validOwnerRequest({ ...f.value, ...delta }, f.now()), false);
});

test("owner helper reopens only a complete provenance-bound machine closure and leaves markers/reviews alone", async () => {
  const f = fixture();
  assert(await assistRequest(f));
  assert.equal(f.pr.state, "open");
  assert.equal(f.writes.length, 1);
  assert.equal(f.pr.labels.length, 3);
  assert(f.writes[0].includes(`${root}/pulls/7`));
});

test("owner handoff restores only its bot-deleted signed ref before the verified owner reopen", async () => {
  const f = fixture();
  f.flags.missingRef = true;
  f.events.push({
    id: 4,
    event: "head_ref_deleted",
    actor: { login: "dependabot[bot]", type: "Bot" },
    created_at: new Date(start + 5000).toISOString(),
  });
  assert(await assistRequest(f));
  assert.equal(f.writes.length, 2);
  assert(f.writes[0].includes(`${root}/git/refs`));
  assert(f.writes[0].includes(`sha=${head}`));
  assert(f.writes[1].includes("state=open"));
  assert.equal(f.pr.labels.length, 3);
});

test("a deletion racing the final owner reopen permits one guarded restoration/reopen retry", async () => {
  const f = fixture();
  f.flags.deleteDuringOpen = true;
  assert(await assistRequest(f));
  assert.equal(f.writes.filter((args) => args.includes("state=open")).length, 2);
  assert.equal(f.writes.filter((args) => args.includes(`${root}/git/refs`)).length, 1);
  assert.equal(f.pr.state, "open");
});

test("unmarked, human, obsolete, author-spoofed, unsigned and changed-head closures never reopen", async () => {
  for (const mutate of [
    (f) => {
      f.pr.labels = [];
    },
    (f) => {
      f.events[2].actor = owner;
    },
    (f) => {
      f.events[2].actor = { login: "dependabot[bot]", type: "Bot" };
    },
    (f) => {
      f.events[2].actor = { login: "github-actions[bot]", type: "User" };
    },
    (f) => {
      f.pr.user.login = "human";
    },
    (f) => {
      f.commits[0].commit.verification.verified = false;
    },
    (f) => {
      f.pr.head.sha = "e".repeat(40);
    },
    (f) => {
      f.value.dependencies[0].maintainerChanges = true;
    },
    (f) => {
      f.files[0].filename = "index.html";
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(assistRequest(f));
    assert.equal(f.writes.length, 0);
  }
});

test("replayed closure, stale artifact/run/attempt and wrong owner fail closed", async () => {
  for (const mutate of [
    (f) => {
      f.events.push(
        { id: 4, event: "reopened", actor: owner },
        { id: 5, event: "closed", actor: machine, created_at: new Date(start + 4000).toISOString() }
      );
    },
    (f) => {
      f.artifact.workflow_run.id = 124;
    },
    (f) => {
      f.value.runAttempt = 1;
    },
    (f) => {
      f.value.expiresAt = start;
    },
    (f) => {
      f.run.status = "completed";
    },
    (f) => {
      f.run.head_sha = "e".repeat(40);
    },
    (f) => {
      f.flags.wrongOwner = true;
    },
    (f) => {
      f.protection.commit.sha = "e".repeat(40);
    },
    (f) => {
      f.protection.protected = false;
    },
    (f) => {
      f.jobs.jobs[0].conclusion = "failure";
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(assistRequest(f));
    assert.equal(f.writes.length, 0);
  }
});

test("artifact before close is readiness-only; currently open PRs are never closed by the owner", async () => {
  const f = fixture();
  f.pr.state = "open";
  assert.equal(await assistRequest(f), false);
  assert.equal(f.writes.length, 0);
});

test("owner driver waits without writes for requested/pending/queued and missing graph evidence", async () => {
  for (const status of ["requested", "pending", "queued", "waiting"]) {
    const f = fixture();
    f.run.status = status;
    f.run.referenced_workflows = [];
    f.flags.onSleep = () => {
      assert.equal(f.writes.length, 0);
      f.run.status = "completed";
      f.run.conclusion = "success";
      f.run.referenced_workflows = [
        {
          path: `${repo}/.github/workflows/dependabot-reconcile-pr.yml@${workflowSha}`,
          sha: workflowSha,
        },
      ];
    };
    await ownerDriver({
      ...f,
      runId: 123,
      sha: workflowSha,
      env: {},
      download: async () => {
        throw new Error("No download allowed before readiness");
      },
    });
    assert.equal(f.writes.length, 0);
  }
});

test("driver skips older attempts, serves current request once, and waits for backend completion", async () => {
  const f = fixture();
  f.flags.artifacts = [
    { ...f.artifact, id: 41, name: "dependency-refresh-123-1-malformed" },
    f.artifact,
  ];
  f.flags.onSleep = () => {
    f.run.status = "completed";
    f.run.conclusion = "success";
  };
  let downloads = 0;
  await ownerDriver({
    ...f,
    runId: 123,
    sha: workflowSha,
    env: {},
    download: async () => {
      downloads++;
      return f.value;
    },
  });
  assert.equal(downloads, 1);
  assert.equal(f.writes.length, 1);
});

test("malformed current-attempt requests and token/host overrides cannot drive owner writes", async () => {
  const f = fixture();
  f.artifact.name = "dependency-refresh-123-2-malformed";
  await assert.rejects(ownerDriver({ ...f, runId: 123, sha: workflowSha, env: {} }));
  assert.equal(f.writes.length, 0);
  for (const env of [{ GH_TOKEN: "test" }, { GITHUB_TOKEN: "test" }, { GH_HOST: "other.invalid" }])
    await assert.rejects(ownerDriver({ runId: 123, sha: workflowSha, env }));
});

test("trusted run/artifact require full identity and bounded immutable digest evidence", () => {
  const f = fixture();
  assert(trustedRun(f.run, 123, workflowSha, 9));
  assert(trustedArtifact(f.artifact, f.run, f.now()));
  for (const delta of [
    { event: "pull_request_target" },
    { path: ".github/workflows/unknown.yml" },
    { actor: machine },
    { head_branch: "feature" },
    { referenced_workflows: [] },
  ])
    assert(!trustedRun({ ...f.run, ...delta }, 123, workflowSha, 9));
  for (const delta of [
    { digest: "bad" },
    { size_in_bytes: 999999 },
    { expired: true },
    { created_at: new Date(start + 900000).toISOString() },
  ])
    assert(!trustedArtifact({ ...f.artifact, ...delta }, f.run, f.now()));
});

test("archive reader verifies bytes, rejects all other paths, parses data only, and bounds output", async () => {
  const bytes = Buffer.from("binary\u001bfixture"),
    digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const artifact = { id: 42, digest };
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "gh") return { stdout: bytes };
    if (args[0] === "-Z1") return { stdout: "refresh-request.json\n" };
    return { stdout: '{"schema":1}' };
  };
  assert.deepEqual(await downloadRequest(artifact, { execute }), { schema: 1 });
  assert(calls[0].args.includes("--allow-escape-sequences"));
  assert.equal(calls[0].options.encoding, null);
  await assert.rejects(
    downloadRequest({ ...artifact, digest: `sha256:${"0".repeat(64)}` }, { execute })
  );
  for (const entry of [
    "../refresh-request.json",
    "directory/refresh-request.json",
    "refresh-request.json\nsecond.json",
  ])
    await assert.rejects(
      downloadRequest(artifact, {
        execute: async (command, args, options) =>
          args[0] === "-Z1" ? { stdout: entry } : execute(command, args, options),
      })
    );
});
