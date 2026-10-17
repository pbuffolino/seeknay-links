import {
  githubRequest,
  safeDependencyPR,
  protectedBranch,
  approveDependencyRuns,
} from "./merge-dependabot.mjs";
import { ownerClosureGrant, cycleGrant } from "./owner-cycle-intent.mjs";

const repo = "pbuffolino/seeknay-links";
const root = `repos/${repo}`;
export const intentLabel = "dependency-refresh-intent";
const intentDescription =
  "Reserved for crash-recoverable signed dependency refreshes by GitHub Actions";
const shaPattern = /^[a-f0-9]{40}$/;
const isMachine = (actor) => actor?.login === "github-actions[bot]" && actor.type === "Bot";
const binderName = (number, base, attempt) => `r${number}-${base}-${attempt}`;
const binderDescription = (number, head, base, attempt) => `${number} ${head} ${base} ${attempt}`;

export async function listAll(endpoint, request = githubRequest) {
  const result = [];
  for (let page = 1; page <= 10; page++) {
    const values = await request(
      "api",
      `${root}/${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`
    );
    if (!Array.isArray(values)) throw new Error("Invalid native refresh evidence");
    result.push(...values);
    if (values.length < 100) return result;
  }
  throw new Error("Native refresh evidence exceeds the bounded pagination limit");
}

function decodeBinder(label, pr) {
  const match = /^(\d+) ([a-f0-9]{40}) ([a-f0-9]{40}) ([12])$/.exec(label.description || "");
  if (
    !match ||
    Number(match[1]) !== pr.number ||
    (pr.state === "closed" && match[2] !== pr.head?.sha)
  )
    return null;
  if (label.name !== binderName(pr.number, match[3], Number(match[4]))) return null;
  return { name: label.name, head: match[2], base: match[3], attempt: Number(match[4]) };
}

async function eventsFor(number, request) {
  const events = await listAll(`issues/${number}/events`, request);
  if (events.some((event) => !Number.isSafeInteger(event.id)))
    throw new Error("Invalid refresh event identity");
  return events.sort((a, b) => a.id - b.id);
}

export async function ownedIntent(pr, request = githubRequest) {
  if (
    pr.merged !== false ||
    !["open", "closed"].includes(pr.state) ||
    pr.user?.login !== "dependabot[bot]"
  )
    return null;
  const labels = pr.labels || [];
  const marked = labels.some((label) => label.name === intentLabel);
  if (
    marked &&
    labels.find((label) => label.name === intentLabel).description !== intentDescription
  )
    return null;
  if (pr.state === "closed" && !marked) return null;
  const binders = labels.map((label) => decodeBinder(label, pr)).filter(Boolean);
  if (binders.length !== 1) return null;
  const binder = binders[0];
  const events = await eventsFor(pr.number, request);
  function attachedByMachine(name) {
    const latest = events
      .filter(
        (event) => ["labeled", "unlabeled"].includes(event.event) && event.label?.name === name
      )
      .at(-1);
    return latest?.event === "labeled" && isMachine(latest.actor) ? latest : null;
  }
  const binding = attachedByMachine(binder.name);
  const marker = marked ? attachedByMachine(intentLabel) : null;
  if (!binding || (marked && !marker)) return null;
  if (pr.state === "closed") {
    const closure = events.filter((event) => ["closed", "reopened"].includes(event.event)).at(-1);
    // A later manual or Dependabot obsolete closure is never ours to reverse.
    if (
      closure?.event !== "closed" ||
      (!isMachine(closure.actor) && !(await ownerClosureGrant(pr, events, request))) ||
      closure.id <= Math.max(binding.id, marker.id)
    )
      return null;
  }
  return binder;
}

export async function recoverablePRs(request = githubRequest) {
  const issues = await listAll(`issues?state=closed&labels=${intentLabel}`, request);
  const numbers = [];
  for (const issue of issues) {
    if (!issue.pull_request || !Number.isSafeInteger(issue.number)) continue;
    const pr = await request("api", `${root}/pulls/${issue.number}`);
    if (await ownedIntent(pr, request)) numbers.push(pr.number);
    else
      console.log(
        `REVIEW: Closed PR #${issue.number} has no authenticated refresh recovery intent`
      );
  }
  return numbers;
}

// Recreate only an absent bot ref at its original verified signed SHA. This never
// updates an existing reference, rebases, creates a commit, or touches main.
export async function restoreOwnedRef({
  env = process.env,
  request = githubRequest,
  expectedBase,
  restored = new Set(),
  createReference,
} = {}) {
  const number = Number(env.DEPENDABOT_PR),
    sha = env.DEPENDABOT_SHA;
  if (
    env.GITHUB_REPOSITORY !== repo ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !shaPattern.test(sha || "")
  )
    throw new Error("Invalid owned-ref restoration target");
  const dependencies = JSON.parse(env.DEPENDABOT_METADATA || "null");
  async function verify() {
    const pr = await request("api", `${root}/pulls/${number}`);
    const [files, commits] = await Promise.all([
      request("api", `${root}/pulls/${number}/files?per_page=100`),
      request("api", `${root}/pulls/${number}/commits?per_page=100`),
    ]);
    if (
      pr.state !== "closed" ||
      pr.merged !== false ||
      !safeDependencyPR({ ...pr, state: "open" }, files, commits, repo, sha, dependencies)
    )
      throw new Error("Owned-ref restoration failed signed dependency guards");
    const intent = await ownedIntent(pr, request);
    if (!intent || intent.head !== sha)
      throw new Error("Missing authenticated machine closure for ref restoration");
    const branch = pr.head.ref;
    if (
      !/^dependabot\/[A-Za-z0-9_./-]+$/.test(branch) ||
      branch.includes("..") ||
      branch.endsWith(".") ||
      branch.endsWith("/") ||
      branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
    )
      throw new Error("Ref restoration is restricted to the exact safe bot branch");
    const main = await request("api", `${root}/branches/main`);
    if (
      !protectedBranch(main) ||
      !shaPattern.test(main.commit?.sha || "") ||
      (expectedBase && main.commit.sha !== expectedBase)
    )
      throw new Error("Owned-ref restoration base/protection changed");
    if (intent.base !== main.commit.sha) {
      const ancestry = await request("api", `${root}/compare/${intent.base}...${main.commit.sha}`);
      if (ancestry.merge_base_commit?.sha !== intent.base)
        throw new Error("Refresh intent base is no longer on protected main");
    }
    return {
      pr,
      intent,
      base: main.commit.sha,
      ref: `refs/heads/${branch}`,
      endpoint: `${root}/git/ref/heads/${branch}`,
    };
  }
  const original = await verify();
  async function reference() {
    try {
      return await request("api", original.endpoint);
    } catch (error) {
      if (error.status !== 404) throw error;
      return null;
    }
  }
  function matches(value) {
    return (
      value?.ref === original.ref && value.object?.type === "commit" && value.object.sha === sha
    );
  }
  let ref = await reference();
  if (ref) {
    if (!matches(ref)) throw new Error("Existing bot ref changed; never overwrite it");
    return false;
  }
  const events = await eventsFor(number, request);
  const closure = events.filter((event) => ["closed", "reopened"].includes(event.event)).at(-1);
  const deletion = events
    .filter((event) => ["head_ref_deleted", "head_ref_restored"].includes(event.event))
    .at(-1);
  if (
    closure?.event !== "closed" ||
    (!isMachine(closure.actor) && !(await ownerClosureGrant(original.pr, events, request))) ||
    deletion?.event !== "head_ref_deleted" ||
    deletion.actor?.login !== "dependabot[bot]" ||
    deletion.actor.type !== "Bot" ||
    deletion.id <= closure.id
  )
    throw new Error(
      "Missing post-closure Dependabot deletion proof; ref restoration requires review"
    );
  const restorationKey = `${original.intent.name}:${closure.id}`;
  if (restored.has(restorationKey) || restored.has(original.intent.name))
    throw new Error("Bot ref deleted again during this handoff; review required");
  if (events.some((event) => event.event === "head_ref_restored" && event.id > closure.id))
    throw new Error("Bot ref deleted again after a recorded restoration; review required");
  const final = await verify();
  if (
    final.intent.name !== original.intent.name ||
    final.ref !== original.ref ||
    final.base !== original.base
  )
    throw new Error("Owned ref/closure/base changed before restoration");
  ref = await reference();
  if (!ref) {
    restored.add(restorationKey);
    try {
      const nativeCreate = () =>
        request(
          "api",
          "--method",
          "POST",
          `${root}/git/refs`,
          "-f",
          `ref=${original.ref}`,
          "-f",
          `sha=${sha}`
        );
      if (createReference) {
        await createReference({
          number,
          sha,
          ref: original.ref,
          nativeCreate,
          verifyAbsent: async () => {
            const current = await verify();
            if (
              current.intent.name !== original.intent.name ||
              current.ref !== original.ref ||
              current.base !== original.base ||
              (await reference())
            )
              throw new Error("Owned closure/base/ref changed before create-only restoration");
            const currentEvents = await eventsFor(number, request);
            const currentClosure = currentEvents
              .filter((event) => ["closed", "reopened"].includes(event.event))
              .at(-1);
            const currentDeletion = currentEvents
              .filter((event) => ["head_ref_deleted", "head_ref_restored"].includes(event.event))
              .at(-1);
            if (currentClosure?.id !== closure.id || currentDeletion?.id !== deletion.id)
              throw new Error("Owned deletion/closure changed before create-only restoration");
          },
        });
      } else await nativeCreate();
    } catch (error) {
      if (![409, 422].includes(error.status) || !matches(await reference())) throw error;
    }
  }
  if (!matches(await reference()))
    throw new Error("Restored bot ref does not match the original signed SHA");
  const after = await verify();
  if (
    after.intent.name !== original.intent.name ||
    after.ref !== original.ref ||
    after.base !== original.base
  )
    throw new Error("Owned closure/base changed after restoring its signed ref");
  console.log(`Restored exact signed bot ref for owned refresh PR #${number}`);
  return true;
}

export async function refreshNative({
  env = process.env,
  request = githubRequest,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  approve = approveDependencyRuns,
  phase = "direct",
  stagedIntent,
  stagedRequest,
  ownerAssisted = env.DEPENDABOT_OWNER_ASSISTED === "true",
} = {}) {
  const number = Number(env.DEPENDABOT_PR);
  const sha = env.DEPENDABOT_SHA;
  if (
    env.GITHUB_REPOSITORY !== repo ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > 999999 ||
    !shaPattern.test(sha || "")
  )
    throw new Error("Invalid native refresh target");
  const dependencies = JSON.parse(env.DEPENDABOT_METADATA || "null");
  const restored = new Set();
  async function verified() {
    const pr = await request("api", `${root}/pulls/${number}`);
    const files = await request("api", `${root}/pulls/${number}/files?per_page=100`);
    const commits = await request("api", `${root}/pulls/${number}/commits?per_page=100`);
    if (
      !safeDependencyPR({ ...pr, state: "open" }, files, commits, repo, sha, dependencies) ||
      pr.merged !== false ||
      !["open", "closed"].includes(pr.state)
    )
      throw new Error("Native refresh failed signature, metadata, SHA, or scope guard");
    if (pr.state === "closed" && !(await ownedIntent(pr, request)))
      throw new Error("Closed dependency PR is not owned by this refresh");
    return pr;
  }
  async function restore(intent) {
    const latest = await request("api", `${root}/pulls/${number}`);
    if (
      latest.state === "open" &&
      latest.head?.sha !== sha &&
      shaPattern.test(latest.head?.sha || "")
    ) {
      const proof = await ownedIntent(latest, request);
      if (!proof || proof.name !== intent.name)
        throw new Error("Changed-head refresh ownership is unverified");
      console.log("Open changed head requires fresh verified metadata before intent cleanup");
      return;
    }
    let pr = await verified();
    const proof = await ownedIntent(pr, request);
    if (!proof || proof.name !== intent.name)
      throw new Error("Native refresh ownership changed; review required");
    if (pr.state === "closed") {
      await restoreOwnedRef({ env, request, restored });
      await verified();
      try {
        await request("api", "--method", "PATCH", `${root}/pulls/${number}`, "-f", "state=open");
      } catch (error) {
        if (error.status !== 422 || !(await restoreOwnedRef({ env, request, restored })))
          throw error;
        await verified();
        await request("api", "--method", "PATCH", `${root}/pulls/${number}`, "-f", "state=open");
      }
      pr = await verified();
    }
    if (pr.state !== "open" || pr.head.sha !== sha)
      throw new Error("Cannot verify native refresh reopened state");
    // Remove only our two labels, never replace the label set or touch reviews/branches.
    const ownerGrants = pr.labels.filter((label) => /^dependency-owner-/.test(label.name));
    for (const grant of ownerGrants)
      if (
        !(await ownerClosureGrant(
          { ...pr, head: { ...pr.head, sha: intent.head } },
          await eventsFor(number, request),
          request,
          false,
          grant.name
        ))
      )
        throw new Error("Owner grant is not authenticated for cleanup");
    for (const name of [intentLabel, intent.name, ...ownerGrants.map((label) => label.name)]) {
      if (pr.labels.some((label) => label.name === name))
        await request(
          "api",
          "--method",
          "DELETE",
          `${root}/issues/${number}/labels/${encodeURIComponent(name)}`
        );
    }
    console.log(`Verified PR #${number} open after native refresh`);
  }
  async function perform(intent, assisted) {
    try {
      const current = await verified();
      const proof = await ownedIntent(current, request);
      const main = await request("api", `${root}/branches/main`);
      if (
        current.state !== "open" ||
        proof?.name !== intent.name ||
        proof.head !== sha ||
        main.commit?.sha !== intent.base
      )
        throw new Error("Refresh intent/head/base is not authenticated");
      if (env.DEPENDENCY_DEADLINE && Number(env.DEPENDENCY_DEADLINE) - now() < 180000)
        throw new Error("Insufficient maintenance budget for owner handoff");
      await request("api", "--method", "PATCH", `${root}/pulls/${number}`, "-f", "state=closed");
      if (assisted) {
        const ownerDeadline = now() + 120000;
        while (now() < ownerDeadline) {
          const state = await request("api", `${root}/pulls/${number}`);
          if (state.state === "open" && state.merged === false) return;
          await verified(); // Reject manual/obsolete closures, changed closed heads and invalid signatures.
          await restoreOwnedRef({ env, request, expectedBase: intent.base, restored });
          await sleep(5000);
        }
        throw new Error("Owner handoff timed out; restoring the machine-owned closure");
      }
    } finally {
      await restore(intent);
    }
  }
  if (phase === "finish") {
    const current = await request("api", `${root}/pulls/${number}`);
    const proof = current.state === "open" ? await ownedIntent(current, request) : null;
    if (
      current.merged === false &&
      current.head?.sha !== sha &&
      shaPattern.test(current.head?.sha || "") &&
      proof?.head === sha &&
      proof.name === stagedIntent?.name
    ) {
      console.log("New bot head arrived before finish; fresh metadata and scans are required");
      return current.head.sha;
    }
  }
  const pr = await verified();
  const pending = await ownedIntent(pr, request);
  if (phase === "cleanup") {
    if (pending) await restore(pending);
    return { status: "ready" };
  }
  if (phase === "finish") {
    if (
      !ownerAssisted ||
      !stagedIntent ||
      pending?.name !== stagedIntent.name ||
      pending?.head !== sha ||
      pending?.base !== stagedIntent.base
    )
      throw new Error("Owner-assisted refresh has no matching staged intent");
    if (stagedRequest?.mode === "owner-cycle") {
      try {
        const ownerDeadline = now() + 120000;
        let reopened = false;
        while (now() < ownerDeadline) {
          const state = await request("api", `${root}/pulls/${number}`);
          const events = await eventsFor(number, request);
          const latest = events
            .filter((event) => ["closed", "reopened"].includes(event.event))
            .at(-1);
          if (
            state.state === "open" &&
            state.merged === false &&
            state.head?.sha !== sha &&
            shaPattern.test(state.head?.sha || "") &&
            (await ownedIntent(state, request))?.head === sha
          ) {
            reopened = true;
            break;
          }
          const grantName = cycleGrant(stagedRequest).name;
          const attached = events
            .filter((event) => event.event === "labeled" && event.label?.name === grantName)
            .at(-1);
          const cycleClose = events
            .filter(
              (event) =>
                event.event === "closed" &&
                event.id > attached?.id &&
                event.actor?.login === "pbuffolino" &&
                event.actor.type === "User"
            )
            .at(-1);
          if (
            state.state === "open" &&
            state.merged === false &&
            latest?.event === "reopened" &&
            latest.actor?.login === "pbuffolino" &&
            latest.actor.type === "User" &&
            (stagedRequest.recoverOnly
              ? latest.id > stagedRequest.closureId
              : cycleClose && latest.id > cycleClose.id) &&
            Date.parse(latest.created_at) >= stagedRequest.createdAt - 1000
          ) {
            reopened = true;
            break;
          }
          await verified();
          await sleep(5000);
        }
        if (!reopened) throw new Error("Owner full-cycle handoff timed out; recovery required");
      } finally {
        await restore(pending);
      }
    } else await perform(pending, true);
  } else if (pr.state === "closed") {
    if (phase === "stage" && ownerAssisted) {
      const main = await request("api", `${root}/branches/main`);
      if (!protectedBranch(main) || !shaPattern.test(main.commit?.sha || ""))
        throw new Error("Owner recovery main/protection is unverified");
      const ancestry = await request("api", `${root}/compare/${pending.base}...${main.commit.sha}`);
      if (ancestry.merge_base_commit?.sha !== pending.base)
        throw new Error("Owner recovery intent is not on protected main");
      const closure = (await eventsFor(number, request))
        .filter((event) => ["closed", "reopened"].includes(event.event))
        .at(-1);
      return {
        status: "staged",
        intent: pending,
        base: main.commit.sha,
        initialState: "closed",
        closureId: closure.id,
        recoverOnly: Boolean(
          await ownerClosureGrant(pr, await eventsFor(number, request), request)
        ),
      };
    }
    await restore(pending);
    if (phase === "stage")
      return ownerAssisted
        ? refreshNative({ env, request, now, sleep, approve, phase: "stage", ownerAssisted })
        : { status: "deferred" };
  } else {
    // Also finish cleanup after a crash following reopen or between label removals.
    if (pending) await restore(pending);
    const main = await request("api", `${root}/branches/main`);
    const base = main.commit?.sha;
    if (!shaPattern.test(base || "")) throw new Error("Invalid native refresh base");
    const comparison = await request("api", `${root}/compare/${base}...${sha}`);
    if (comparison.merge_base_commit?.sha === base)
      return phase === "stage" ? { status: "ready" } : sha;
    if (phase === "stage" && !ownerAssisted) {
      console.log(`DEFERRED: Stale PR #${number} requires an explicit owner-assisted dispatch`);
      return { status: "deferred" };
    }
    const events = await eventsFor(number, request);
    const attempts = [1, 2].filter((attempt) =>
      events.some(
        (event) =>
          event.event === "labeled" &&
          isMachine(event.actor) &&
          event.label?.name === binderName(number, base, attempt)
      )
    );
    if (attempts.length >= 2) throw new Error("Native refresh limit reached for this PR/base");
    for (const attempt of attempts) {
      const definition = await request(
        "api",
        `${root}/labels/${encodeURIComponent(binderName(number, base, attempt))}`
      );
      const previous = decodeBinder(definition, pr);
      if (!previous || previous.base !== base || previous.attempt !== attempt)
        throw new Error("Native refresh attempt evidence changed; review required");
      if (previous.head === sha)
        throw new Error("Native refresh is already pending for this PR/head/base");
    }
    const last = events
      .filter(
        (event) =>
          event.event === "labeled" &&
          isMachine(event.actor) &&
          attempts.some((attempt) => event.label?.name === binderName(number, base, attempt))
      )
      .at(-1);
    if (
      last &&
      (!Number.isFinite(Date.parse(last.created_at)) ||
        now() - Date.parse(last.created_at) < 10 * 60 * 1000)
    )
      throw new Error("Native refresh is already pending for this PR/base");
    if (
      env.DEPENDENCY_DEADLINE &&
      Number(env.DEPENDENCY_DEADLINE) - now() < (phase === "stage" ? 240000 : 90000)
    )
      throw new Error("Insufficient maintenance budget to close and restore a PR");
    const attempt = attempts.includes(1) ? 2 : 1;
    const intent = { name: binderName(number, base, attempt), head: sha, base, attempt };
    const definitions = [
      [intentLabel, intentDescription],
      [intent.name, binderDescription(number, sha, base, attempt)],
    ];
    for (const [name, description] of definitions) {
      let existing;
      try {
        existing = await request("api", `${root}/labels/${encodeURIComponent(name)}`);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      if (existing && existing.description !== description)
        throw new Error("Reserved refresh label definition conflicts");
      if (!existing)
        await request(
          "api",
          "--method",
          "POST",
          `${root}/labels`,
          "-f",
          `name=${name}`,
          "-f",
          `description=${description}`,
          "-f",
          "color=6e7781"
        );
    }
    await verified();
    await request(
      "api",
      "--method",
      "POST",
      `${root}/issues/${number}/labels`,
      "-f",
      `labels[]=${intentLabel}`,
      "-f",
      `labels[]=${intent.name}`
    );
    if (phase === "stage") return { status: "staged", intent };
    await perform(intent, false);
  }
  const deadline = now() + 5 * 60 * 1000;
  const approvedRuns = new Set();
  while (now() < deadline) {
    const current = await request("api", `${root}/pulls/${number}`);
    if (current.state !== "open" || current.merged !== false)
      throw new Error("Dependency state changed during refresh");
    if (current.head?.sha !== sha && shaPattern.test(current.head?.sha || ""))
      return current.head.sha;
    await approve({ request, verify: verified, number, approvedRuns });
    await sleep(10000);
  }
  throw new Error(
    "Native Dependabot refresh is still pending; no additional request in this attempt"
  );
}
