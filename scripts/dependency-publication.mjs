import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { githubRequest, successfulScans, scanProblem } from "./merge-dependabot.mjs";

const repo = "pbuffolino/seeknay-links";
const root = `repos/${repo}`;
const shaPattern = /^[a-f0-9]{40}$/;
const workflows = ["ci.yml", "codeql.yml"];
const resources = [
  "assets/links.json",
  "assets/social-metrics.json",
  "robots.txt",
  "sitemap.xml",
  "assets/og.png",
  "favicon.ico",
  "assets/favicon-32.png",
  "assets/favicon.svg",
  "css/styles.css",
  "js/ui.js",
  "js/analytics.js",
  "js/followers.js",
  "js/links.js",
  "assets/avatar-96.jpg",
  "assets/avatar-192.jpg",
];

export function assertCheckout(
  sha,
  readHead = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
) {
  if (!shaPattern.test(sha || "") || readHead() !== sha)
    throw new Error("Trusted main checkout does not match the expected publication revision");
}

function validRun(run, workflow, sha) {
  return (
    run.head_sha === sha &&
    run.head_branch === "main" &&
    run.path === `.github/workflows/${workflow}` &&
    ["push", "workflow_dispatch", "schedule"].includes(run.event)
  );
}

async function mainRevision(request) {
  const base = await request("api", `${root}/branches/main`);
  if (!shaPattern.test(base.commit?.sha || "")) throw new Error("Invalid main revision");
  return base.commit.sha;
}

export async function requestPublication({ request = githubRequest } = {}) {
  const sha = await mainRevision(request);
  for (const workflow of workflows) {
    const result = await request(
      "api",
      `${root}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`
    );
    const run = result.workflow_runs.find((run) => validRun(run, workflow, sha));
    if (!run || (run.status === "completed" && run.conclusion !== "success"))
      await request(
        "api",
        "--method",
        "POST",
        `${root}/actions/workflows/${workflow}/dispatches`,
        "-f",
        "ref=main"
      );
  }
  const builds = await request("api", `${root}/pages/builds?per_page=100`);
  if (
    !builds.some(
      (build) => build.commit === sha && ["built", "building", "queued"].includes(build.status)
    )
  )
    await request("api", "--method", "POST", `${root}/pages/builds`);
  if ((await mainRevision(request)) !== sha)
    throw new Error("Main changed while requesting publication; retry required");
  return sha;
}

export async function publicationReady(sha, request = githubRequest) {
  if (!shaPattern.test(sha || "")) throw new Error("Invalid publication revision");
  if ((await mainRevision(request)) !== sha)
    throw new Error("Main advanced during publication; next reconciliation must verify it");
  for (const workflow of workflows) {
    const result = await request(
      "api",
      `${root}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`
    );
    const run = result.workflow_runs.find((run) => validRun(run, workflow, sha));
    if (run?.status === "completed" && run.conclusion !== "success")
      throw new Error("Main CI or CodeQL failed");
    if (run?.conclusion !== "success") return false;
  }
  const analyses = await request(
    "api",
    `${root}/code-scanning/analyses?ref=refs/heads/main&per_page=100`
  );
  if (scanProblem(analyses, sha)) throw new Error("Main CodeQL has errors or coverage warnings");
  if (!successfulScans(analyses, sha)) return false;
  const alerts = await request(
    "api",
    `${root}/code-scanning/alerts?ref=refs/heads/main&state=open&per_page=100`
  );
  if (alerts.length) throw new Error("Main has unresolved code-scanning alerts");
  const builds = await request("api", `${root}/pages/builds?per_page=100`);
  if (!builds.some((build) => build.commit === sha && build.status === "built")) return false;
  const deployments = await request(
    "api",
    `${root}/deployments?environment=github-pages&per_page=100`
  );
  const deployment = deployments.find(
    (deployment) => deployment.sha === sha && deployment.environment === "github-pages"
  );
  if (!Number.isSafeInteger(deployment?.id)) return false;
  const statuses = await request(
    "api",
    `${root}/deployments/${deployment.id}/statuses?per_page=100`
  );
  if (["failure", "error"].includes(statuses[0]?.state)) throw new Error("Pages deployment failed");
  return statuses[0]?.state === "success";
}

export async function verifyLive({ fetchImpl = fetch, readFile = fs.readFile } = {}) {
  const { publicHtmlFingerprint } = await import("./html.mjs");
  const origin = "https://links.seeknay.com";
  async function get(resource) {
    const response = await fetchImpl(`${origin}/${resource}?publication=${Date.now()}`, {
      signal: AbortSignal.timeout(20000),
      redirect: "manual",
      headers: { "Cache-Control": "no-cache" },
    });
    if (response.status !== 200) throw new Error("Published resource is unavailable");
    return Buffer.from(await response.arrayBuffer());
  }
  const html = (await get("")).toString();
  if (publicHtmlFingerprint(html) !== publicHtmlFingerprint(await readFile("index.html", "utf8")))
    throw new Error("Published HTML does not match the verified revision");
  for (const resource of resources) {
    if (!(await get(resource)).equals(await readFile(resource)))
      throw new Error(`Published resource does not match: ${resource}`);
  }
}

export async function verifyPublication({
  sha,
  request = githubRequest,
  live = verifyLive,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const deadline = now() + 10 * 60 * 1000;
  while (now() < deadline) {
    if (await publicationReady(sha, request)) {
      try {
        await live();
        if ((await mainRevision(request)) !== sha)
          throw new Error("Main changed after live verification");
        return;
      } catch {
        // CDN propagation can lag deployment. Bound retries, never treat a build request as delivery.
      }
    }
    await sleep(15000);
  }
  throw new Error("Main checks or live Pages publication did not verify within ten minutes");
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== repo) throw new Error("Invalid repository");
  if (process.argv[2] === "request") {
    // Leave five minutes for jobs to stop and report before the 90-minute maintenance limit.
    process.env.DEPENDENCY_DEADLINE = String(Date.now() + 85 * 60 * 1000);
    const sha = await requestPublication();
    if (process.env.GITHUB_OUTPUT)
      await fs.appendFile(
        process.env.GITHUB_OUTPUT,
        `sha=${sha}\ndeadline=${process.env.DEPENDENCY_DEADLINE}\n`
      );
  } else if (process.argv[2] === "assert-checkout") {
    assertCheckout(process.env.PUBLICATION_SHA);
  } else if (process.argv[2] === "verify") {
    assertCheckout(process.env.PUBLICATION_SHA);
    await verifyPublication({ sha: process.env.PUBLICATION_SHA });
    console.log(
      "Verified exact main CI, both CodeQL analyses, Pages deployment, and live resources"
    );
  } else throw new Error("Invalid publication mode");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::Dependency publication stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
