import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const exec = promisify(execFile);
const branch = "chore/update-social-metrics";
async function gh(...args) {
  const { stdout } = await exec("gh", args, { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}
export function matchingRun(runs, sha, startedAt) {
  return runs.find(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === branch &&
      run.event === "workflow_dispatch" &&
      Date.parse(run.created_at) >= startedAt - 1000
  );
}
export function safeMetricsPR(pr, files) {
  return (
    pr.state === "open" &&
    pr.base.ref === "main" &&
    pr.head.ref === branch &&
    /^[a-f0-9]{40}$/.test(pr.head.sha) &&
    files.length === 1 &&
    files[0].filename === "assets/social-metrics.json" &&
    files[0].status === "modified"
  );
}
export async function publishMetrics({
  repo = process.env.GITHUB_REPOSITORY,
  number = process.env.METRICS_PR,
} = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "") || !/^\d+$/.test(number || ""))
    throw new Error("Invalid publication target");
  const pr = JSON.parse(await gh("api", `repos/${repo}/pulls/${number}`));
  const files = JSON.parse(await gh("api", `repos/${repo}/pulls/${number}/files`));
  if (!safeMetricsPR(pr, files)) throw new Error("Metrics PR contains unexpected changes");
  const startedAt = Date.now();
  await gh("workflow", "run", "ci.yml", "--repo", repo, "--ref", branch);
  console.log("Dispatched CI for metrics commit");
  const deadline = startedAt + 10 * 60 * 1000;
  let run;
  while (Date.now() < deadline) {
    const response = JSON.parse(
      await gh(
        "api",
        `repos/${repo}/actions/workflows/ci.yml/runs?branch=${branch}&event=workflow_dispatch&per_page=100`
      )
    );
    run = matchingRun(response.workflow_runs, pr.head.sha, startedAt);
    if (run?.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  if (run?.status !== "completed" || run.conclusion !== "success")
    throw new Error("Metrics commit CI did not succeed");
  console.log("CI passed for metrics commit; requesting protected merge");
  await gh("pr", "merge", number, "--repo", repo, "--squash", "--match-head-commit", pr.head.sha);
  const merged = JSON.parse(await gh("api", `repos/${repo}/pulls/${number}`));
  if (!merged.merged) throw new Error("Metrics PR was not merged");
  console.log("Merge verified; requesting Pages build");
  await gh("api", "--method", "POST", `repos/${repo}/pages/builds`);
  console.log("Merged verified metrics and requested Pages publication");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishMetrics().catch(() => {
    console.error(
      "::error::Metrics publication failed. Check CI and repository Actions/Pages permissions."
    );
    process.exitCode = 1;
  });
}
