import { test } from "node:test";
import assert from "node:assert/strict";
import { closeObsolete, satisfiedJSON } from "../scripts/obsolete-dependabot.mjs";

const repo = "pbuffolino/seeknay-links";
const head = "a".repeat(40),
  parent = "b".repeat(40),
  base = "c".repeat(40);
function fixture() {
  const files = [{ filename: "package-lock.json", status: "modified" }];
  const commit = {
    sha: head,
    author: { login: "dependabot[bot]" },
    commit: { verification: { verified: true } },
    parents: [{ sha: parent }],
    files,
  };
  const pr = {
    number: 7,
    state: "open",
    merged: false,
    draft: false,
    commits: 1,
    changed_files: 1,
    user: { login: "dependabot[bot]" },
    head: { sha: head, ref: "dependabot/npm_and_yarn/example-1.1.0", repo: { full_name: repo } },
    base: { ref: "main", repo: { full_name: repo } },
  };
  const before = {
    lockfileVersion: 3,
    packages: {
      "node_modules/example": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
        integrity: "old",
        dev: true,
      },
      "node_modules/other": { version: "1.0.0" },
    },
  };
  const proposed = structuredClone(before);
  proposed.packages["node_modules/example"] = {
    version: "1.1.0",
    resolved: "https://registry.npmjs.org/example/-/example-1.1.0.tgz",
    integrity: "new",
    dev: true,
  };
  const main = structuredClone(proposed);
  main.packages["node_modules/other"].version = "2.0.0";
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
  const data = {
    [parent]: { "package-lock.json": before },
    [head]: { "package-lock.json": proposed },
    [base]: { "package-lock.json": main },
  };
  const writes = [],
    flags = {},
    counts = { main: 0, pr: 0, ready: 0 };
  const request = async (...args) => {
    const endpoint = args.find((arg) => arg.startsWith?.("repos/"));
    if (args.includes("--method")) {
      writes.push(args);
      assert.equal(args[args.indexOf("--method") + 1], "PATCH");
      assert(args.includes("state=closed"));
      pr.state = flags.badClosure ? "open" : "closed";
      if (flags.changeAfterClose) pr.head.sha = "e".repeat(40);
      return structuredClone(pr);
    }
    if (endpoint.endsWith("/branches/main")) {
      counts.main++;
      return { commit: { sha: flags.mainRace && counts.main > 1 ? "d".repeat(40) : base } };
    }
    if (endpoint.endsWith("/pulls/7")) {
      counts.pr++;
      if (flags.headRace && counts.pr >= 3) pr.head.sha = "e".repeat(40);
      return structuredClone(pr);
    }
    if (endpoint.includes("/files?")) return structuredClone(files);
    if (endpoint.includes("/pulls/7/commits?")) return [structuredClone(commit)];
    if (endpoint.includes(`/commits/${head}?`)) return structuredClone(commit);
    const match = /\/contents\/(package(?:-lock)?\.json)\?ref=([a-f0-9]{40})$/.exec(endpoint);
    if (match) {
      if (flags.mainRace && !data[match[2]]) data[match[2]] = data[base];
      const text = flags.invalidJSON
        ? "invalid private payload"
        : JSON.stringify(data[match[2]][match[1]]);
      return {
        type: "file",
        encoding: "base64",
        size: flags.truncate ? text.length + 1 : Buffer.byteLength(text),
        content: Buffer.from(text).toString("base64"),
      };
    }
    throw new Error("Unexpected obsolete fixture request");
  };
  return {
    env,
    request,
    ready: async (sha) => {
      assert.equal(sha, base);
      counts.ready++;
      return !flags.failedMain;
    },
    files,
    commit,
    pr,
    data,
    before,
    proposed,
    main,
    writes,
    flags,
    counts,
  };
}

test("obsolete closure requires every complete proposed package entry and preserves unrelated main changes", async () => {
  const f = fixture();
  assert.equal(await closeObsolete(f), true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.pr.state, "closed");
  assert.equal(f.pr.merged, false);
  assert.equal(f.counts.ready, 2);
});

test("matching a version alone, extra entry fields, deleted fields and partial satisfaction never close", async () => {
  for (const mutate of [
    (f) => {
      f.main.packages["node_modules/example"].integrity = "wrong";
    },
    (f) => {
      f.main.packages["node_modules/example"].resolved = "https://other.invalid";
    },
    (f) => {
      f.main.packages["node_modules/example"].unexpected = true;
    },
    (f) => {
      delete f.main.packages["node_modules/example"].dev;
    },
    (f) => {
      f.proposed.lockfileVersion = 4;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(await closeObsolete(f), false);
    assert.equal(f.writes.length, 0);
  }
});

test("all requested files must be satisfied, including package.json changes", async () => {
  const f = fixture();
  f.files.push({ filename: "package.json", status: "modified" });
  f.pr.changed_files = 2;
  f.data[parent]["package.json"] = { devDependencies: { example: "1.0.0", other: "1.0.0" } };
  f.data[head]["package.json"] = { devDependencies: { example: "1.1.0", other: "1.0.0" } };
  f.data[base]["package.json"] = { devDependencies: { example: "1.0.0", other: "2.0.0" } };
  assert.equal(await closeObsolete(f), false);
  assert.equal(f.writes.length, 0);
  f.data[base]["package.json"].devDependencies.example = "1.1.0";
  assert.equal(await closeObsolete(f), true);
});

test("JSON comparison covers additions, deletions, arrays and whole top-level changes", () => {
  const a = { packages: { old: { version: "1" } }, flags: [1], other: true };
  const b = { packages: { added: { version: "2", integrity: "exact" } }, flags: [2] };
  assert.equal(satisfiedJSON("package-lock.json", a, b, b).satisfied, true);
  for (const current of [
    a,
    { ...b, flags: [2, 3] },
    { ...b, other: false },
    { ...b, packages: { added: { version: "2" } } },
  ])
    assert.equal(satisfiedJSON("package-lock.json", a, b, current).satisfied, false);
  assert.equal(satisfiedJSON("package-lock.json", a, a, b).changes, 0);
});

test("unknown metadata, majors, unsigned/human commits and maintainer work fail closed", async () => {
  for (const mutate of [
    (f) => {
      f.commit.commit.verification.verified = false;
    },
    (f) => {
      f.commit.author.login = "human";
    },
    (f) => {
      f.pr.user.login = "human";
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
      f.files.push({ filename: "index.html", status: "modified" });
      f.pr.changed_files++;
    },
    (f) => {
      f.commit.parents = [{ sha: parent }, { sha: base }];
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(closeObsolete(f), /guard|diff/);
    assert.equal(f.writes.length, 0);
  }
});

test("non-npm and closed refresh recovery targets are not treated as obsolete", async () => {
  const f = fixture();
  f.pr.state = "closed";
  assert.equal(await closeObsolete(f), false);
  assert.equal(f.writes.length, 0);
  const g = fixture();
  g.env.DEPENDABOT_METADATA = g.env.DEPENDABOT_METADATA.replace("npm_and_yarn", "github_actions");
  g.files[0].filename = ".github/workflows/ci.yml";
  g.files[0].patch = `@@ -1 +1 @@\n-uses: actions/checkout@${"d".repeat(40)} # v7.0.0\n+uses: actions/checkout@${"e".repeat(40)} # v7.1.0`;
  assert.equal(await closeObsolete(g), false);
  assert.equal(g.writes.length, 0);
});

test("main checks becoming unhealthy during recheck stop closure", async () => {
  const f = fixture();
  let calls = 0;
  f.ready = async () => ++calls === 1;
  await assert.rejects(closeObsolete(f), /Main checks changed/);
  assert.equal(f.writes.length, 0);
});

test("the original complete signed diff must match the PR file scope", async () => {
  const f = fixture();
  f.commit.files = [...f.files, { filename: "package.json", status: "modified" }];
  await assert.rejects(closeObsolete(f), /diff is incomplete/);
  assert.equal(f.writes.length, 0);
});

test("failed main checks, moving main/head and incomplete JSON stop closure", async () => {
  for (const flag of ["failedMain", "mainRace", "headRace", "truncate", "invalidJSON"]) {
    const f = fixture();
    f.flags[flag] = true;
    await assert.rejects(closeObsolete(f), /Main checks|changed|Truncated|Invalid dependency JSON/);
    assert.equal(f.writes.length, 0);
  }
});

test("a state/head race after closure fails its receipt without issuing more mutations", async () => {
  for (const flag of ["badClosure", "changeAfterClose"]) {
    const f = fixture();
    f.flags[flag] = true;
    await assert.rejects(closeObsolete(f), /did not verify/);
    assert.equal(f.writes.length, 1);
  }
});

test("format-only or empty JSON deltas never close a PR", async () => {
  const f = fixture();
  f.data[head]["package-lock.json"] = structuredClone(f.before);
  assert.equal(await closeObsolete(f), false);
  assert.equal(f.writes.length, 0);
});

test("obsolete closure never inherits a pending or partly cleared native recovery intent", async () => {
  for (const name of ["dependency-refresh-intent", `r7-${base}-1`, `r7-${parent}-2`]) {
    const f = fixture();
    f.pr.labels = [{ name }];
    assert.equal(await closeObsolete(f), false);
    assert.equal(f.writes.length, 0);
  }
});

test("an intent marker appearing during the last recheck prevents obsolete closure", async () => {
  const f = fixture();
  const original = f.request;
  f.request = async (...args) => {
    if (f.counts.pr >= 2 && args.includes(`repos/${repo}/pulls/7`))
      f.pr.labels = [{ name: "dependency-refresh-intent" }];
    return original(...args);
  };
  await assert.rejects(closeObsolete(f), /changed before/);
  assert.equal(f.writes.length, 0);
});
