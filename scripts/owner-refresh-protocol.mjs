const repository = "pbuffolino/seeknay-links";
const sha = /^[a-f0-9]{40}$/;
const integer = (value) => Number.isSafeInteger(value) && value > 0;

export function validOwnerRequest(value, now = Date.now()) {
  return (
    value?.schema === 1 &&
    value.repository === repository &&
    value.workflow === ".github/workflows/dependabot-automerge.yml" &&
    integer(value.runId) &&
    integer(value.runAttempt) &&
    sha.test(value.workflowSha || "") &&
    integer(value.number) &&
    value.number <= 999999 &&
    sha.test(value.head || "") &&
    sha.test(value.base || "") &&
    [1, 2].includes(value.intent?.attempt) &&
    value.intent.head === value.head &&
    sha.test(value.intent.base || "") &&
    (value.mode === "owner-cycle" || value.intent.base === value.base) &&
    value.intent.name === `r${value.number}-${value.intent.base}-${value.intent.attempt}` &&
    (value.mode === undefined ||
      (value.mode === "owner-cycle" &&
        (value.recoverOnly === undefined || typeof value.recoverOnly === "boolean") &&
        ((value.initialState === "open" && value.closureId === 0 && value.recoverOnly !== true) ||
          (value.initialState === "closed" && integer(value.closureId))))) &&
    integer(value.createdAt) &&
    value.createdAt <= now + 30000 &&
    integer(value.expiresAt) &&
    value.expiresAt > now &&
    value.expiresAt > value.createdAt &&
    value.expiresAt - value.createdAt <= 300000 &&
    Array.isArray(value.dependencies) &&
    value.dependencies.length > 0 &&
    value.dependencies.every(
      (dependency) =>
        ["version-update:semver-patch", "version-update:semver-minor"].includes(
          dependency?.updateType
        ) &&
        dependency.maintainerChanges === false &&
        dependency.directory === "/" &&
        dependency.targetBranch === "main" &&
        ["npm_and_yarn", "github_actions"].includes(dependency.packageEcosystem)
    )
  );
}

export function ownerRequest(env, intent, now = Date.now(), cycle) {
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.DEPENDABOT_OWNER_ASSISTED !== "true"
  )
    throw new Error("Owner assistance requires an explicit trusted main dispatch");
  const value = {
    schema: 1,
    repository: env.GITHUB_REPOSITORY,
    workflow: ".github/workflows/dependabot-automerge.yml",
    runId: Number(env.GITHUB_RUN_ID),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    workflowSha: env.GITHUB_SHA,
    number: Number(env.DEPENDABOT_PR),
    head: env.DEPENDABOT_SHA,
    base: cycle?.base || intent.base,
    intent,
    createdAt: now,
    expiresAt: Math.min(now + 300000, Number(env.DEPENDENCY_DEADLINE)),
    dependencies: JSON.parse(env.DEPENDABOT_METADATA || "null").map((dependency) => ({
      updateType: dependency.updateType,
      maintainerChanges: dependency.maintainerChanges,
      directory: dependency.directory,
      targetBranch: dependency.targetBranch,
      packageEcosystem: dependency.packageEcosystem,
    })),
  };
  if (cycle)
    Object.assign(value, {
      mode: "owner-cycle",
      initialState: cycle.initialState,
      closureId: cycle.closureId,
      recoverOnly: cycle.recoverOnly || false,
    });
  if (!validOwnerRequest(value, now)) throw new Error("Invalid owner refresh request provenance");
  return value;
}

export function trustedDispatch(run, id, sha, workflowId) {
  return (
    run?.id === id &&
    run.workflow_id === workflowId &&
    run.path === ".github/workflows/dependabot-automerge.yml" &&
    run.event === "workflow_dispatch" &&
    run.head_branch === "main" &&
    run.head_sha === sha &&
    run.repository?.full_name === "pbuffolino/seeknay-links" &&
    run.head_repository?.full_name === "pbuffolino/seeknay-links" &&
    run.actor?.login === "pbuffolino" &&
    run.actor.type === "User" &&
    run.triggering_actor?.login === "pbuffolino" &&
    run.triggering_actor.type === "User"
  );
}
export function trustedRun(run, id, sha, workflowId) {
  return (
    trustedDispatch(run, id, sha, workflowId) &&
    run.referenced_workflows?.some(
      (entry) =>
        entry.path ===
          `pbuffolino/seeknay-links/.github/workflows/dependabot-reconcile-pr.yml@${sha}` &&
        entry.sha === sha
    )
  );
}
