import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approveDependencyRuns,
  matchingDependencyRun,
  safeDependencyPR,
  requiredChecks,
  mergeDependabot,
} from "../scripts/merge-dependabot.mjs";

const repo = "pbuffolino/seeknay-links",
  sha = "a".repeat(40),
  base = "b".repeat(40);
function fixture() {
  const pr = {
    number: 7,
    state: "open",
    merged: false,
    draft: false,
    commits: 1,
    changed_files: 1,
    mergeable_state: "clean",
    user: { login: "dependabot[bot]" },
    head: { sha, ref: "dependabot/npm_and_yarn/example-1.1.0", repo: { full_name: repo } },
    base: { ref: "main", repo: { full_name: repo } },
  };
  const files = [{ filename: "package-lock.json", status: "modified" }];
  const commits = [
    { sha, author: { login: "dependabot[bot]" }, commit: { verification: { verified: true } } },
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
  const runs = ["ci.yml", "codeql.yml"].map((name, index) => ({
    id: index + 1,
    repository: { full_name: repo },
    head_sha: sha,
    head_branch: pr.head.ref,
    event: "pull_request",
    path: `.github/workflows/${name}`,
    pull_requests: [{ number: 7 }],
    status: "completed",
    conclusion: "action_required",
  }));
  const writes = [],
    approvedRuns = new Set(),
    flags = {};
  let verifications = 0,
    merged = false;
  const verify = async () => {
    verifications++;
    if (flags.changeBeforeApproval && verifications > 1)
      commits[0].commit.verification.verified = false;
    if (!safeDependencyPR(pr, files, commits, repo, sha, dependencies))
      throw new Error("Full dependency guard failed");
    return structuredClone(pr);
  };
  const request = async (...args) => {
    const endpoint = args.find((arg) => arg.startsWith?.("repos/"));
    if (args.includes("--method")) {
      writes.push(args);
      if (endpoint.endsWith("/approve")) return {};
      if (endpoint.endsWith("/merge")) {
        merged = true;
        return { merged: true };
      }
      return {};
    }
    if (endpoint.includes("/actions/runs?")) return { workflow_runs: structuredClone(runs) };
    if (/\/actions\/runs\/\d+$/.test(endpoint)) {
      const value = structuredClone(
        runs.find((run) => run.id === Number(endpoint.split("/").at(-1)))
      );
      if (flags.runRace) value.head_sha = "c".repeat(40);
      if (flags.alreadyStarted) value.status = "in_progress";
      return value;
    }
    if (endpoint.endsWith("/branches/main")) return protection;
    if (endpoint.includes("/files?")) return files;
    if (endpoint.includes("/commits?")) return commits;
    if (endpoint.includes("/analyses?"))
      return ["/language:actions", "/language:javascript-typescript"].map((category) => ({
        category,
        commit_sha: sha,
        tool: { name: "CodeQL" },
        error: "",
        warning: "",
      }));
    if (endpoint.includes("/alerts?")) return [];
    if (endpoint.includes("/compare/")) return { merge_base_commit: { sha: base } };
    if (endpoint.endsWith("/pulls/7"))
      return merged ? { ...pr, merged: true, merge_commit_sha: "d".repeat(40) } : pr;
    throw new Error("Unexpected approval fixture request");
  };
  const env = {
    GITHUB_REPOSITORY: repo,
    DEPENDABOT_PR: "7",
    DEPENDABOT_SHA: sha,
    DEPENDABOT_METADATA: JSON.stringify(dependencies),
  };
  return {
    pr,
    files,
    commits,
    runs,
    flags,
    protection,
    request,
    verify,
    number: 7,
    approvedRuns,
    writes,
    env,
  };
}

test("only exact dependency CI/CodeQL runs can be approved, once per run", async () => {
  const f = fixture();
  assert.equal((await approveDependencyRuns(f)).ci.id, 1);
  await approveDependencyRuns(f);
  assert.equal(f.writes.length, 2);
  assert(
    f.writes.every((args) => args.some((value) => /\/actions\/runs\/[12]\/approve$/.test(value)))
  );
});

test("repository, workflow path, event, SHA, branch, PR and run identity mismatches are never approved", async () => {
  for (const delta of [
    { repository: { full_name: "other/repo" } },
    { path: ".github/workflows/unknown.yml" },
    { event: "workflow_dispatch" },
    { head_sha: "c".repeat(40) },
    { head_branch: "dependabot/other" },
    { pull_requests: [{ number: 8 }] },
    { pull_requests: [{ number: 7 }, { number: 8 }] },
    { id: "1" },
  ]) {
    const f = fixture();
    f.runs.splice(1);
    Object.assign(f.runs[0], delta);
    assert.equal(matchingDependencyRun(f.runs, f.pr, 7, ".github/workflows/ci.yml"), undefined);
    await approveDependencyRuns(f);
    assert.equal(f.writes.length, 0);
  }
});

test("changed signature, native protection or detailed run identity blocks every approval", async () => {
  for (const flag of ["changeBeforeApproval", "runRace", "protection"]) {
    const f = fixture();
    f.flags[flag] = true;
    if (flag === "protection") f.protection.protected = false;
    await assert.rejects(approveDependencyRuns(f), /guard|changed/);
    assert.equal(f.writes.length, 0);
  }
});

test("a workflow approved concurrently is left alone; incomplete history blocks writes", async () => {
  const f = fixture();
  f.flags.alreadyStarted = true;
  await approveDependencyRuns(f);
  assert.equal(f.writes.length, 0);
  const g = fixture();
  g.runs.push(...Array.from({ length: 98 }, () => ({})));
  await assert.rejects(approveDependencyRuns(g), /Incomplete/);
  assert.equal(g.writes.length, 0);
});

test("action_required is approved and waited on before exact-head protected merge", async () => {
  const f = fixture();
  let clock = 0,
    sleeps = 0;
  assert.equal(
    await mergeDependabot({
      env: f.env,
      request: f.request,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        sleeps++;
        f.runs.forEach((run) => {
          run.conclusion = "success";
        });
      },
    }),
    "d".repeat(40)
  );
  assert(sleeps >= 1);
  assert.equal(
    f.writes.filter((args) => args.some((value) => value.endsWith("/approve"))).length,
    2
  );
  assert.equal(f.writes.filter((args) => args.some((value) => value.endsWith("/merge"))).length, 1);
});

test("a real current CodeQL workflow failure remains terminal", async () => {
  const f = fixture();
  f.runs.forEach((run) => {
    run.conclusion = "success";
  });
  f.runs[1].conclusion = "failure";
  await assert.rejects(mergeDependabot({ env: f.env, request: f.request }), /CI did not succeed/);
  assert.equal(f.writes.length, 0);
});
