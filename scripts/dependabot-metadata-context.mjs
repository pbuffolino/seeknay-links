import fs from "node:fs";
import path from "node:path";

// Node's --import preload runs inside the pinned action's Node process, before
// @actions/github constructs its context. Runner-managed default variables are
// not overridden in YAML and the runner's event.json is never mutated.
const payloadPath = path.join(process.env.RUNNER_TEMP, "dependabot-event.json");
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const pr = payload.pull_request;
if (
  process.env.GITHUB_REPOSITORY !== "pbuffolino/seeknay-links" ||
  pr?.user?.login !== "dependabot[bot]" ||
  pr?.head?.repo?.full_name !== process.env.GITHUB_REPOSITORY ||
  pr?.base?.repo?.full_name !== process.env.GITHUB_REPOSITORY ||
  pr?.base?.ref !== "main" ||
  !/^[a-f0-9]{40}$/.test(pr?.head?.sha || "")
)
  throw new Error("Invalid Dependabot metadata context");
process.env.GITHUB_EVENT_PATH = payloadPath;
