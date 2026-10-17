import { safeDependencyPR, protectedBranch } from "./merge-dependabot.mjs";
import { ownedIntent, listAll, restoreOwnedRef } from "./native-dependabot-refresh.mjs";
import { cycleGrant, ownerClosureGrant } from "./owner-cycle-intent.mjs";
import { validOwnerRequest, trustedRun } from "./owner-refresh-protocol.mjs";
import { restoreViaOwnerSSH } from "./owner-ssh-ref.mjs";

const repo = "pbuffolino/seeknay-links",
  root = `repos/${repo}`;
const owner = (actor) => actor?.login === "pbuffolino" && actor.type === "User";
export async function assistOwnerCycle({
  value,
  artifact,
  run,
  request,
  now = Date.now,
  sshRestore = restoreViaOwnerSSH,
}) {
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
    createReference: async ({ number, sha, ref, verifyAbsent }) => {
      await sshRestore({
        number,
        sha,
        ref,
        verifyAbsent: async () => {
          await verify({ cleanup: true });
          await verifyAbsent();
        },
      });
    },
  };
  async function verify({ cleanup = false, allowChanged = cleanup } = {}) {
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
    const changedHead =
      allowChanged &&
      pr.state === "open" &&
      pr.merged === false &&
      pr.head?.sha !== value.head &&
      /^[a-f0-9]{40}$/.test(pr.head?.sha || "");
    const [files, commits] = changedHead
      ? [null, null]
      : await Promise.all([
          request("api", `${root}/pulls/${value.number}/files?per_page=100`),
          request("api", `${root}/pulls/${value.number}/commits?per_page=100`),
        ]);
    if (
      (!changedHead &&
        !safeDependencyPR(
          { ...pr, state: "open" },
          files,
          commits,
          repo,
          value.head,
          value.dependencies
        )) ||
      (changedHead &&
        (pr.number !== value.number ||
          pr.draft ||
          pr.user?.login !== "dependabot[bot]" ||
          pr.head?.repo?.full_name !== repo ||
          pr.base?.repo?.full_name !== repo ||
          pr.base?.ref !== "main")) ||
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
      !(await ownerClosureGrant(
        { ...pr, head: { ...pr.head, sha: value.head } },
        events,
        request,
        false,
        grant.name
      ))
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
    return { pr, latest, newStates, files, commits, changedHead };
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
  const initial = await verify({ allowChanged: true });
  if (initial.changedHead) {
    console.log(
      "Open changed head observed without writes; backend must collect fresh metadata and scans"
    );
    return true;
  }
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
    if (value.expiresAt - now() < 125000)
      throw new Error("Insufficient grant lifetime for the bounded close/reopen requests");
    const closed = await request(
      "api",
      "--method",
      "PATCH",
      `${root}/pulls/${value.number}`,
      "-f",
      "state=closed"
    );
    // All network guards just passed. The exact immutable signed SHA binds the
    // cached complete file/commit evidence to this native close receipt.
    if (
      closed?.state !== "closed" ||
      closed.merged !== false ||
      closed.number !== value.number ||
      closed.head?.ref !== final.pr.head.ref ||
      !safeDependencyPR(
        { ...closed, state: "open" },
        final.files,
        final.commits,
        repo,
        value.head,
        value.dependencies
      )
    )
      throw new Error("Owner close receipt changed signed eligibility; guarded recovery required");
    // Reopen immediately. Long verification waits here let Dependabot delete the
    // head. Full receipt/timeline checks and guarded finally recovery follow.
    let opened;
    try {
      opened = await request(
        "api",
        "--method",
        "PATCH",
        `${root}/pulls/${value.number}`,
        "-f",
        "state=open"
      );
    } catch (error) {
      // A deletion can still race a slow native request. Recovery is allowed only
      // after the existing complete guards prove and restore that absent ref.
      if (error.status !== 422) throw error;
      await verify({ cleanup: true });
      if (!(await restoreOwnedRef(restoration))) throw error;
      await reopen();
      opened = await request("api", `${root}/pulls/${value.number}`);
    }
    if (
      opened?.state !== "open" ||
      opened.merged !== false ||
      opened.number !== value.number ||
      opened.draft ||
      opened.user?.login !== "dependabot[bot]" ||
      opened.head?.repo?.full_name !== repo ||
      opened.base?.repo?.full_name !== repo ||
      opened.base?.ref !== "main" ||
      opened.head?.ref !== final.pr.head.ref ||
      !/^[a-f0-9]{40}$/.test(opened.head?.sha || "")
    )
      throw new Error("Owner immediate reopen receipt failed");
    const post = await verify({ cleanup: true });
    const closure = post.newStates.filter((event) => event.event === "closed").at(-1);
    if (
      post.pr.state !== "open" ||
      !closure ||
      Date.parse(closure.created_at) < value.createdAt - 1000 ||
      Date.parse(closure.created_at) > value.expiresAt ||
      closure.id <= (final.latest?.id || 0) ||
      post.latest?.event !== "reopened" ||
      post.latest.id <= closure.id ||
      !owner(post.latest.actor)
    )
      throw new Error("Owner fast cycle post-receipt timeline did not verify");
  } finally {
    // A successful close followed by process termination is also recoverable from the grant.
    await reopen();
  }
  console.log(
    `OWNER FULL CYCLE VERIFIED: PR #${value.number}, run ${run.id}; fresh bot head and backend checks still required`
  );
  return true;
}
