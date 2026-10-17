import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeDependencyPR,
  protectedBranch,
  matchingCI,
  mergeDependabot,
  requiredChecks,
  successfulScans,
} from "../scripts/merge-dependabot.mjs";

const repo = "pbuffolino/seeknay-links";
const sha = "a".repeat(40);
function fixture() {
  return {
    pr: {
      state: "open",
      draft: false,
      user: { login: "dependabot[bot]" },
      base: { ref: "main", repo: { full_name: repo } },
      head: { ref: "dependabot/npm_and_yarn/example", sha, repo: { full_name: repo } },
      commits: 1,
      changed_files: 1,
      mergeable_state: "clean",
    },
    files: [{ filename: "package-lock.json", status: "modified" }],
    commits: [
      { sha, author: { login: "dependabot[bot]" }, commit: { verification: { verified: true } } },
    ],
    dependencies: [
      {
        updateType: "version-update:semver-patch",
        maintainerChanges: false,
        directory: "/",
        targetBranch: "main",
        packageEcosystem: "npm_and_yarn",
      },
    ],
    protection: {
      requiresStatusChecks: true,
      requiresStrictStatusChecks: true,
      requiredStatusChecks: requiredChecks.map((context) => ({
        context,
        app: { databaseId: 15368 },
      })),
    },
  };
}
const safe = (data) =>
  safeDependencyPR(data.pr, data.files, data.commits, repo, sha, data.dependencies);
test("permits a signed same-repository patch or minor dependency update", () => {
  const data = fixture();
  assert.equal(safe(data), true);
  data.dependencies[0].updateType = "version-update:semver-minor";
  assert.equal(safe(data), true);
});
for (const [name, mutate] of Object.entries({
  "major update": (data) => {
    data.dependencies[0].updateType = "version-update:semver-major";
  },
  "unknown update": (data) => {
    delete data.dependencies[0].updateType;
  },
  "mixed major group": (data) => {
    data.dependencies.push({ ...data.dependencies[0], updateType: "version-update:semver-major" });
  },
  "maintainer change": (data) => {
    data.dependencies[0].maintainerChanges = true;
  },
  fork: (data) => {
    data.pr.head.repo.full_name = "other/repo";
  },
  "human PR": (data) => {
    data.pr.user.login = "pbuffolino";
  },
  "draft PR": (data) => {
    data.pr.draft = true;
  },
  "changed head": (data) => {
    data.pr.head.sha = "b".repeat(40);
  },
  "unsigned commit": (data) => {
    data.commits[0].commit.verification.verified = false;
  },
  "human commit": (data) => {
    data.commits[0].author.login = "pbuffolino";
  },
  "added commit": (data) => {
    data.pr.commits = 2;
  },
  "UX change": (data) => {
    data.files[0].filename = "index.html";
  },
  "renamed file": (data) => {
    data.files[0].previous_filename = "index.html";
  },
  "new file": (data) => {
    data.files[0].status = "added";
  },
  "truncated file list": (data) => {
    data.pr.changed_files = 101;
  },
  "other directory": (data) => {
    data.dependencies[0].directory = "/nested";
  },
  "other target": (data) => {
    data.dependencies[0].targetBranch = "release";
  },
  "empty metadata": (data) => {
    data.dependencies = [];
  },
})) {
  test(`rejects ${name}`, () => {
    const data = fixture();
    mutate(data);
    assert.equal(safe(data), false);
  });
}
test("action updates permit only matched SHA pins in existing workflows", () => {
  const data = fixture();
  data.dependencies[0].packageEcosystem = "github_actions";
  data.files[0] = {
    filename: ".github/workflows/ci.yml",
    status: "modified",
    patch: `@@ -1 +1 @@\n-      - uses: actions/checkout@${sha} # v7.0.1\n+      - uses: actions/checkout@${"b".repeat(40)} # v7.1.0`,
  };
  assert.equal(safe(data), true);
  for (const change of [
    (patch) => patch + "\n+      - run: echo injected",
    (patch) => patch.replace("# v7.1.0", "# v8.0.0"),
    (patch) => patch.replace("+      - uses: actions/checkout", "+      - uses: attacker/checkout"),
    (patch) => patch.replace("b".repeat(40), "main"),
  ]) {
    assert.equal(
      safe({ ...data, files: [{ ...data.files[0], patch: change(data.files[0].patch) }] }),
      false
    );
  }
  delete data.files[0].patch;
  assert.equal(safe(data), false);
});
test("requires all named checks from GitHub Actions with strict base freshness", () => {
  const data = fixture();
  assert.equal(protectedBranch(data.protection), true);
  data.protection.requiresStrictStatusChecks = false;
  assert.equal(protectedBranch(data.protection), false);
  data.protection.requiresStrictStatusChecks = true;
  data.protection.requiredStatusChecks[0].app = null;
  assert.equal(protectedBranch(data.protection), false);
});
test("CI match binds workflow, PR number, event, and exact head", () => {
  const run = {
    head_sha: sha,
    event: "pull_request",
    path: ".github/workflows/ci.yml",
    pull_requests: [{ number: 123 }],
  };
  assert.equal(matchingCI([run], sha, 123), run);
  for (const different of [
    { head_sha: "b".repeat(40) },
    { event: "workflow_dispatch" },
    { path: ".github/workflows/other.yml" },
    { pull_requests: [{ number: 999 }] },
  ])
    assert.equal(matchingCI([{ ...run, ...different }], sha, 123), undefined);
});
test("requires both current CodeQL analyses without errors or coverage warnings", () => {
  const analyses = ["/language:actions", "/language:javascript-typescript"].map((category) => ({
    category,
    commit_sha: sha,
    tool: { name: "CodeQL" },
    error: "",
    warning: "",
  }));
  assert.equal(successfulScans(analyses, sha), true);
  assert.equal(successfulScans(analyses.slice(1), sha), false);
  for (const delta of [
    { commit_sha: "b".repeat(40) },
    { error: "Failed" },
    { warning: "Partial coverage" },
    { tool: { name: "Other" } },
  ])
    assert.equal(successfulScans([{ ...analyses[0], ...delta }, analyses[1]], sha), false);
});
test("merges by SHA only after guards and successful CI, then requests Pages publication", async () => {
  const data = fixture();
  const writes = [];
  const env = {
    GITHUB_REPOSITORY: repo,
    DEPENDABOT_PR: "123",
    DEPENDABOT_SHA: sha,
    DEPENDABOT_METADATA: JSON.stringify(data.dependencies),
  };
  const request = async (...args) => {
    if (args.includes("--method")) {
      writes.push(args);
      return { merged: true };
    }
    const endpoint = args[1];
    if (endpoint.includes("/code-scanning/analyses?"))
      return ["/language:actions", "/language:javascript-typescript"].map((category) => ({
        category,
        commit_sha: sha,
        tool: { name: "CodeQL" },
        error: "",
        warning: "",
      }));
    if (endpoint.includes("/code-scanning/alerts?")) return [];
    if (endpoint.endsWith("/files?per_page=100")) return data.files;
    if (endpoint.endsWith("/commits?per_page=100")) return data.commits;
    if (endpoint === "graphql")
      return { data: { repository: { ref: { branchProtectionRule: data.protection } } } };
    if (endpoint.includes("/runs?"))
      return {
        workflow_runs: [
          {
            head_sha: sha,
            event: "pull_request",
            path: ".github/workflows/ci.yml",
            pull_requests: [{ number: 123 }],
            status: "completed",
            conclusion: "success",
          },
        ],
      };
    return writes.length ? { ...data.pr, merged: true } : data.pr;
  };
  await mergeDependabot({ env, request });
  assert.equal(writes.length, 2);
  assert(writes[0].includes(`sha=${sha}`));
  assert(writes[1].includes(`repos/${repo}/pages/builds`));
  writes.length = 0;
  data.commits[0].commit.verification.verified = false;
  await assert.rejects(mergeDependabot({ env, request }), /guard/);
  assert.equal(writes.length, 0);
});
test("a code-scanning alert or failed CI prevents every write", async () => {
  const data = fixture();
  const env = {
    GITHUB_REPOSITORY: repo,
    DEPENDABOT_PR: "123",
    DEPENDABOT_SHA: sha,
    DEPENDABOT_METADATA: JSON.stringify(data.dependencies),
  };
  let conclusion = "success";
  let writes = 0;
  const request = async (...args) => {
    if (args.includes("--method")) {
      writes++;
      throw new Error("Unexpected write");
    }
    const endpoint = args[1];
    if (endpoint === "graphql")
      return { data: { repository: { ref: { branchProtectionRule: data.protection } } } };
    if (endpoint.includes("/files?")) return data.files;
    if (endpoint.includes("/commits?")) return data.commits;
    if (endpoint.includes("/analyses?"))
      return ["/language:actions", "/language:javascript-typescript"].map((category) => ({
        category,
        commit_sha: sha,
        tool: { name: "CodeQL" },
        error: "",
        warning: "",
      }));
    if (endpoint.includes("/alerts?")) return [{ number: 1 }];
    if (endpoint.includes("/runs?"))
      return {
        workflow_runs: [
          {
            head_sha: sha,
            event: "pull_request",
            path: ".github/workflows/ci.yml",
            pull_requests: [{ number: 123 }],
            status: "completed",
            conclusion,
          },
        ],
      };
    return data.pr;
  };
  await assert.rejects(mergeDependabot({ env, request }), /unresolved code-scanning/);
  conclusion = "failure";
  await assert.rejects(mergeDependabot({ env, request }), /CI did not succeed/);
  assert.equal(writes, 0);
});
