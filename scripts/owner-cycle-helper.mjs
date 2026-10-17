import { safeDependencyPR, protectedBranch } from "./merge-dependabot.mjs";
import { ownedIntent, listAll, restoreOwnedRef } from "./native-dependabot-refresh.mjs";
import { cycleGrant, ownerClosureGrant } from "./owner-cycle-intent.mjs";
import { validOwnerRequest, trustedRun } from "./owner-refresh-protocol.mjs";

const repo = "pbuffolino/seeknay-links",
  root = `repos/${repo}`;
const owner = (actor) => actor?.login === "pbuffolino" && actor.type === "User";
export async function assistOwnerCycle({ value, artifact, run, request, now = Date.now }) {
  const grant = cycleGrant(value),
    restored = new Set();
  const restoration = {
    env: {
      GITHUB_REPOSITORY: repo,
      DEPENDABOT_PR: String(value.number),
      DEPENDABOT_SHA: value.head,
      DEPENDABOT_METADATA: JSON.stringify(value.dependencies),
    },
    request,
    restored,
  };
  async function verify({ cleanup = false } = {}) {
    const active = await request("api", `${root}/actions/runs/${run.id}`);
    if (
      !trustedRun(active, run.id, value.workflowSha, run.workflow_id) ||
      active.run_attempt !== value.runAttempt ||
      (!cleanup && active.status !== "in_progress")
    )
      throw new Error("Owner cycle backend provenance changed");
    const user = await request("api", "user");
    if (!owner(user)) throw new Error("Owner cycle requires existing owner authentication");
    const pr = await request("api", `${root}/pulls/${value.number}`);
    const [files, commits] = await Promise.all([
      request("api", `${root}/pulls/${value.number}/files?per_page=100`),
      request("api", `${root}/pulls/${value.number}/commits?per_page=100`),
    ]);
    if (
      !safeDependencyPR(
        { ...pr, state: "open" },
        files,
        commits,
        repo,
        value.head,
        value.dependencies
      ) ||
      pr.merged !== false ||
      !["open", "closed"].includes(pr.state)
    )
      throw new Error("Owner cycle signed eligibility changed");
    const intent = await ownedIntent(pr, request);
    if (
      intent?.name !== value.intent.name ||
      intent.head !== value.head ||
      intent.base !== value.intent.base
    )
      throw new Error("Owner cycle has no authenticated durable intent");
    const events = await listAll(`issues/${value.number}/events`, request);
    if (events.some((event) => !Number.isSafeInteger(event.id)))
      throw new Error("Invalid owner cycle timeline");
    events.sort((a, b) => a.id - b.id);
    const attached = events
      .filter(
        (event) =>
          ["labeled", "unlabeled"].includes(event.event) && event.label?.name === grant.name
      )
      .at(-1);
    const label = pr.labels.find((entry) => entry.name === grant.name);
    if (
      label?.description !== grant.description ||
      attached?.event !== "labeled" ||
      attached.actor?.login !== "github-actions[bot]" ||
      attached.actor.type !== "Bot" ||
      !Number.isFinite(Date.parse(attached.created_at)) ||
      !Number.isFinite(Date.parse(run.created_at)) ||
      !Number.isFinite(Date.parse(artifact.created_at)) ||
      Date.parse(attached.created_at) < value.createdAt - 1000 ||
      Date.parse(attached.created_at) < Date.parse(run.created_at) ||
      Date.parse(attached.created_at) > Date.parse(artifact.created_at) ||
      !(await ownerClosureGrant(pr, events, request, false, grant.name))
    )
      throw new Error("Owner cycle grant is untrusted or unrelated to this artifact");
    const states = events.filter((event) => ["closed", "reopened"].includes(event.event));
    if (states.some((event) => !Number.isFinite(Date.parse(event.created_at))))
      throw new Error("Invalid owner cycle state timestamp");
    const latest = states.at(-1);
    const newStates = states.filter((event) => event.id > attached.id);
    if (
      newStates.some((event) => !owner(event.actor)) ||
      newStates.filter((event) => event.event === "closed").length > 1
    )
      throw new Error("Owner cycle contains an unexpected or duplicate state transition");
    if (
      !newStates.length &&
      ((value.initialState === "closed" &&
        (pr.state !== "closed" || latest?.id !== value.closureId)) ||
        (value.initialState === "open" && pr.state !== "open"))
    )
      throw new Error("Owner cycle initial closure/state changed");
    const main = await request("api", `${root}/branches/main`);
    if (
      !protectedBranch(main) ||
      !/^[a-f0-9]{40}$/.test(main.commit?.sha || "") ||
      (!cleanup && main.commit.sha !== value.base)
    )
      throw new Error("Owner cycle main/protection changed");
    if (cleanup && main.commit.sha !== value.base) {
      const ancestry = await request("api", `${root}/compare/${value.base}...${main.commit.sha}`);
      if (ancestry.merge_base_commit?.sha !== value.base)
        throw new Error("Owner cleanup base is no longer on protected main");
    }
    for (const ancestor of new Set([value.intent.base, run.head_sha])) {
      const comparison = await request("api", `${root}/compare/${ancestor}...${value.base}`);
      if (comparison.merge_base_commit?.sha !== ancestor)
        throw new Error("Owner cycle revision is not on protected main");
    }
    if (!cleanup && !validOwnerRequest(value, now()))
      throw new Error("Owner cycle request expired");
    return { pr, latest, newStates };
  }
  async function reopen() {
    const current = await verify({ cleanup: true });
    if (current.pr.state === "open") return;
    await restoreOwnedRef(restoration);
    await verify({ cleanup: true });
    try {
      await request(
        "api",
        "--method",
        "PATCH",
        `${root}/pulls/${value.number}`,
        "-f",
        "state=open"
      );
    } catch (error) {
      if (error.status !== 422 || !(await restoreOwnedRef(restoration))) throw error;
      await verify({ cleanup: true });
      await request(
        "api",
        "--method",
        "PATCH",
        `${root}/pulls/${value.number}`,
        "-f",
        "state=open"
      );
    }
    const pr = await request("api", `${root}/pulls/${value.number}`);
    const events = await listAll(`issues/${value.number}/events`, request);
    const latest = events
      .filter((event) => ["closed", "reopened"].includes(event.event))
      .sort((a, b) => a.id - b.id)
      .at(-1);
    if (
      pr.state !== "open" ||
      pr.merged !== false ||
      !/^[a-f0-9]{40}$/.test(pr.head?.sha || "") ||
      latest?.event !== "reopened" ||
      !owner(latest.actor) ||
      latest.id <= current.latest.id
    )
      throw new Error("Owner cycle reopen receipt failed");
  }
  const initial = await verify();
  if (value.recoverOnly) {
    await reopen();
    return true;
  }
  if (initial.newStates.some((event) => event.event === "closed")) {
    // A killed helper may resume only its already authorized cycle, never close twice.
    await reopen();
    return true;
  }
  if (initial.pr.state === "closed") await reopen();
  const afterRecovery = await request("api", `${root}/pulls/${value.number}`);
  if (
    afterRecovery.state === "open" &&
    afterRecovery.merged === false &&
    afterRecovery.head?.sha !== value.head &&
    /^[a-f0-9]{40}$/.test(afterRecovery.head?.sha || "")
  ) {
    console.log("New head after owner recovery requires backend metadata and scans");
    return true;
  }
  try {
    const final = await verify();
    if (final.pr.state !== "open") throw new Error("Owner cycle PR is not open before closure");
    await request(
      "api",
      "--method",
      "PATCH",
      `${root}/pulls/${value.number}`,
      "-f",
      "state=closed"
    );
  } finally {
    // A successful close followed by process termination is also recoverable from the grant.
    await reopen();
  }
  console.log(
    `OWNER FULL CYCLE VERIFIED: PR #${value.number}, run ${run.id}; fresh bot head and backend checks still required`
  );
  return true;
}
