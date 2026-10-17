import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const exec = promisify(execFile);
const remote = "git@github.com:pbuffolino/seeknay-links.git";
const greeting =
  "Hi pbuffolino! You've successfully authenticated, but GitHub does not provide shell access.";
// Git executes this fixed Node adapter directly. No shell, user SSH configuration,
// credential helper, hook, or arbitrary remote command is accepted.
const transport = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const prefix = args.slice(0, -2);
if ((prefix.length && (prefix.length !== 2 || prefix[0] !== "-o" || prefix[1] !== "SendEnv=GIT_PROTOCOL")) || args.at(-2) !== "git@github.com" || !["git-upload-pack 'pbuffolino/seeknay-links.git'", "git-receive-pack 'pbuffolino/seeknay-links.git'"].includes(args.at(-1))) process.exit(1);
const result = spawnSync("/usr/bin/ssh", ["-F", "/dev/null", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
`;

export function isolatedGitEnvironment(source, adapter) {
  const env = { ...source };
  for (const key of Object.keys(env))
    if (
      key.startsWith("GIT_") ||
      (key.startsWith("SSH_") && key !== "SSH_AUTH_SOCK") ||
      ["GH_TOKEN", "GITHUB_TOKEN", "GH_DEBUG", "SSH_ASKPASS", "NODE_OPTIONS", "NODE_PATH"].includes(
        key
      )
    )
      delete env[key];
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH: adapter,
    GIT_SSH_VARIANT: "ssh",
    SSH_ASKPASS_REQUIRE: "never",
  };
}

export function createdRefReceipt(stdout, sha, ref) {
  return stdout.replace(/\r\n/g, "\n").split("\n").includes(`*\t${sha}:${ref}\t[new branch]`);
}

export async function restoreViaOwnerSSH(
  { number, sha, ref, verifyAbsent },
  { execute = exec, cwd = process.cwd(), env = process.env, inspectOnly = false } = {}
) {
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > 999999 ||
    !/^[a-f0-9]{40}$/.test(sha || "") ||
    !/^refs\/heads\/dependabot\/[A-Za-z0-9_./-]+$/.test(ref || "") ||
    ref.includes("..") ||
    ref.endsWith(".") ||
    ref.endsWith("/") ||
    ref.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock")) ||
    typeof verifyAbsent !== "function"
  )
    throw new Error("Invalid create-only SSH restoration target");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dependency-ref-"));
  try {
    const adapter = path.join(directory, "transport.mjs");
    await fs.writeFile(adapter, transport, { mode: 0o700 });
    const clean = isolatedGitEnvironment(env, adapter);
    const options = { cwd, env: clean, timeout: 60000, maxBuffer: 1024 * 1024 };
    const remoteResult = await execute(
      "git",
      ["remote", "get-url", "--push", "--all", "origin"],
      options
    );
    if (remoteResult.stdout.trim() !== remote)
      throw new Error("Existing owner SSH origin does not match");
    let authenticated = false;
    try {
      await execute(
        "/usr/bin/ssh",
        [
          "-F",
          "/dev/null",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ConnectTimeout=10",
          "-T",
          "git@github.com",
        ],
        { ...options, timeout: 20000, maxBuffer: 4096 }
      );
    } catch (error) {
      authenticated =
        error.code === 1 && `${error.stdout || ""}${error.stderr || ""}`.trim() === greeting;
    }
    if (!authenticated) throw new Error("Existing owner SSH identity did not verify");
    const bare = path.join(directory, "objects.git");
    const git = async (...args) =>
      execute(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "credential.helper=",
          "-c",
          "protocol.allow=never",
          "-c",
          "protocol.ssh.allow=always",
          "-c",
          "maintenance.auto=false",
          "-c",
          "gc.auto=0",
          ...args,
        ],
        options
      );
    await git("-c", "init.templateDir=", "init", "--bare", bare);
    const inBare = (...args) => git(`--git-dir=${bare}`, ...args);
    await inBare(
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      remote,
      `refs/pull/${number}/head`
    );
    const fetched = await inBare("rev-parse", "--verify", "FETCH_HEAD");
    const type = await inBare("cat-file", "-t", sha);
    const object = await inBare("cat-file", "commit", sha);
    const bytes = Buffer.from(object.stdout);
    const hash = createHash("sha1").update(`commit ${bytes.length}\0`).update(bytes).digest("hex");
    if (
      fetched.stdout.trim() !== sha ||
      type.stdout.trim() !== "commit" ||
      hash !== sha ||
      !/^gpgsig /m.test(object.stdout)
    )
      throw new Error("Fetched local signed commit does not match the verified PR head");
    await verifyAbsent(); // Repeat API owner/run/signature/metadata/scope/closure/base/ref guards.
    if (inspectOnly) return;
    // Empty expected value atomically requires absence. No '+' or general force is used.
    const result = await inBare(
      "push",
      "--porcelain",
      `--force-with-lease=${ref}:`,
      remote,
      `${sha}:${ref}`
    );
    if (!createdRefReceipt(result.stdout, sha, ref))
      throw new Error("SSH restoration did not create an absent ref; existing refs require review");
  } catch {
    // Never print transport output, local paths, keys, environment or credential-bearing logs.
    throw new Error("Guarded create-only owner SSH restoration failed");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
