import { githubRequest, safeDependencyPR } from "./merge-dependabot.mjs";

const repo = "pbuffolino/seeknay-links";
const root = `repos/${repo}`;
export const intentLabel = "dependency-refresh-intent";
const intentDescription =
  "Reserved for crash-recoverable signed dependency refreshes by GitHub Actions";
const shaPattern = /^[a-f0-9]{40}$/;
const isMachine = (actor) => actor?.login === "github-actions[bot]" && actor.type === "Bot";
const binderName = (number, base, attempt) => `r${number}-${base}-${attempt}`;
const binderDescription = (number, head, base, attempt) => `${number} ${head} ${base} ${attempt}`;

export async function listAll(endpoint, request = githubRequest) {
  const result = [];
  for (let page = 1; page <= 10; page++) {
    const values = await request(
      "api",
      `${root}/${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`
    );
    if (!Array.isArray(values)) throw new Error("Invalid native refresh evidence");
    result.push(...values);
    if (values.length < 100) return result;
  }
  throw new Error("Native refresh evidence exceeds the bounded pagination limit");
}

function decodeBinder(label, pr) {
  const match = /^(\d+) ([a-f0-9]{40}) ([a-f0-9]{40}) ([12])$/.exec(label.description || "");
  if (
    !match ||
    Number(match[1]) !== pr.number ||
    (pr.state === "closed" && match[2] !== pr.head?.sha)
  )
    return null;
  if (label.name !== binderName(pr.number, match[3], Number(match[4]))) return null;
  return { name: label.name, head: match[2], base: match[3], attempt: Number(match[4]) };
}

async function eventsFor(number, request) {
  const events = await listAll(`issues/${number}/events`, request);
  if (events.some((event) => !Number.isSafeInteger(event.id)))
    throw new Error("Invalid refresh event identity");
  return events.sort((a, b) => a.id - b.id);
}

export async function ownedIntent(pr, request = githubRequest) {
  if (
    pr.merged !== false ||
    !["open", "closed"].includes(pr.state) ||
    pr.user?.login !== "dependabot[bot]"
  )
    return null;
  const labels = pr.labels || [];
  const marked = labels.some((label) => label.name === intentLabel);
  if (
    marked &&
    labels.find((label) => label.name === intentLabel).description !== intentDescription
  )
    return null;
  if (pr.state === "closed" && !marked) return null;
  const binders = labels.map((label) => decodeBinder(label, pr)).filter(Boolean);
  if (binders.length !== 1) return null;
  const binder = binders[0];
  const events = await eventsFor(pr.number, request);
  function attachedByMachine(name) {
    const latest = events
      .filter(
        (event) => ["labeled", "unlabeled"].includes(event.event) && event.label?.name === name
      )
      .at(-1);
    return latest?.event === "labeled" && isMachine(latest.actor) ? latest : null;
  }
  const binding = attachedByMachine(binder.name);
  const marker = marked ? attachedByMachine(intentLabel) : null;
  if (!binding || (marked && !marker)) return null;
  if (pr.state === "closed") {
    const closure = events.filter((event) => ["closed", "reopened"].includes(event.event)).at(-1);
    // A later manual or Dependabot obsolete closure is never ours to reverse.
    if (
      closure?.event !== "closed" ||
      !isMachine(closure.actor) ||
      closure.id <= Math.max(binding.id, marker.id)
    )
      return null;
  }
  return binder;
}

export async function recoverablePRs(request = githubRequest) {
  const issues = await listAll(`issues?state=closed&labels=${intentLabel}`, request);
  const numbers = [];
  for (const issue of issues) {
    if (!issue.pull_request || !Number.isSafeInteger(issue.number)) continue;
    const pr = await request("api", `${root}/pulls/${issue.number}`);
    if (await ownedIntent(pr, request)) numbers.push(pr.number);
    else
      console.log(
        `REVIEW: Closed PR #${issue.number} has no authenticated refresh recovery intent`
      );
  }
  return numbers;
}

export async function refreshNative({
  env = process.env,
  request = githubRequest,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const number = Number(env.DEPENDABOT_PR);
  const sha = env.DEPENDABOT_SHA;
  if (
    env.GITHUB_REPOSITORY !== repo ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > 999999 ||
    !shaPattern.test(sha || "")
  )
    throw new Error("Invalid native refresh target");
  const dependencies = JSON.parse(env.DEPENDABOT_METADATA || "null");
  async function verified() {
    const pr = await request("api", `${root}/pulls/${number}`);
    const files = await request("api", `${root}/pulls/${number}/files?per_page=100`);
    const commits = await request("api", `${root}/pulls/${number}/commits?per_page=100`);
    if (
      !safeDependencyPR({ ...pr, state: "open" }, files, commits, repo, sha, dependencies) ||
      pr.merged !== false ||
      !["open", "closed"].includes(pr.state)
    )
      throw new Error("Native refresh failed signature, metadata, SHA, or scope guard");
    if (pr.state === "closed" && !(await ownedIntent(pr, request)))
      throw new Error("Closed dependency PR is not owned by this refresh");
    return pr;
  }
  async function restore(intent) {
    let pr = await verified();
    const proof = await ownedIntent(pr, request);
    if (!proof || proof.name !== intent.name)
      throw new Error("Native refresh ownership changed; review required");
    if (pr.state === "closed") {
      await request("api", "--method", "PATCH", `${root}/pulls/${number}`, "-f", "state=open");
      pr = await verified();
    }
    if (pr.state !== "open" || pr.head.sha !== sha)
      throw new Error("Cannot verify native refresh reopened state");
    // Remove only our two labels, never replace the label set or touch reviews/branches.
    for (const name of [intentLabel, intent.name]) {
      if (pr.labels.some((label) => label.name === name))
        await request(
          "api",
          "--method",
          "DELETE",
          `${root}/issues/${number}/labels/${encodeURIComponent(name)}`
        );
    }
    console.log(`Verified PR #${number} open after native refresh`);
  }
  const pr = await verified();
  const pending = await ownedIntent(pr, request);
  if (pr.state === "closed") {
    await restore(pending);
  } else {
    // Also finish cleanup after a crash following reopen or between label removals.
    if (pending) await restore(pending);
    const main = await request("api", `${root}/branches/main`);
    const base = main.commit?.sha;
    if (!shaPattern.test(base || "")) throw new Error("Invalid native refresh base");
    const comparison = await request("api", `${root}/compare/${base}...${sha}`);
    if (comparison.merge_base_commit?.sha === base) return sha;
    const events = await eventsFor(number, request);
    const attempts = [1, 2].filter((attempt) =>
      events.some(
        (event) =>
          event.event === "labeled" &&
          isMachine(event.actor) &&
          event.label?.name === binderName(number, base, attempt)
      )
    );
    if (attempts.length >= 2) throw new Error("Native refresh limit reached for this PR/base");
    for (const attempt of attempts) {
      const definition = await request(
        "api",
        `${root}/labels/${encodeURIComponent(binderName(number, base, attempt))}`
      );
      const previous = decodeBinder(definition, pr);
      if (!previous || previous.base !== base || previous.attempt !== attempt)
        throw new Error("Native refresh attempt evidence changed; review required");
      if (previous.head === sha)
        throw new Error("Native refresh is already pending for this PR/head/base");
    }
    const last = events
      .filter(
        (event) =>
          event.event === "labeled" &&
          isMachine(event.actor) &&
          attempts.some((attempt) => event.label?.name === binderName(number, base, attempt))
      )
      .at(-1);
    if (
      last &&
      (!Number.isFinite(Date.parse(last.created_at)) ||
        now() - Date.parse(last.created_at) < 10 * 60 * 1000)
    )
      throw new Error("Native refresh is already pending for this PR/base");
    if (env.DEPENDENCY_DEADLINE && Number(env.DEPENDENCY_DEADLINE) - now() < 90000)
      throw new Error("Insufficient maintenance budget to close and restore a PR");
    const attempt = attempts.includes(1) ? 2 : 1;
    const intent = { name: binderName(number, base, attempt), head: sha, base, attempt };
    const definitions = [
      [intentLabel, intentDescription],
      [intent.name, binderDescription(number, sha, base, attempt)],
    ];
    for (const [name, description] of definitions) {
      let existing;
      try {
        existing = await request("api", `${root}/labels/${encodeURIComponent(name)}`);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      if (existing && existing.description !== description)
        throw new Error("Reserved refresh label definition conflicts");
      if (!existing)
        await request(
          "api",
          "--method",
          "POST",
          `${root}/labels`,
          "-f",
          `name=${name}`,
          "-f",
          `description=${description}`,
          "-f",
          "color=6e7781"
        );
    }
    await verified();
    await request(
      "api",
      "--method",
      "POST",
      `${root}/issues/${number}/labels`,
      "-f",
      `labels[]=${intentLabel}`,
      "-f",
      `labels[]=${intent.name}`
    );
    try {
      const current = await verified();
      if (current.state !== "open" || !(await ownedIntent(current, request)))
        throw new Error("Refresh intent is not authenticated");
      await request("api", "--method", "PATCH", `${root}/pulls/${number}`, "-f", "state=closed");
    } finally {
      // SIGKILL can prevent finally; the durable label + bot closure evidence enables a later sweep.
      await restore(intent);
    }
  }
  const deadline = now() + 5 * 60 * 1000;
  while (now() < deadline) {
    await sleep(10000);
    const current = await request("api", `${root}/pulls/${number}`);
    if (current.state !== "open" || current.merged !== false)
      throw new Error("Dependency state changed during refresh");
    if (current.head?.sha !== sha && shaPattern.test(current.head?.sha || ""))
      return current.head.sha;
  }
  throw new Error(
    "Native Dependabot refresh is still pending; no additional request in this attempt"
  );
}
