import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const exec = promisify(execFile);
export const requiredChecks = [
  "lint",
  "link-check",
  "security-audit",
  "browser-test",
  "dependency-review",
  "Analyze (actions)",
  "Analyze (javascript-typescript)",
];
const updateTypes = ["version-update:semver-patch", "version-update:semver-minor"];

export function onlyActionPins(file) {
  if (!/^\.github\/workflows\/[\w-]+\.ya?ml$/.test(file.filename) || !file.patch) return false;
  const changed = file.patch.split("\n").filter((line) => /^[+-]/.test(line));
  const pins = changed.map((line) =>
    line.match(
      /^[+-]\s*(?:-\s*)?uses:\s+([\w.-]+\/[\w./-]+)@[a-f0-9]{40}\s+#\s+v(\d+)\.\d+\.\d+\s*$/
    )
  );
  // Match the action identity and major on both sides, not just arbitrary SHA-shaped lines.
  return (
    pins.length > 0 &&
    pins.length % 2 === 0 &&
    pins.every(Boolean) &&
    pins.every(
      (pin, index) =>
        index % 2 === 0 || (pin[1] === pins[index - 1][1] && pin[2] === pins[index - 1][2])
    ) &&
    changed.every((line, index) => line[0] === (index % 2 ? "+" : "-"))
  );
}

export function safeDependencyPR(pr, files, commits, repo, sha, dependencies) {
  if (
    repo !== "pbuffolino/seeknay-links" ||
    !/^[a-f0-9]{40}$/.test(sha || "") ||
    pr.state !== "open" ||
    pr.draft ||
    pr.base?.ref !== "main" ||
    pr.base?.repo?.full_name !== repo ||
    pr.head?.repo?.full_name !== repo ||
    pr.user?.login !== "dependabot[bot]" ||
    !pr.head.ref.startsWith("dependabot/") ||
    pr.head.sha !== sha ||
    pr.commits !== 1 ||
    commits.length !== 1 ||
    commits[0].sha !== sha ||
    commits[0].author?.login !== "dependabot[bot]" ||
    commits[0].commit?.verification?.verified !== true ||
    !files.length ||
    files.length !== pr.changed_files ||
    !Array.isArray(dependencies) ||
    !dependencies.length ||
    !dependencies.every(
      (dependency) =>
        updateTypes.includes(dependency.updateType) &&
        dependency.maintainerChanges === false &&
        dependency.directory === "/" &&
        dependency.targetBranch === "main"
    )
  )
    return false;
  const ecosystems = new Set(dependencies.map((dependency) => dependency.packageEcosystem));
  if (ecosystems.size !== 1) return false;
  const ecosystem = [...ecosystems][0];
  return files.every(
    (file) =>
      file.status === "modified" &&
      !file.previous_filename &&
      (ecosystem === "npm_and_yarn"
        ? ["package.json", "package-lock.json"].includes(file.filename)
        : ecosystem === "github_actions" && onlyActionPins(file))
  );
}

export function protectedBranch(protection) {
  return (
    protection?.requiresStatusChecks === true &&
    protection.requiresStrictStatusChecks === true &&
    requiredChecks.every((name) =>
      protection.requiredStatusChecks?.some(
        (check) => check.context === name && check.app?.databaseId === 15368
      )
    )
  );
}

export function matchingCI(runs, sha, number) {
  return runs.find(
    (run) =>
      run.head_sha === sha &&
      run.event === "pull_request" &&
      run.path === ".github/workflows/ci.yml" &&
      run.pull_requests?.some((pr) => pr.number === Number(number))
  );
}

export function successfulScans(analyses, sha) {
  return ["/language:actions", "/language:javascript-typescript"].every((category) => {
    const latest = analyses.find(
      (analysis) => analysis.category === category && analysis.tool?.name === "CodeQL"
    );
    return latest?.commit_sha === sha && latest.error === "" && !latest.warning;
  });
}

export async function mergeDependabot({ env = process.env, request } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const number = env.DEPENDABOT_PR;
  const sha = env.DEPENDABOT_SHA;
  if (
    repo !== "pbuffolino/seeknay-links" ||
    !/^\d+$/.test(number || "") ||
    !/^[a-f0-9]{40}$/.test(sha || "")
  )
    throw new Error("Invalid dependency merge target");
  const dependencies = JSON.parse(env.DEPENDABOT_METADATA || "null");
  const gh =
    request ||
    (async (...args) => {
      try {
        const { stdout } = await exec("gh", args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
        return JSON.parse(stdout);
      } catch {
        throw new Error("GitHub request failed");
      }
    });
  async function verify() {
    const pr = await gh("api", `repos/${repo}/pulls/${number}`);
    const files = await gh("api", `repos/${repo}/pulls/${number}/files?per_page=100`);
    const commits = await gh("api", `repos/${repo}/pulls/${number}/commits?per_page=100`);
    if (!safeDependencyPR(pr, files, commits, repo, sha, dependencies))
      throw new Error("Dependency PR failed identity, signature, metadata, or file guard");
    // GraphQL exposes this read-only rule without requesting an administration-scoped token.
    const protection = await gh(
      "api",
      "graphql",
      "-f",
      'query={ repository(owner:"pbuffolino",name:"seeknay-links") { ref(qualifiedName:"refs/heads/main") { branchProtectionRule { requiresStatusChecks requiresStrictStatusChecks requiredStatusChecks { context app { databaseId } } } } } }'
    );
    if (!protectedBranch(protection.data?.repository?.ref?.branchProtectionRule))
      throw new Error("Required branch protection is missing");
    return pr;
  }
  await verify();
  console.log("Verified dependency PR; waiting for exact-commit CI and branch protection");
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await gh(
      "api",
      `repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${sha}&per_page=100`
    );
    const run = matchingCI(response.workflow_runs, sha, number);
    if (run?.status === "completed" && run.conclusion !== "success")
      throw new Error("Dependency CI did not succeed");
    const current = await verify();
    if (run?.conclusion === "success" && current.mergeable_state === "clean") {
      const analyses = await gh(
        "api",
        `repos/${repo}/code-scanning/analyses?ref=refs/pull/${number}/head&tool_name=CodeQL&per_page=100`
      );
      if (!successfulScans(analyses, sha))
        throw new Error("Current dependency CodeQL coverage is incomplete");
      const alerts = await gh(
        "api",
        `repos/${repo}/code-scanning/alerts?ref=refs/pull/${number}/head&state=open&per_page=100`
      );
      if (alerts.length) throw new Error("Dependency PR has unresolved code-scanning alerts");
      await verify();
      const result = await gh(
        "api",
        "--method",
        "PUT",
        `repos/${repo}/pulls/${number}/merge`,
        "-f",
        `sha=${sha}`,
        "-f",
        "merge_method=squash"
      );
      if (!result.merged) throw new Error("Protected dependency merge was rejected");
      const merged = await gh("api", `repos/${repo}/pulls/${number}`);
      if (!merged.merged || merged.head.sha !== sha)
        throw new Error("Cannot verify dependency merge");
      // GITHUB_TOKEN merges do not trigger legacy Pages builds. Request publication explicitly.
      await gh("api", "--method", "POST", `repos/${repo}/pages/builds`);
      console.log("Dependency merge verified; Pages build requested");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error(
    "Dependency checks or branch freshness did not become mergeable; review required"
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mergeDependabot().catch((error) => {
    console.error(`::error::Dependency merge stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
