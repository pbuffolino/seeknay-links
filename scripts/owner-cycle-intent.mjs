import { trustedRun } from "./owner-refresh-protocol.mjs";

const root = "repos/pbuffolino/seeknay-links";
const machine = (actor) => actor?.login === "github-actions[bot]" && actor.type === "Bot";
export function cycleGrant(value) {
  return {
    name: `dependency-owner-${value.number}-${value.runId}-${value.runAttempt}`,
    description: `${value.recoverOnly ? "2" : "1"}${Buffer.from(value.head + value.base + value.workflowSha, "hex").toString("base64url")} ${Math.floor(value.createdAt / 1000).toString(36)} ${Math.floor(value.expiresAt / 1000).toString(36)}`,
  };
}
export function decodeCycleGrant(label) {
  const name = /^dependency-owner-([1-9][0-9]{0,5})-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(
    label.name || ""
  );
  const fields = /^[12]([A-Za-z0-9_-]{80}) ([a-z0-9]{1,10}) ([a-z0-9]{1,10})$/.exec(
    label.description || ""
  );
  if (!name || !fields || label.name.length > 50 || label.description.length > 100) return null;
  const bytes = Buffer.from(fields[1], "base64url");
  const createdAt = parseInt(fields[2], 36) * 1000,
    expiresAt = parseInt(fields[3], 36) * 1000;
  const [number, runId, runAttempt] = name.slice(1).map(Number);
  if (
    bytes.length !== 60 ||
    bytes.toString("base64url") !== fields[1] ||
    ![number, runId, runAttempt, createdAt, expiresAt].every(Number.isSafeInteger) ||
    createdAt <= 0 ||
    expiresAt <= createdAt ||
    expiresAt - createdAt > 300000
  )
    return null;
  return {
    number,
    runId,
    runAttempt,
    head: bytes.subarray(0, 20).toString("hex"),
    base: bytes.subarray(20, 40).toString("hex"),
    workflowSha: bytes.subarray(40).toString("hex"),
    createdAt,
    expiresAt,
    recoverOnly: label.description[0] === "2",
  };
}

// Durable machine-issued authority covers only one owner closure during a short,
// exact trusted dispatch grant. Expiry stops new cycles, not crash recovery.
export async function ownerClosureGrant(pr, events, request, closureRequired = true, expectedName) {
  const closure = events.filter((event) => ["closed", "reopened"].includes(event.event)).at(-1);
  if (
    closureRequired &&
    (closure?.event !== "closed" ||
      closure.actor?.login !== "pbuffolino" ||
      closure.actor.type !== "User")
  )
    return null;
  const verified = [];
  for (const label of (pr.labels || []).filter(
    (entry) =>
      entry.name.startsWith("dependency-owner-") && (!expectedName || entry.name === expectedName)
  )) {
    const grant = decodeCycleGrant(label);
    if (
      !grant ||
      grant.number !== pr.number ||
      grant.head !== pr.head?.sha ||
      (closureRequired && grant.recoverOnly)
    )
      continue;
    const attached = events
      .filter(
        (event) =>
          ["labeled", "unlabeled"].includes(event.event) && event.label?.name === label.name
      )
      .at(-1);
    const attachedAt = Date.parse(attached?.created_at),
      closedAt = Date.parse(closure?.created_at);
    if (
      !attached ||
      attached.event !== "labeled" ||
      !machine(attached.actor) ||
      !Number.isFinite(attachedAt) ||
      attachedAt < grant.createdAt ||
      attachedAt > grant.expiresAt ||
      (closureRequired &&
        (attached.id >= closure.id ||
          !Number.isFinite(closedAt) ||
          closedAt < grant.createdAt ||
          closedAt > grant.expiresAt))
    )
      continue;
    const run = await request("api", `${root}/actions/runs/${grant.runId}`);
    const workflow = await request("api", `${root}/actions/workflows/dependabot-automerge.yml`);
    if (
      !trustedRun(run, grant.runId, grant.workflowSha, workflow.id) ||
      run.run_attempt !== grant.runAttempt ||
      !Number.isFinite(Date.parse(run.created_at)) ||
      Date.parse(run.created_at) > grant.createdAt ||
      !["in_progress", "completed"].includes(run.status)
    )
      continue;
    const jobs = await request(
      "api",
      `${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
    );
    if (
      !Array.isArray(jobs.jobs) ||
      jobs.total_count > 100 ||
      !jobs.jobs.some(
        (job) =>
          job.name === `reconcile (${pr.number}) / inspect` &&
          job.status === "completed" &&
          job.conclusion === "success"
      )
    )
      continue;
    const main = await request("api", `${root}/branches/main`);
    const ancestry = await request("api", `${root}/compare/${grant.base}...${main.commit?.sha}`);
    const source = await request("api", `${root}/compare/${grant.workflowSha}...${grant.base}`);
    if (
      ancestry.merge_base_commit?.sha !== grant.base ||
      source.merge_base_commit?.sha !== grant.workflowSha
    )
      continue;
    // A grant can own exactly one closure; a later manual closure is not recoverable.
    const closes = events.filter((event) => event.event === "closed" && event.id > attached.id);
    if (closureRequired && (closes.length !== 1 || closes[0].id !== closure.id)) continue;
    verified.push(label.name);
  }
  return verified.length === 1 ? verified[0] : null;
}

export async function attachCycleGrant(value, request) {
  const grant = cycleGrant(value);
  if (grant.name.length > 50 || grant.description.length > 100)
    throw new Error("Owner cycle grant exceeds GitHub label limits");
  const priorNames = new Set();
  for (let page = 1; page <= 10; page++) {
    const events = await request(
      "api",
      `${root}/issues/${value.number}/events?per_page=100&page=${page}`
    );
    if (!Array.isArray(events)) throw new Error("Invalid owner cycle attempt history");
    for (const event of events)
      if (
        event.event === "labeled" &&
        machine(event.actor) &&
        event.label?.name.startsWith(`dependency-owner-${value.number}-`)
      )
        priorNames.add(event.label.name);
    if (events.length < 100) break;
    if (page === 10) throw new Error("Owner cycle attempt history is incomplete");
  }
  let attempts = 0;
  for (const name of priorNames) {
    const definition = await request("api", `${root}/labels/${encodeURIComponent(name)}`);
    const previous = decodeCycleGrant(definition);
    if (!previous) throw new Error("Owner cycle attempt evidence changed");
    if (!previous.recoverOnly && previous.base === value.base) {
      attempts++;
      if (!value.recoverOnly && previous.head === value.head)
        throw new Error("Owner cycle already requested for this PR/head/base");
      if (!value.recoverOnly && value.createdAt - previous.createdAt < 600000)
        throw new Error("Owner cycle is still pending for this PR/base");
    }
  }
  if (!value.recoverOnly && attempts >= 2)
    throw new Error("Owner cycle limit reached for this PR/base");
  let existing;
  try {
    existing = await request("api", `${root}/labels/${encodeURIComponent(grant.name)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (existing && existing.description !== grant.description)
    throw new Error("Owner cycle grant definition conflicts");
  if (!existing)
    await request(
      "api",
      "--method",
      "POST",
      `${root}/labels`,
      "-f",
      `name=${grant.name}`,
      "-f",
      `description=${grant.description}`,
      "-f",
      "color=6e7781"
    );
  await request(
    "api",
    "--method",
    "POST",
    `${root}/issues/${value.number}/labels`,
    "-f",
    `labels[]=${grant.name}`
  );
}
