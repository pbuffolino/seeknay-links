import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import {
  candidates,
  prepare,
  refresh,
  classify,
  smokeCandidate,
} from "../scripts/reconcile-dependabot.mjs";
import {
  assertCheckout,
  publicationReady,
  requestPublication,
  verifyPublication,
  verifyLive,
} from "../scripts/dependency-publication.mjs";
import { successfulScans, scanProblem, githubRequest } from "../scripts/merge-dependabot.mjs";

const repo = "pbuffolino/seeknay-links";
const sha = "a".repeat(40);
const base = "b".repeat(40);
const next = "c".repeat(40);
const categories = ["/language:actions", "/language:javascript-typescript"];
const scans = (revision = sha) =>
  categories.map((category) => ({
    category,
    tool: { name: "CodeQL" },
    commit_sha: revision,
    error: "",
    warning: "",
  }));
function fixture() {
  const pr = {
    number: 7,
    state: "open",
    draft: false,
    commits: 1,
    changed_files: 1,
    user: { login: "dependabot[bot]" },
    base: { ref: "main", repo: { full_name: repo } },
    head: { ref: "dependabot/npm_and_yarn/example-1.1.0", sha, repo: { full_name: repo } },
  };
  const files = [
    { filename: "package-lock.json", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" },
  ];
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
  const env = {
    GITHUB_REPOSITORY: repo,
    DEPENDABOT_PR: "7",
    DEPENDABOT_SHA: sha,
    DEPENDABOT_METADATA: JSON.stringify(dependencies),
    DEPENDABOT_REBASE_COMMENTS_APPROVED: "true",
  };
  const comments = [];
  const writes = [];
  let changed = false;
  let current = false;
  const request = async (...args) => {
    const endpoint = args.find((value) => value.startsWith?.("repos/"));
    if (args.includes("POST")) {
      writes.push(args);
      return {};
    }
    if (endpoint.endsWith("/branches/main")) return { commit: { sha: base } };
    if (endpoint.includes("/compare/"))
      return { merge_base_commit: { sha: current ? base : "d".repeat(40) } };
    if (endpoint.includes("/comments?")) return comments;
    if (endpoint.includes("/files?")) return files;
    if (endpoint.includes("/commits?")) return commits;
    if (endpoint.endsWith("/pulls/7"))
      return changed ? { ...pr, head: { ...pr.head, sha: next } } : pr;
    throw new Error("Unexpected fixture request");
  };
  return {
    pr,
    files,
    commits,
    dependencies,
    env,
    comments,
    writes,
    request,
    change: () => {
      changed = true;
    },
    current: () => {
      current = true;
    },
  };
}

test("bounded discovery filters foreign and draft PRs and rotates a larger backlog", () => {
  const pr = fixture().pr;
  const prs = Array.from({ length: 13 }, (_, i) => ({ ...pr, number: i + 1 }));
  assert.deepEqual(
    candidates(prs, 0).map((p) => p.number),
    [1, 2, 3, 4, 5, 6]
  );
  assert.deepEqual(
    candidates(prs, 3600000).map((p) => p.number),
    [7, 8, 9, 10, 11, 12]
  );
  assert.deepEqual(
    candidates(prs, 7200000).map((p) => p.number),
    [13]
  );
  assert.deepEqual(
    candidates([
      { ...pr, draft: true },
      { ...pr, user: { login: "human" } },
      { ...pr, head: { ...pr.head, repo: { full_name: "other/repo" } } },
    ]),
    []
  );
  assert.throws(() => candidates(Array(100).fill(pr)), /Incomplete/);
});

test("refresh fails closed without owner approval and cannot be enabled by truthy text", async () => {
  for (const approval of [undefined, "false", "TRUE", "yes"]) {
    const f = fixture();
    f.env.DEPENDABOT_REBASE_COMMENTS_APPROVED = approval;
    await assert.rejects(refresh({ ...f, now: () => 0 }), /owner approval/);
    assert.equal(f.writes.length, 0);
  }
});

test("up-to-date dependencies need no public comments or comment permission", async () => {
  const f = fixture();
  f.current();
  delete f.env.DEPENDABOT_REBASE_COMMENTS_APPROVED;
  assert.equal(await refresh(f), sha);
  assert.equal(f.writes.length, 0);
});

test("major, maintainer, signature, file and SHA violations stop refresh before any write", async () => {
  for (const mutate of [
    (f) => {
      f.dependencies[0].updateType = "version-update:semver-major";
    },
    (f) => {
      f.dependencies[0].maintainerChanges = true;
    },
    (f) => {
      f.commits[0].commit.verification.verified = false;
    },
    (f) => {
      f.files[0].filename = "index.html";
    },
    (f) => {
      f.pr.head.sha = next;
    },
  ]) {
    const f = fixture();
    mutate(f);
    f.env.DEPENDABOT_METADATA = JSON.stringify(f.dependencies);
    await assert.rejects(refresh(f), /guard/);
    assert.equal(f.writes.length, 0);
  }
});

test("one approved rebase request is bound to head/base and a new SHA needs fresh metadata", async () => {
  const f = fixture();
  assert.equal(await refresh({ ...f, now: () => 0, sleep: async () => f.change() }), next);
  assert.equal(f.writes.length, 1);
  assert(
    f.writes[0].includes(`body=@dependabot rebase\n\n<!-- dependency-reconcile:${sha}:${base} -->`)
  );
  await assert.rejects(refresh(f), /guard/);
});

test("an unchanged pending refresh is never reposted, even after an hour", async () => {
  const f = fixture();
  f.comments.push({
    user: { login: "github-actions[bot]" },
    body: `@dependabot rebase\n\n<!-- dependency-reconcile:${sha}:${base} -->`,
  });
  let time = 7200000;
  await assert.rejects(
    refresh({
      ...f,
      now: () => time,
      sleep: async () => {
        time += 300000;
      },
    }),
    /still pending/
  );
  assert.equal(f.writes.length, 0);
});

test("at most two refresh requests per PR/base and incomplete history prevents writes", async () => {
  const f = fixture();
  f.comments.push(
    ...[next, "d".repeat(40)].map((head) => ({
      user: { login: "github-actions[bot]" },
      body: `@dependabot rebase\n\n<!-- dependency-reconcile:${head}:${base} -->`,
    }))
  );
  await assert.rejects(refresh(f), /limit reached/);
  assert.equal(f.writes.length, 0);
  f.comments.push(...Array(98).fill({}));
  await assert.rejects(refresh(f), /Incomplete/);
});

test("head or PR identity changing during inspection never becomes a writable target", async () => {
  const f = fixture();
  f.pr.head.repo.full_name = "attacker/repo";
  await assert.rejects(prepare(f), /no longer eligible/);
  assert.equal(f.writes.length, 0);
});

test("Node preload supplies isolated metadata context before entry, leaving event.json intact", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "metadata-context-"));
  try {
    const pr = fixture().pr;
    const original = path.join(dir, "event.json");
    const candidate = path.join(dir, "dependabot-event.json");
    await fs.writeFile(original, '{"schedule":"unchanged"}');
    await fs.writeFile(candidate, JSON.stringify({ pull_request: pr }));
    const args = [
      "--import",
      path.resolve("scripts/dependabot-metadata-context.mjs"),
      "--input-type=module",
      "-e",
      'import fs from "node:fs"; process.stdout.write(JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH)).pull_request.head.sha)',
    ];
    assert.equal(
      execFileSync(process.execPath, args, {
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repo,
          RUNNER_TEMP: dir,
          GITHUB_EVENT_PATH: original,
        },
        encoding: "utf8",
      }),
      sha
    );
    assert.equal(await fs.readFile(original, "utf8"), '{"schedule":"unchanged"}');
    pr.head.repo.full_name = "other/repo";
    await fs.writeFile(candidate, JSON.stringify({ pull_request: pr }));
    assert.throws(() =>
      execFileSync(process.execPath, args, {
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repo,
          RUNNER_TEMP: dir,
          GITHUB_EVENT_PATH: original,
        },
        stdio: "ignore",
      })
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("latest expected CodeQL categories win over older failed attempts on the same SHA", () => {
  const analyses = [
    ...scans(),
    { ...scans()[0], error: "old failure" },
    { ...scans()[1], warning: "old warning" },
  ];
  assert.equal(successfulScans(analyses, sha), true);
  assert.equal(scanProblem(analyses, sha), false);
  assert.equal(
    scanProblem([{ ...scans()[0], warning: "current warning" }, ...analyses], sha),
    true
  );
});

test("late old-head CodeQL uploads cannot hide exact-head analyses", () => {
  const analyses = [
    ...scans(base).map((analysis) => ({ ...analysis, error: "old head failure" })),
    ...scans(),
  ];
  assert.equal(successfulScans(analyses, sha), true);
  assert.equal(scanProblem(analyses, sha), false);
});

test("another head or tool cannot supply a missing exact-head CodeQL language", () => {
  const analyses = [...scans(base), scans()[0], { ...scans()[1], tool: { name: "Other" } }];
  assert.equal(successfulScans(analyses, sha), false);
  assert.equal(scanProblem(analyses, sha), false);
});

test("latest same-head CodeQL errors and warnings block older successes", () => {
  for (const category of categories) {
    for (const failure of [{ error: "current failure" }, { warning: "current warning" }]) {
      const analyses = [
        ...scans(base),
        { ...scans().find((analysis) => analysis.category === category), ...failure },
        ...scans(),
      ];
      assert.equal(successfulScans(analyses, sha), false);
      assert.equal(scanProblem(analyses, sha), true);
    }
  }
});

function publicationFixture() {
  const writes = [];
  let runs = true,
    built = true,
    deployed = true,
    revision = sha,
    analyses = scans(),
    alerts = [];
  const request = async (...args) => {
    const endpoint = args.find((value) => value.startsWith?.("repos/"));
    if (args.includes("POST")) {
      writes.push(endpoint);
      return {};
    }
    if (endpoint.endsWith("/branches/main")) return { commit: { sha: revision } };
    if (endpoint.includes("/runs?")) {
      const workflow = endpoint.includes("/ci.yml/") ? "ci.yml" : "codeql.yml";
      return {
        workflow_runs: runs
          ? [
              {
                head_sha: sha,
                head_branch: "main",
                path: `.github/workflows/${workflow}`,
                event: "workflow_dispatch",
                status: "completed",
                conclusion: "success",
              },
            ]
          : [],
      };
    }
    if (endpoint.includes("/analyses?")) return analyses;
    if (endpoint.includes("/alerts?")) return alerts;
    if (endpoint.includes("/pages/builds?")) return built ? [{ commit: sha, status: "built" }] : [];
    if (endpoint.includes("/deployments?")) return [{ id: 12, sha, environment: "github-pages" }];
    if (endpoint.includes("/statuses?")) return [{ state: deployed ? "success" : "in_progress" }];
    throw new Error("Unexpected publication request");
  };
  return {
    request,
    writes,
    noRuns: () => {
      runs = false;
    },
    noBuild: () => {
      built = false;
    },
    pending: () => {
      deployed = false;
    },
    advance: () => {
      revision = next;
    },
    scans: (v) => {
      analyses = v;
    },
    alerts: () => {
      alerts = [{}];
    },
  };
}

test("publication recovery dispatches only missing checks/build and works with no open PRs", async () => {
  const f = publicationFixture();
  assert.equal(await requestPublication(f), sha);
  assert.equal(f.writes.length, 0);
  f.noRuns();
  f.noBuild();
  assert.equal(await requestPublication(f), sha);
  assert.equal(f.writes.length, 3);
});

test("a successful Pages build alone cannot verify deployment or stale/missing scans", async () => {
  const f = publicationFixture();
  assert.equal(await publicationReady(sha, f.request), true);
  f.pending();
  assert.equal(await publicationReady(sha, f.request), false);
  f.scans(scans(next));
  assert.equal(await publicationReady(sha, f.request), false);
});

test("main advancement, current scan warnings, and alerts block publication receipt", async () => {
  const f = publicationFixture();
  f.advance();
  await assert.rejects(publicationReady(sha, f.request), /advanced/);
  const g = publicationFixture();
  g.scans([{ ...scans()[0], warning: "partial coverage" }, ...scans()]);
  await assert.rejects(publicationReady(sha, g.request), /warnings/);
  const h = publicationFixture();
  h.alerts();
  await assert.rejects(publicationReady(sha, h.request), /alerts/);
});

test("publication retries transient CDN mismatch but has a bounded deadline", async () => {
  const f = publicationFixture();
  let time = 0,
    attempts = 0;
  await verifyPublication({
    ...f,
    sha,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    live: async () => {
      if (++attempts === 1) throw new Error("cache");
    },
  });
  assert.equal(attempts, 2);
  await assert.rejects(
    verifyPublication({
      ...f,
      sha,
      now: () => time,
      sleep: async () => {
        time += 600000;
      },
      live: async () => {
        throw new Error("mismatch");
      },
    }),
    /ten minutes/
  );
});

test("live delivery compares HTML and every fixed public resource, rejecting mismatches", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return new Response("<p>same</p>");
  };
  const readFile = async (_file, encoding) =>
    encoding ? "<p>same</p>" : Buffer.from("<p>same</p>");
  await verifyLive({ fetchImpl, readFile });
  assert.equal(urls.length, 16);
  assert(urls.every((url) => url.startsWith("https://links.seeknay.com/")));
  await assert.rejects(verifyLive({ fetchImpl, readFile: async () => "different" }), /HTML/);
  await assert.rejects(
    verifyLive({ fetchImpl: async () => new Response("failure", { status: 503 }), readFile }),
    /unavailable/
  );
});

test("exhausted maintenance budget prevents even starting a GitHub request", async () => {
  const original = process.env.DEPENDENCY_DEADLINE;
  try {
    process.env.DEPENDENCY_DEADLINE = "1";
    await assert.rejects(githubRequest("api", "never-sent"), /budget exhausted/);
  } finally {
    if (original === undefined) delete process.env.DEPENDENCY_DEADLINE;
    else process.env.DEPENDENCY_DEADLINE = original;
  }
});

test("verified majors are classified for review; unknown metadata and invalid scopes fail", async () => {
  const f = fixture();
  assert.equal(await classify(f), true);
  f.dependencies[0].updateType = "version-update:semver-major";
  f.env.DEPENDABOT_METADATA = JSON.stringify(f.dependencies);
  assert.equal(await classify(f), false);
  f.dependencies[0].updateType = "unknown";
  f.env.DEPENDABOT_METADATA = JSON.stringify(f.dependencies);
  await assert.rejects(classify(f), /guard/);
  f.dependencies[0].updateType = "version-update:semver-major";
  f.env.DEPENDABOT_METADATA = JSON.stringify(f.dependencies);
  f.files[0].filename = "js/ui.js";
  await assert.rejects(classify(f), /guard/);
  assert.equal(f.writes.length, 0);
});

test("verified action majors are reviewed without accepting action identity or code changes", async () => {
  const f = fixture();
  f.dependencies[0].packageEcosystem = "github_actions";
  f.dependencies[0].updateType = "version-update:semver-major";
  f.env.DEPENDABOT_METADATA = JSON.stringify(f.dependencies);
  f.files[0] = {
    filename: ".github/workflows/ci.yml",
    status: "modified",
    patch: `@@ -1 +1 @@\n-  - uses: actions/checkout@${sha} # v7.0.1\n+  - uses: actions/checkout@${next} # v8.0.0`,
  };
  assert.equal(await classify(f), false);
  await assert.rejects(refresh(f), /guard/);
  f.files[0].patch = f.files[0].patch.replace(
    "+  - uses: actions/checkout",
    "+  - uses: attacker/checkout"
  );
  await assert.rejects(classify(f), /guard/);
  assert.equal(f.writes.length, 0);
});

test("privileged workflow accepts only trusted main schedules/dispatches or authentic bot events", async () => {
  const source = await fs.readFile(".github/workflows/dependabot-automerge.yml", "utf8");
  const expression = source.match(/ {2}recover-publication:\n {4}if: ([^\n]+)/)[1];
  const group = source.match(/ {2}group: \$\{\{ (.*?) \}\}/)[1];
  const github = {
    repository: repo,
    ref: "refs/heads/main",
    event_name: "pull_request_target",
    run_id: "123",
    event: { pull_request: fixture().pr },
  };
  const evaluate = () => vm.runInNewContext(expression, { github });
  const concurrency = () =>
    vm.runInNewContext(group, {
      github,
      format: (_pattern, value) => `dependency-untrusted-${value}`,
    });
  assert.equal(evaluate(), true);
  assert.equal(concurrency(), "dependency-reconciliation");
  github.event.pull_request.user.login = "human";
  assert.equal(evaluate(), false);
  assert.equal(concurrency(), "dependency-untrusted-123");
  github.event.pull_request = fixture().pr;
  github.event.pull_request.head.repo.full_name = "fork/repo";
  assert.equal(evaluate(), false);
  assert.equal(concurrency(), "dependency-untrusted-123");
  github.event.pull_request = fixture().pr;
  github.event.pull_request.draft = true;
  assert.equal(evaluate(), false);
  assert.equal(concurrency(), "dependency-untrusted-123");
  for (const event of ["schedule", "workflow_dispatch"]) {
    github.event_name = event;
    github.event = {};
    assert.equal(evaluate(), true);
    github.ref = "refs/heads/untrusted";
    assert.equal(evaluate(), false);
    github.ref = "refs/heads/main";
  }
});

test("Dependabot CI smoke uses its own event PR and SHA, never another queue item", async () => {
  const f = fixture();
  const requested = [];
  const request = async (...args) => {
    requested.push(args[1]);
    return f.request(...args);
  };
  assert.equal((await smokeCandidate({ event: { pull_request: f.pr }, request })).head.sha, sha);
  assert(requested.every((endpoint) => endpoint.endsWith("/pulls/7")));
  const event = structuredClone({ pull_request: f.pr });
  f.pr.head.sha = next;
  assert.equal(await smokeCandidate({ event, request }), null);
});

test("infrastructure smoke bounds candidate retries when queue items naturally close", async () => {
  const f = fixture();
  const prs = [f.pr, { ...f.pr, number: 8 }];
  let gets = 0;
  const request = async (_api, endpoint) => {
    if (endpoint.includes("/pulls?")) return prs;
    gets++;
    return { ...f.pr, state: "closed" };
  };
  assert.equal(
    await smokeCandidate({ event: { pull_request: { user: { login: "maintainer" } } }, request }),
    null
  );
  assert.equal(gets, 2);
});

test("verification uses only a trusted checkout at the expected exact revision", () => {
  assert.doesNotThrow(() => assertCheckout(sha, () => sha));
  assert.throws(() => assertCheckout(sha, () => next), /Trusted main checkout/);
  assert.throws(() => assertCheckout("main", () => sha), /Trusted main checkout/);
});
