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

export async function githubRequest(...args) {
  if (process.env.DEPENDENCY_DEADLINE) {
    const deadline = Number(process.env.DEPENDENCY_DEADLINE);
    if (!Number.isSafeInteger(deadline) || deadline <= Date.now())
      throw new Error("Dependency maintenance budget exhausted");
  }
  try {
    const { stdout } = await exec("gh", args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch (error) {
    const status = error.stderr?.match(/HTTP (\d{3})/)?.[1];
    // Never emit response bodies, environment variables, or credential-bearing logs.
    const failure = new Error(`GitHub request failed${status ? ` (HTTP ${status})` : ""}`, {
      cause: error,
    });
    failure.status = status ? Number(status) : undefined;
    throw failure;
  }
}

export function onlyActionPins(file, sameMajor = true) {
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
        index % 2 === 0 ||
        (pin[1] === pins[index - 1][1] && (!sameMajor || pin[2] === pins[index - 1][2]))
    ) &&
    changed.every((line, index) => line[0] === (index % 2 ? "+" : "-"))
  );
}

export function safeDependencyPR(pr, files, commits, repo, sha, dependencies) {
  return (
    Array.isArray(dependencies) &&
    dependencies.every((dependency) => updateTypes.includes(dependency.updateType)) &&
    safeDependencyScope(pr, files, commits, repo, sha, dependencies)
  );
}

// Classification may recognize a verified major for review. The merge guard above
// always additionally requires patch/minor metadata for every dependency.
export function safeDependencyScope(pr, files, commits, repo, sha, dependencies) {
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
        [...updateTypes, "version-update:semver-major"].includes(dependency.updateType) &&
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
        : ecosystem === "github_actions" &&
          onlyActionPins(
            file,
            !dependencies.some(
              (dependency) => dependency.updateType === "version-update:semver-major"
            )
          ))
  );
}

export function protectedBranch(protection) {
  const checks = protection?.protection?.required_status_checks;
  return (
    protection?.protected === true &&
    protection.protection?.enabled === true &&
    checks?.enforcement_level === "everyone" &&
    requiredChecks.every((name) =>
      checks.checks?.some((check) => check.context === name && check.app_id === 15368)
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

export function scanProblem(analyses, sha) {
  return ["/language:actions", "/language:javascript-typescript"].some((category) => {
    const latest = analyses.find(
      (analysis) => analysis.category === category && analysis.tool?.name === "CodeQL"
    );
    return latest?.commit_sha === sha && Boolean(latest.error || latest.warning);
  });
}

export async function mergeDependabot({
  env = process.env,
  request = githubRequest,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
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
  const gh = request;
  async function verify() {
    const pr = await gh("api", `repos/${repo}/pulls/${number}`);
    const files = await gh("api", `repos/${repo}/pulls/${number}/files?per_page=100`);
    const commits = await gh("api", `repos/${repo}/pulls/${number}/commits?per_page=100`);
    if (!safeDependencyPR(pr, files, commits, repo, sha, dependencies))
      throw new Error("Dependency PR failed identity, signature, metadata, or file guard");
    // The branch summary needs contents:read, unlike the administration-only protection endpoint.
    const protection = await gh("api", `repos/${repo}/branches/main`);
    if (!protectedBranch(protection)) throw new Error("Required branch protection is missing");
    return { ...pr, verifiedBaseSha: protection.commit.sha };
  }
  await verify();
  console.log("Verified dependency PR; waiting for exact-commit CI and branch protection");
  const deadline = now() + 12 * 60 * 1000;
  while (now() < deadline) {
    const response = await gh(
      "api",
      `repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${sha}&per_page=100`
    );
    const run = matchingCI(response.workflow_runs, sha, number);
    if (run?.status === "completed" && run.conclusion !== "success")
      throw new Error("Dependency CI did not succeed");
    const current = await verify();
    // A running publisher is itself a pending, non-required check, reported as "unstable".
    // The protected merge API still enforces every required check and review.
    if (run?.conclusion === "success" && ["clean", "unstable"].includes(current.mergeable_state)) {
      const analyses = await gh(
        "api",
        `repos/${repo}/code-scanning/analyses?ref=refs/pull/${number}/head&tool_name=CodeQL&per_page=100`
      );
      if (scanProblem(analyses, sha))
        throw new Error("Current dependency CodeQL analysis has errors or coverage warnings");
      // CI may finish before CodeQL uploads both languages. Missing scans never permit a merge.
      if (!successfulScans(analyses, sha)) {
        await sleep(10000);
        continue;
      }
      const alerts = await gh(
        "api",
        `repos/${repo}/code-scanning/alerts?ref=refs/pull/${number}/head&state=open&per_page=100`
      );
      if (alerts.length) throw new Error("Dependency PR has unresolved code-scanning alerts");
      const final = await verify();
      const comparison = await gh("api", `repos/${repo}/compare/${final.verifiedBaseSha}...${sha}`);
      if (comparison.merge_base_commit?.sha !== final.verifiedBaseSha)
        throw new Error("Dependency branch is behind the current base");
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
      if (
        !merged.merged ||
        merged.head.sha !== sha ||
        !/^[a-f0-9]{40}$/.test(merged.merge_commit_sha || "")
      )
        throw new Error("Cannot verify dependency merge");
      // Explicit dispatch keeps default-branch checks current after a token-authored merge.
      for (const workflow of ["ci.yml", "codeql.yml"])
        await gh(
          "api",
          "--method",
          "POST",
          `repos/${repo}/actions/workflows/${workflow}/dispatches`,
          "-f",
          "ref=main"
        );
      // GITHUB_TOKEN merges do not trigger legacy Pages builds. Request publication explicitly.
      await gh("api", "--method", "POST", `repos/${repo}/pages/builds`);
      console.log("Dependency merge verified; Pages build requested");
      return merged.merge_commit_sha;
    }
    await sleep(10000);
  }
  throw new Error(
    "Dependency checks or branch freshness did not become mergeable; review required"
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mergeDependabot()
    .then(async (sha) => {
      if (process.env.GITHUB_OUTPUT) {
        const { appendFile } = await import("node:fs/promises");
        await appendFile(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
      }
    })
    .catch((error) => {
      console.error(`::error::Dependency merge stopped: ${error.message}`);
      process.exitCode = 1;
    });
}
