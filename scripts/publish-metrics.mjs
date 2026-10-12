import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const exec = promisify(execFile);
const branch = "chore/update-social-metrics";
async function gh(...args) {
  try {
    const { stdout } = await exec("gh", args, { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const status = error.stderr?.match(/HTTP (\d{3})/)?.[1];
    throw new Error(status ? `GitHub request rejected (HTTP ${status})` : "GitHub request failed", {
      cause: error,
    });
  }
}
export function matchingRun(runs, sha, number) {
  return runs.find(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === branch &&
      run.event === "pull_request" &&
      run.path === ".github/workflows/ci.yml" &&
      run.pull_requests?.some((pr) => pr.number === Number(number))
  );
}
export function safeMetricsPR(pr, files, repo) {
  return (
    pr.state === "open" &&
    pr.base.ref === "main" &&
    pr.head.ref === branch &&
    pr.head.repo?.full_name === repo &&
    pr.base.repo?.full_name === repo &&
    pr.user?.login === "github-actions[bot]" &&
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
  if (!safeMetricsPR(pr, files, repo)) throw new Error("Metrics PR contains unexpected changes");
  async function verifyUnchangedPR() {
    const current = JSON.parse(await gh("api", `repos/${repo}/pulls/${number}`));
    const currentFiles = JSON.parse(await gh("api", `repos/${repo}/pulls/${number}/files`));
    if (!safeMetricsPR(current, currentFiles, repo) || current.head.sha !== pr.head.sha)
      throw new Error("Metrics PR changed during publication");
  }
  const startedAt = Date.now();
  console.log("Waiting for pull-request CI for the verified metrics commit");
  const deadline = startedAt + 10 * 60 * 1000;
  let run;
  const approvedRuns = new Set();
  while (Date.now() < deadline) {
    const response = JSON.parse(
      await gh(
        "api",
        `repos/${repo}/actions/workflows/ci.yml/runs?branch=${branch}&event=pull_request&per_page=100`
      )
    );
    run = matchingRun(response.workflow_runs, pr.head.sha, number);
    if (run?.conclusion === "action_required") {
      // Only the same-repository, metrics-only PR passed the guard above.
      if (!approvedRuns.has(run.id)) {
        await verifyUnchangedPR();
        await gh("api", "--method", "POST", `repos/${repo}/actions/runs/${run.id}/approve`);
        approvedRuns.add(run.id);
        console.log("Approved CI for the verified metrics-only PR");
      }
      run = undefined;
    }
    if (run?.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  if (run?.status !== "completed" || run.conclusion !== "success")
    throw new Error("Metrics commit CI did not succeed");
  console.log("CI passed for metrics commit; requesting protected merge");
  await verifyUnchangedPR();
  const result = JSON.parse(
    await gh(
      "api",
      "--method",
      "PUT",
      `repos/${repo}/pulls/${number}/merge`,
      "-f",
      `sha=${pr.head.sha}`,
      "-f",
      "merge_method=squash"
    )
  );
  if (!result.merged) throw new Error("Metrics merge was rejected");
  const merged = JSON.parse(await gh("api", `repos/${repo}/pulls/${number}`));
  if (!merged.merged) throw new Error("Metrics PR was not merged");
  console.log("Merge verified; requesting Pages build");
  await gh("api", "--method", "POST", `repos/${repo}/pages/builds`);
  console.log("Merged verified metrics and requested Pages publication");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishMetrics().catch((error) => {
    console.error(`::error::Metrics publication failed: ${error.message}`);
    process.exitCode = 1;
  });
}
