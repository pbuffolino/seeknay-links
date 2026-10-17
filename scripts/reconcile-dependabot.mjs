import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { githubRequest, safeDependencyPR, safeDependencyScope } from "./merge-dependabot.mjs";

const repository = "pbuffolino/seeknay-links";
const shaPattern = /^[a-f0-9]{40}$/;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function target(env) {
  if (env.GITHUB_REPOSITORY !== repository || !/^\d+$/.test(env.DEPENDABOT_PR || ""))
    throw new Error("Invalid reconciliation target");
  return `repos/${repository}`;
}

export function candidates(prs, now = Date.now()) {
  if (!Array.isArray(prs) || prs.length >= 100) throw new Error("Incomplete dependency PR list");
  const numbers = prs
    .filter(
      (pr) =>
        pr.user?.login === "dependabot[bot]" &&
        pr.base?.ref === "main" &&
        pr.head?.repo?.full_name === repository &&
        !pr.draft &&
        Number.isSafeInteger(pr.number) &&
        pr.number > 0
    )
    .map((pr) => pr.number)
    .sort((a, b) => a - b);
  // Rotate batches hourly so an ineligible old PR cannot starve a larger backlog.
  const start = (Math.floor(now / 3600000) % Math.max(1, Math.ceil(numbers.length / 6))) * 6;
  return numbers.slice(start, start + 6).map((number) => ({ number }));
}

export async function prepare({ env = process.env, request = githubRequest } = {}) {
  const root = target(env);
  const pr = await request("api", `${root}/pulls/${env.DEPENDABOT_PR}`);
  return snapshot(pr);
}

function snapshot(pr) {
  if (
    pr.state !== "open" ||
    pr.draft ||
    pr.user?.login !== "dependabot[bot]" ||
    pr.base?.ref !== "main" ||
    pr.base?.repo?.full_name !== repository ||
    pr.head?.repo?.full_name !== repository ||
    !shaPattern.test(pr.head?.sha || "")
  )
    throw new Error("Dependency candidate is no longer eligible for inspection");
  return pr;
}

export async function smokeCandidate({ event, request = githubRequest } = {}) {
  const own = event.pull_request;
  if (own?.user?.login === "dependabot[bot]") {
    if (!Number.isSafeInteger(own.number) || !shaPattern.test(own.head?.sha || ""))
      throw new Error("Invalid metadata smoke target");
    const pr = await request("api", `repos/${repository}/pulls/${own.number}`);
    if (pr.state !== "open" || pr.head?.sha !== own.head.sha) return null;
    return snapshot(pr);
  }
  const prs = await request("api", `repos/${repository}/pulls?state=open&base=main&per_page=100`);
  for (const { number } of candidates(prs).slice(0, 2)) {
    const pr = await request("api", `repos/${repository}/pulls/${number}`);
    if (
      pr.state !== "open" ||
      pr.head?.sha !== prs.find((item) => item.number === number)?.head?.sha
    )
      continue;
    return snapshot(pr);
  }
  return null;
}

export async function classify({ env = process.env, request = githubRequest } = {}) {
  const root = target(env);
  const pr = await request("api", `${root}/pulls/${env.DEPENDABOT_PR}`);
  const files = await request("api", `${root}/pulls/${env.DEPENDABOT_PR}/files?per_page=100`);
  const commits = await request("api", `${root}/pulls/${env.DEPENDABOT_PR}/commits?per_page=100`);
  const dependencies = JSON.parse(env.DEPENDABOT_METADATA || "null");
  if (!safeDependencyScope(pr, files, commits, repository, env.DEPENDABOT_SHA, dependencies))
    throw new Error(
      "Dependency classification failed identity, signature, metadata, or scope guard"
    );
  return safeDependencyPR(pr, files, commits, repository, env.DEPENDABOT_SHA, dependencies);
}

export async function refresh({
  env = process.env,
  request = githubRequest,
  now = Date.now,
  sleep = delay,
} = {}) {
  const root = target(env);
  const number = env.DEPENDABOT_PR;
  const sha = env.DEPENDABOT_SHA;
  const dependencies = JSON.parse(env.DEPENDABOT_METADATA || "null");
  async function verified() {
    const pr = await request("api", `${root}/pulls/${number}`);
    const files = await request("api", `${root}/pulls/${number}/files?per_page=100`);
    const commits = await request("api", `${root}/pulls/${number}/commits?per_page=100`);
    if (!safeDependencyPR(pr, files, commits, repository, sha, dependencies))
      throw new Error("Dependency refresh failed identity, signature, metadata, or scope guard");
    return pr;
  }
  await verified();
  const base = await request("api", `${root}/branches/main`);
  if (!shaPattern.test(base.commit?.sha || "")) throw new Error("Invalid base revision");
  const comparison = await request("api", `${root}/compare/${base.commit.sha}...${sha}`);
  if (comparison.merge_base_commit?.sha === base.commit.sha) return sha;
  // This repository variable is deliberately unset until the owner approves public bot commands.
  // Neither a dispatch input nor PR text can grant permission.
  if (env.DEPENDABOT_REBASE_COMMENTS_APPROVED !== "true")
    throw new Error(
      "Dependency refresh blocked: public Dependabot rebase comments need owner approval"
    );
  const body = `@dependabot rebase\n\n<!-- dependency-reconcile:${sha}:${base.commit.sha} -->`;
  const comments = await request("api", `${root}/issues/${number}/comments?per_page=100`);
  if (!Array.isArray(comments) || comments.length >= 100)
    throw new Error("Incomplete refresh comment history");
  const requests = comments.filter(
    (comment) =>
      comment.user?.login === "github-actions[bot]" &&
      /^@dependabot rebase\n\n<!-- dependency-reconcile:[a-f0-9]{40}:[a-f0-9]{40} -->$/.test(
        comment.body || ""
      )
  );
  if (!requests.some((comment) => comment.body === body)) {
    if (requests.filter((comment) => comment.body.endsWith(`:${base.commit.sha} -->`)).length >= 2)
      throw new Error("Dependabot refresh limit reached for this PR/base revision");
    await verified();
    await request(
      "api",
      "--method",
      "POST",
      `${root}/issues/${number}/comments`,
      "-f",
      `body=${body}`
    );
  }
  const deadline = now() + 5 * 60 * 1000;
  while (now() < deadline) {
    await sleep(10000);
    const current = await prepare({ env, request });
    if (current.head.sha !== sha) {
      // A changed head is only a signal to collect NEW verified metadata in a read-only job.
      // It is never authorization to merge with the old metadata or signature.
      return current.head.sha;
    }
  }
  throw new Error("Dependabot refresh is still pending; the next reconciliation will retry");
}

async function output(name, value) {
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== repository) throw new Error("Invalid repository");
  const mode = process.argv[2];
  if (mode === "discover") {
    const prs = await githubRequest(
      "api",
      `repos/${repository}/pulls?state=open&base=main&per_page=100`
    );
    const batch = candidates(prs);
    await output("matrix", JSON.stringify({ include: batch }));
    await output("count", batch.length);
    if (batch.length) await output("number", batch[0].number);
    console.log(`Selected ${batch.length} dependency PRs for bounded serial reconciliation`);
  } else if (mode === "prepare" || mode === "smoke") {
    const pr =
      mode === "prepare"
        ? await prepare()
        : await smokeCandidate({
            event: JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8")),
          });
    if (!pr) {
      await output("count", 0);
      console.log("SKIP: No stable metadata smoke candidate; no writes requested");
      return;
    }
    // Fixed runner-owned path, never a PR-provided path. Only the metadata action reads this adapter.
    await fs.writeFile(
      path.join(process.env.RUNNER_TEMP, "dependabot-event.json"),
      JSON.stringify({ pull_request: pr })
    );
    await output("sha", pr.head.sha);
    await output("number", pr.number);
    await output("count", 1);
  } else if (mode === "refresh") {
    await refresh();
  } else if (mode === "classify") {
    const eligible = await classify();
    await output("eligible", eligible);
    if (!eligible) {
      console.log("REVIEW: Verified major dependency update skipped; owner review required");
      if (process.env.GITHUB_STEP_SUMMARY)
        await fs.appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          `Review required: Dependabot PR #${process.env.DEPENDABOT_PR} is a verified major update. No refresh or merge requested.\n`
        );
    }
  } else if (mode === "smoke-result") {
    const root = target(process.env);
    const pr = await githubRequest("api", `${root}/pulls/${process.env.DEPENDABOT_PR}`);
    if (pr.state !== "open" || pr.head?.sha !== process.env.DEPENDABOT_SHA) {
      console.log("SKIP: Metadata smoke candidate naturally closed or changed");
      return;
    }
    if (process.env.METADATA_OUTCOME !== "success")
      throw new Error("Pinned metadata action failed for a stable candidate");
    await classify();
    console.log("Verified pinned metadata adapter against the same stable signed head");
  } else throw new Error("Invalid reconciliation mode");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::Dependency reconciliation stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
