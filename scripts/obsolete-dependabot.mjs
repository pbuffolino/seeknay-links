import { isDeepStrictEqual as equal } from "node:util";
import { githubRequest, safeDependencyPR } from "./merge-dependabot.mjs";
import { publicationReady } from "./dependency-publication.mjs";

const repo = "pbuffolino/seeknay-links";
const root = `repos/${repo}`;
const shaPattern = /^[a-f0-9]{40}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => record(value) && Object.hasOwn(value, key);
const hasRefreshIntent = (pr) =>
  (pr.labels || []).some(
    (label) =>
      label.name === "dependency-refresh-intent" ||
      new RegExp(`^r${pr.number}-[a-f0-9]{40}-[12]$`).test(label.name)
  );

// Compare complete changed entries, including resolved URLs/integrity and all other
// package metadata. Arrays and other top-level values are atomic; never compare just versions.
export function satisfiedJSON(filename, before, proposed, current) {
  if (![before, proposed, current].every(record)) return { satisfied: false, changes: 0 };
  const maps =
    filename === "package-lock.json"
      ? new Set(["packages", "dependencies"])
      : new Set(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]);
  let changes = 0;
  function entries(a, b, c, split = false) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (own(a, key) === own(b, key) && equal(a[key], b[key])) continue;
      if (split && maps.has(key) && [a[key], b[key], c?.[key]].every(record)) {
        if (!entries(a[key], b[key], c[key])) return false;
      } else {
        changes++;
        if (own(b, key) !== own(c, key) || (own(b, key) && !equal(b[key], c[key]))) return false;
      }
    }
    return true;
  }
  return { satisfied: entries(before, proposed, current, true), changes };
}

async function jsonAt(filename, sha, request) {
  const file = await request("api", `${root}/contents/${filename}?ref=${sha}`);
  if (
    file.type !== "file" ||
    file.encoding !== "base64" ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > 1024 * 1024 ||
    typeof file.content !== "string"
  )
    throw new Error("Incomplete dependency JSON content");
  const bytes = Buffer.from(file.content, "base64");
  if (bytes.length !== file.size) throw new Error("Truncated dependency JSON content");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid dependency JSON content");
  }
}

export async function closeObsolete({
  env = process.env,
  request = githubRequest,
  ready = publicationReady,
} = {}) {
  const number = Number(env.DEPENDABOT_PR);
  const sha = env.DEPENDABOT_SHA;
  if (
    env.GITHUB_REPOSITORY !== repo ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !shaPattern.test(sha || "")
  )
    throw new Error("Invalid obsolete dependency target");
  const dependencies = JSON.parse(env.DEPENDABOT_METADATA || "null");
  async function inspect() {
    const pr = await request("api", `${root}/pulls/${number}`);
    // Interrupted native refreshes must use their authenticated recovery path instead.
    if (pr.state === "closed" || hasRefreshIntent(pr)) return null;
    const files = await request("api", `${root}/pulls/${number}/files?per_page=100`);
    const commits = await request("api", `${root}/pulls/${number}/commits?per_page=100`);
    if (!safeDependencyPR(pr, files, commits, repo, sha, dependencies) || pr.merged !== false)
      throw new Error("Obsolete dependency signature, metadata, SHA, or scope guard failed");
    if (!dependencies.every((dependency) => dependency.packageEcosystem === "npm_and_yarn"))
      return null;
    const commit = await request("api", `${root}/commits/${sha}?per_page=100`);
    if (
      !safeDependencyPR(pr, commit.files, [commit], repo, sha, dependencies) ||
      !Array.isArray(commit.parents) ||
      commit.parents.length !== 1 ||
      !shaPattern.test(commit.parents[0]?.sha || "") ||
      commit.files.some((file) => !files.some((entry) => entry.filename === file.filename))
    )
      throw new Error("Original signed dependency commit diff is incomplete or unexpected");
    const main = await request("api", `${root}/branches/main`);
    const base = main.commit?.sha;
    if (!shaPattern.test(base || "")) throw new Error("Invalid obsolete dependency base");
    let changes = 0;
    for (const file of commit.files) {
      const before = await jsonAt(file.filename, commit.parents[0].sha, request);
      const proposed = await jsonAt(file.filename, sha, request);
      const current = await jsonAt(file.filename, base, request);
      const result = satisfiedJSON(file.filename, before, proposed, current);
      if (!result.satisfied) return null;
      changes += result.changes;
    }
    return changes ? { base, files: commit.files, commit } : null;
  }
  const original = await inspect();
  if (!original) return false;
  if (!(await ready(original.base, request)))
    throw new Error("Main checks and publication must pass before closing an obsolete update");
  // Repeat complete immutable parent/head/main comparisons and all eligibility guards,
  // then check live head/base immediately before the sole mutation.
  const rechecked = await inspect();
  if (rechecked?.base !== original.base)
    throw new Error("Dependency or main changed during obsolete inspection");
  if (!(await ready(original.base, request)))
    throw new Error("Main checks changed before obsolete closure");
  const current = await request("api", `${root}/pulls/${number}`);
  const main = await request("api", `${root}/branches/main`);
  if (
    !safeDependencyPR(current, rechecked.files, [rechecked.commit], repo, sha, dependencies) ||
    hasRefreshIntent(current) ||
    current.merged !== false ||
    current.head?.sha !== sha ||
    main.commit?.sha !== original.base
  )
    throw new Error("Dependency or main changed before obsolete closure");
  await request("api", "--method", "PATCH", `${root}/pulls/${number}`, "-f", "state=closed");
  const closed = await request("api", `${root}/pulls/${number}`);
  const finalMain = await request("api", `${root}/branches/main`);
  if (
    closed.state !== "closed" ||
    closed.merged !== false ||
    closed.head?.sha !== sha ||
    finalMain.commit?.sha !== original.base
  )
    throw new Error("Obsolete closure state/head/base did not verify; review required");
  console.log(
    `ALREADY APPLIED: Verified obsolete signed dependency PR #${number} closed, not merged`
  );
  return true;
}
