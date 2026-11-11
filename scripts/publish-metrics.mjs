import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const exec = promisify(execFile);
const branch = "chore/update-social-metrics";
async function ghCli(...args) {
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
export function matchingRun(runs, sha, number, workflowPath = ".github/workflows/codeql.yml") {
  return runs.find(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === branch &&
      run.event === "pull_request" &&
      run.path === workflowPath &&
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
// The workflow runs a copy of this file in isolation, so it cannot import NETWORKS from
// update-social-metrics.mjs; tests/metrics.test.mjs keeps the two lists equal.
export const NETWORKS = ["youtube", "instagram", "tiktok", "bluesky", "facebook"];

export function validateMetricsBlob(blob) {
  if (
    blob?.type !== "file" ||
    blob.encoding !== "base64" ||
    !Number.isSafeInteger(blob.size) ||
    blob.size > 65536 ||
    blob.size < 1 ||
    typeof blob.content !== "string" ||
    blob.content.length > 100000
  )
    throw new Error("Invalid metrics content response");
  const encoded = blob.content.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
    throw new Error("Invalid metrics encoding");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== blob.size) throw new Error("Metrics content size mismatch");
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid metrics JSON");
  }
  const date = (item) => typeof item === "string" && Number.isFinite(Date.parse(item));
  if (
    !value ||
    Array.isArray(value) ||
    !date(value.updatedAt) ||
    !date(value.lastAttemptAt) ||
    Object.keys(value).some((key) => ![...NETWORKS, "updatedAt", "lastAttemptAt"].includes(key))
  )
    throw new Error("Invalid metrics document");
  for (const network of NETWORKS) {
    const metric = value[network];
    if (
      !metric ||
      !Number.isSafeInteger(metric.count) ||
      metric.count < 0 ||
      !date(metric.lastSuccessAt) ||
      !date(metric.lastAttemptAt) ||
      typeof metric.display !== "string" ||
      metric.display.length > 200 ||
      Object.keys(metric).some(
        (key) => !["count", "display", "lastSuccessAt", "lastAttemptAt", "lastError"].includes(key)
      ) ||
      (metric.lastError !== undefined && metric.lastError !== "Update failed")
    )
      throw new Error(`Invalid ${network} metrics`);
  }
  return value;
}

export async function publishMetrics({
  repo = process.env.GITHUB_REPOSITORY,
  number = process.env.METRICS_PR,
  request: gh = ghCli,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "") || !/^\d+$/.test(number || ""))
    throw new Error("Invalid publication target");
  const loadPR = () =>
    Promise.all(
      [`repos/${repo}/pulls/${number}`, `repos/${repo}/pulls/${number}/files`].map(
        async (endpoint) => JSON.parse(await gh("api", endpoint))
      )
    );
  const [pr, files] = await loadPR();
  if (!safeMetricsPR(pr, files, repo)) throw new Error("Metrics PR contains unexpected changes");
  async function verifyUnchangedPR() {
    const [current, currentFiles] = await loadPR();
    if (!safeMetricsPR(current, currentFiles, repo) || current.head.sha !== pr.head.sha)
      throw new Error("Metrics PR changed during publication");
  }
  // Read only the generated data at the verified immutable PR head. Never run PR code.
  const content = JSON.parse(
    await gh("api", `repos/${repo}/contents/assets/social-metrics.json?ref=${pr.head.sha}`)
  );
  validateMetricsBlob(content);
  console.log("Metrics data validated; waiting for exact-head CodeQL");
  const deadline = now() + 10 * 60 * 1000;
  let codeql;
  const approvedRuns = new Set();
  while (now() < deadline) {
    const response = JSON.parse(
      await gh(
        "api",
        `repos/${repo}/actions/runs?branch=${branch}&event=pull_request&head_sha=${pr.head.sha}&per_page=100`
      )
    );
    codeql = matchingRun(response.workflow_runs, pr.head.sha, number);
    // Only the same-repository, metrics-only PR passed the guard above.
    if (codeql?.conclusion === "action_required" && !approvedRuns.has(codeql.id)) {
      await verifyUnchangedPR();
      await gh("api", "--method", "POST", `repos/${repo}/actions/runs/${codeql.id}/approve`);
      approvedRuns.add(codeql.id);
      console.log("Approved a required workflow for the verified metrics-only PR");
    }
    if (codeql?.status === "completed" && codeql.conclusion !== "action_required") break;
    await sleep(10000);
  }
  if (codeql?.status !== "completed" || codeql.conclusion !== "success")
    throw new Error("Metrics commit CodeQL did not succeed");
  console.log("Metrics data and CodeQL passed; requesting protected merge");
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
  await gh(
    "api",
    "--method",
    "POST",
    `repos/${repo}/actions/workflows/codeql.yml/dispatches`,
    "-f",
    "ref=main"
  );
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
