import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { githubRequest, safeDependencyPR, protectedBranch } from "./merge-dependabot.mjs";
import {
  ownedIntent,
  listAll,
  intentLabel,
  restoreOwnedRef,
} from "./native-dependabot-refresh.mjs";
import { validOwnerRequest, trustedDispatch, trustedRun } from "./owner-refresh-protocol.mjs";
import { assistOwnerCycle } from "./owner-cycle-helper.mjs";
export { trustedDispatch, trustedRun } from "./owner-refresh-protocol.mjs";

const exec = promisify(execFile);
const repo = "pbuffolino/seeknay-links",
  root = `repos/${repo}`;
const owner = "pbuffolino";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function trustedArtifact(artifact, run, now = Date.now()) {
  return (
    Number.isSafeInteger(artifact?.id) &&
    artifact.id > 0 &&
    !artifact.expired &&
    artifact.size_in_bytes > 0 &&
    artifact.size_in_bytes <= 65536 &&
    /^sha256:[a-f0-9]{64}$/.test(artifact.digest || "") &&
    artifact.workflow_run?.id === run.id &&
    artifact.workflow_run.repository_id === run.repository.id &&
    artifact.workflow_run.head_repository_id === run.head_repository.id &&
    artifact.workflow_run.head_sha === run.head_sha &&
    artifact.workflow_run.head_branch === "main" &&
    new RegExp(`^dependency-refresh-${run.id}-${run.run_attempt}-[1-9][0-9]{0,5}$`).test(
      artifact.name
    ) &&
    Date.parse(artifact.created_at) >= Date.parse(run.created_at) &&
    Date.parse(artifact.created_at) <= now + 30000 &&
    now - Date.parse(artifact.created_at) <= 300000
  );
}

export async function downloadRequest(artifact, { execute = exec } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dependency-owner-"));
  try {
    const { stdout: bytes } = await execute(
      "gh",
      ["api", `${root}/actions/artifacts/${artifact.id}/zip`, "--allow-escape-sequences"],
      { encoding: null, timeout: 30000, maxBuffer: 65536 }
    );
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== artifact.digest)
      throw new Error("Artifact digest mismatch");
    const file = path.join(directory, "request.zip");
    await fs.writeFile(file, bytes, { mode: 0o600 });
    const { stdout: entries } = await execute("unzip", ["-Z1", file], {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 4096,
    });
    if (
      !["refresh-request.json\n", "refresh-request.json"].includes(entries.replace(/\r\n/g, "\n"))
    )
      throw new Error("Unexpected artifact entries");
    const { stdout } = await execute("unzip", ["-p", file, "refresh-request.json"], {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 32768,
    });
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error("Invalid refresh request JSON");
    }
  } catch {
    throw new Error("Owner refresh artifact download, digest, or data validation failed");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function assistRequest({
  value,
  artifact,
  run,
  request = githubRequest,
  now = Date.now,
} = {}) {
  if (
    !validOwnerRequest(value, now()) ||
    !trustedArtifact(artifact, run, now()) ||
    value.runId !== run.id ||
    value.runAttempt !== run.run_attempt ||
    value.workflowSha !== run.head_sha ||
    artifact.name !== `dependency-refresh-${run.id}-${run.run_attempt}-${value.number}`
  )
    throw new Error("Owner refresh request provenance is invalid or expired");
  if (value.mode === "owner-cycle") return assistOwnerCycle({ value, artifact, run, request, now });
  async function verify() {
    const active = await request("api", `${root}/actions/runs/${run.id}`);
    if (
      !trustedRun(active, run.id, run.head_sha, run.workflow_id) ||
      active.status !== "in_progress" ||
      active.run_attempt !== value.runAttempt
    )
      throw new Error("Owner refresh backend is not the exact active trusted run");
    const user = await request("api", "user");
    if (user.login !== owner || user.type !== "User")
      throw new Error("Existing owner authentication is required");
    const pr = await request("api", `${root}/pulls/${value.number}`);
    // Artifact publication precedes the machine close. Never close from the owner helper.
    if (pr.state === "open") return null;
    const files = await request("api", `${root}/pulls/${value.number}/files?per_page=100`);
    const commits = await request("api", `${root}/pulls/${value.number}/commits?per_page=100`);
    if (
      !safeDependencyPR(
        { ...pr, state: "open" },
        files,
        commits,
        repo,
        value.head,
        value.dependencies
      ) ||
      pr.merged !== false
    )
      throw new Error("Owner refresh dependency signature, metadata, SHA or scope guard failed");
    const intent = await ownedIntent(pr, request);
    if (
      intent?.name !== value.intent.name ||
      intent.head !== value.head ||
      intent.base !== value.base
    )
      throw new Error("Owner refresh closure is not owned by this machine intent");
    const events = await listAll(`issues/${value.number}/events`, request);
    if (events.some((event) => !Number.isSafeInteger(event.id)))
      throw new Error("Invalid refresh timeline identity");
    events.sort((a, b) => a.id - b.id);
    const attached = events
      .filter((event) => event.event === "labeled" && event.label?.name === intentLabel)
      .at(-1);
    const states = events.filter(
      (event) => ["closed", "reopened"].includes(event.event) && event.id > attached?.id
    );
    if (
      !attached ||
      !Number.isFinite(Date.parse(attached.created_at)) ||
      Date.parse(attached.created_at) < Date.parse(run.created_at) ||
      Date.parse(attached.created_at) > Date.parse(artifact.created_at) ||
      states.length !== 1 ||
      states[0].event !== "closed" ||
      states[0].actor?.login !== "github-actions[bot]" ||
      states[0].actor.type !== "Bot" ||
      !Number.isFinite(Date.parse(states[0].created_at)) ||
      Date.parse(states[0].created_at) < Date.parse(artifact.created_at)
    )
      throw new Error("Owner refresh closure is stale, replayed, or unrelated to this artifact");
    const main = await request("api", `${root}/branches/main`);
    if (main.commit?.sha !== value.base || !protectedBranch(main))
      throw new Error("Owner refresh base or protection changed");
    const ancestry = await request("api", `${root}/compare/${run.head_sha}...${value.base}`);
    if (ancestry.merge_base_commit?.sha !== run.head_sha)
      throw new Error("Owner backend revision is not on protected main");
    const jobs = await request(
      "api",
      `${root}/actions/runs/${run.id}/attempts/${value.runAttempt}/jobs?per_page=100`
    );
    if (
      !Array.isArray(jobs.jobs) ||
      jobs.total_count > 100 ||
      !jobs.jobs.some(
        (job) =>
          job.name === `reconcile (${value.number}) / inspect` &&
          job.status === "completed" &&
          job.conclusion === "success"
      )
    )
      throw new Error("Owner refresh has no successful exact inspection job");
    return { pr, closureId: states[0].id };
  }
  if (!(await verify())) return false;
  const restored = new Set();
  const restoration = {
    env: {
      GITHUB_REPOSITORY: repo,
      DEPENDABOT_PR: String(value.number),
      DEPENDABOT_SHA: value.head,
      DEPENDABOT_METADATA: JSON.stringify(value.dependencies),
    },
    request,
    expectedBase: value.base,
    restored,
  };
  await restoreOwnedRef(restoration);
  const final = await verify();
  if (!final || !validOwnerRequest(value, now()))
    throw new Error("Owner refresh state changed before reopening");
  try {
    await request("api", "--method", "PATCH", `${root}/pulls/${value.number}`, "-f", "state=open");
  } catch (error) {
    // A deletion can race the preceding ref check. Retry once only after proving
    // and restoring that exact missing signed bot ref, never for an unrelated 422.
    if (error.status !== 422 || !(await restoreOwnedRef(restoration))) throw error;
    if (!(await verify()) || !validOwnerRequest(value, now()))
      throw new Error("Owner refresh changed before the bounded reopen retry", { cause: error });
    await request("api", "--method", "PATCH", `${root}/pulls/${value.number}`, "-f", "state=open");
  }
  const open = await request("api", `${root}/pulls/${value.number}`);
  if (
    open.state !== "open" ||
    open.merged !== false ||
    !/^[a-f0-9]{40}$/.test(open.head?.sha || "")
  )
    throw new Error("Owner reopen receipt did not verify; backend must inspect the current head");
  const events = await listAll(`issues/${value.number}/events`, request);
  const state = events
    .filter((event) => ["closed", "reopened"].includes(event.event))
    .sort((a, b) => a.id - b.id)
    .at(-1);
  if (
    !Number.isSafeInteger(state?.id) ||
    state.id <= final.closureId ||
    state.event !== "reopened" ||
    state.actor?.login !== owner ||
    state.actor.type !== "User"
  )
    throw new Error("Owner-authored reopen event did not verify; backend must recover");
  if (open.head.sha !== value.head)
    console.log(
      "New dependency head observed; eligibility remains unverified until backend metadata and scans pass"
    );
  console.log(
    `OWNER REOPEN VERIFIED: PR #${value.number}, run ${run.id}; backend retains all merge/publication gates`
  );
  return true;
}

export async function ownerDriver({
  runId,
  sha,
  request = githubRequest,
  download = downloadRequest,
  now = Date.now,
  sleep = pause,
  env = process.env,
} = {}) {
  if (
    !Number.isSafeInteger(runId) ||
    runId < 1 ||
    !/^[a-f0-9]{40}$/.test(sha || "") ||
    env.GH_TOKEN ||
    env.GITHUB_TOKEN ||
    (env.GH_HOST && env.GH_HOST !== "github.com")
  )
    throw new Error(
      "Owner driver requires a run ID, exact workflow SHA, and existing interactive gh authentication"
    );
  const workflow = await request("api", `${root}/actions/workflows/dependabot-automerge.yml`);
  const first = await request("api", `${root}/actions/runs/${runId}`);
  if (!trustedDispatch(first, runId, sha, workflow.id))
    throw new Error("Untrusted owner-assistance backend");
  const user = await request("api", "user");
  if (user.login !== owner || user.type !== "User")
    throw new Error("Existing owner authentication is required");
  const deadline = Math.min(now() + 85 * 60000, Date.parse(first.created_at) + 85 * 60000);
  const served = new Set(),
    values = new Map();
  while (now() < deadline) {
    const run = await request("api", `${root}/actions/runs/${runId}`);
    if (!trustedDispatch(run, runId, sha, workflow.id) || run.run_attempt !== first.run_attempt)
      throw new Error("Owner backend provenance changed");
    if (run.status === "completed") {
      if (!trustedRun(run, runId, sha, workflow.id))
        throw new Error("Backend workflow identity is incomplete");
      if (run.conclusion !== "success")
        throw new Error("Dependency backend did not complete successfully");
      console.log(
        `BACKEND COMPLETE: run ${runId}; independently corroborate merges and publication`
      );
      return;
    }
    if (!["in_progress", "queued", "pending", "requested", "waiting"].includes(run.status))
      throw new Error("Unexpected backend state");
    if (!trustedRun(run, runId, sha, workflow.id)) {
      await sleep(5000);
      continue;
    }
    if (run.status !== "in_progress") {
      await sleep(5000);
      continue;
    }
    const result = await request("api", `${root}/actions/runs/${runId}/artifacts?per_page=100`);
    if (!Array.isArray(result.artifacts) || result.total_count >= 100)
      throw new Error("Incomplete owner request artifact list");
    for (const artifact of result.artifacts) {
      if (!artifact.name.startsWith(`dependency-refresh-${runId}-`) || served.has(artifact.id))
        continue;
      const attempt = /^([1-9][0-9]*)(?:-|$)/.exec(
        artifact.name.slice(`dependency-refresh-${runId}-`.length)
      );
      if (attempt && Number(attempt[1]) !== run.run_attempt) continue;
      if (!trustedArtifact(artifact, run, now()))
        throw new Error("Untrusted owner request artifact");
      if (!values.has(artifact.id)) values.set(artifact.id, await download(artifact));
      if (await assistRequest({ value: values.get(artifact.id), artifact, run, request, now }))
        served.add(artifact.id);
    }
    await sleep(5000);
  }
  throw new Error("Owner driver maintenance budget exhausted");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--run" || args[2] !== "--sha")
    throw new Error("Expected --run ID --sha WORKFLOW_SHA");
  ownerDriver({ runId: Number(args[1]), sha: args[3] }).catch((error) => {
    console.error(`Owner dependency driver stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
