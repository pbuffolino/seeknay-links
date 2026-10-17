import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  restoreViaOwnerSSH,
  isolatedGitEnvironment,
  createdRefReceipt,
} from "../scripts/owner-ssh-ref.mjs";

const remote = "git@github.com:pbuffolino/seeknay-links.git",
  ref = "refs/heads/dependabot/npm_and_yarn/example-1.1.0";
const object =
  "tree " +
  "a".repeat(40) +
  "\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\ngpgsig signed-fixture\n continuation\n\nFixture\n";
const sha = createHash("sha1")
  .update(`commit ${Buffer.byteLength(object)}\0`)
  .update(object)
  .digest("hex");
function fixture() {
  const calls = [],
    flags = {};
  let verified = 0;
  const target = {
    number: 7,
    sha,
    ref,
    verifyAbsent: async () => {
      verified++;
      if (flags.changedBeforePush) throw new Error("changed private-sentinel");
    },
  };
  const execute = async (binary, args, options) => {
    calls.push({ binary, args, options });
    assert(!options.env.GH_TOKEN);
    assert(!options.env.GIT_SSH_COMMAND);
    assert.equal(options.env.GIT_CONFIG_GLOBAL, "/dev/null");
    if (binary === "/usr/bin/ssh") {
      assert(args.includes("BatchMode=yes"));
      assert(args.includes("StrictHostKeyChecking=yes"));
      assert(args.includes("/dev/null"));
      throw Object.assign(new Error("private-sentinel"), {
        code: 1,
        stderr: flags.wrongOwner
          ? "Hi other-owner!"
          : "Hi pbuffolino! You've successfully authenticated, but GitHub does not provide shell access.\n",
      });
    }
    assert.equal(binary, "git");
    if (args[0] === "remote")
      return {
        stdout: flags.wrongRemote ? "https://github.com/example/other.git\n" : remote + "\n",
      };
    assert(args.includes("core.hooksPath=/dev/null"));
    assert(args.includes("credential.helper="));
    assert(args.includes("protocol.allow=never"));
    assert(args.includes("protocol.ssh.allow=always"));
    const adapter = await fs.readFile(options.env.GIT_SSH, "utf8");
    assert(adapter.includes('spawnSync("/usr/bin/ssh"'));
    assert(!adapter.includes("/bin/sh"));
    if (args.includes("rev-parse"))
      return { stdout: (flags.changedHead ? "b".repeat(40) : sha) + "\n" };
    if (args.includes("cat-file"))
      return {
        stdout: args.includes("-t")
          ? flags.wrongType
            ? "blob\n"
            : "commit\n"
          : flags.changedObject
            ? object + "bad"
            : object,
      };
    if (args.includes("push")) {
      assert.equal(verified, 1);
      assert(args.includes(`--force-with-lease=${ref}:`));
      assert(args.includes(`${sha}:${ref}`));
      assert(args.includes(remote));
      assert(!args.includes("--force"));
      assert(!args.some((a) => a.startsWith("+")));
      if (flags.concurrentChanged) throw new Error("rejected private-sentinel");
      return {
        stdout: `To ${remote}\n${flags.concurrentSame ? "=" : "*"}\t${sha}:${ref}\t${flags.concurrentSame ? "[up to date]" : "[new branch]"}\nDone\n`,
      };
    }
    return { stdout: "" };
  };
  return {
    calls,
    flags,
    target,
    options: {
      execute,
      env: { ...process.env, GH_TOKEN: "private-sentinel", GIT_SSH_COMMAND: "private-sentinel" },
    },
    verified: () => verified,
  };
}
test("SSH restoration uses fixed owner/remote, isolated bare data fetch and an exact empty lease", async () => {
  const f = fixture();
  await restoreViaOwnerSSH(f.target, f.options);
  assert.equal(f.calls.filter((c) => c.args.includes("push")).length, 1);
  assert(f.calls.some((c) => c.args.includes("refs/pull/7/head")));
  assert(!f.calls.some((c) => c.args.includes("checkout")));
});
test("remote, SSH identity, signed object, changed head and last guard failures never push", async () => {
  for (const key of [
    "wrongRemote",
    "wrongOwner",
    "wrongType",
    "changedObject",
    "changedHead",
    "changedBeforePush",
  ]) {
    const f = fixture();
    f.flags[key] = true;
    await assert.rejects(
      restoreViaOwnerSSH(f.target, f.options),
      (e) => !e.message.includes("private-sentinel")
    );
    assert(!f.calls.some((c) => c.args.includes("push")));
  }
});
test("concurrent changed or identical existing references are never accepted as a creation", async () => {
  for (const key of ["concurrentChanged", "concurrentSame"]) {
    const f = fixture();
    f.flags[key] = true;
    await assert.rejects(
      restoreViaOwnerSSH(f.target, f.options),
      (e) => !e.message.includes("private-sentinel")
    );
  }
});
test("read-only SSH object preflight never pushes and removes its temporary repository", async () => {
  const f = fixture();
  await restoreViaOwnerSSH(f.target, { ...f.options, inspectOnly: true });
  assert(!f.calls.some((c) => c.args.includes("push")));
  const adapter = f.calls[0].options.env.GIT_SSH;
  await assert.rejects(fs.stat(adapter), { code: "ENOENT" });
});
test("SSH environment removes Git overrides, token/log helpers and Node preloads without changing existing agent authentication", () => {
  const env = isolatedGitEnvironment(
    {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "private",
      GIT_DIR: "private",
      GIT_SSH_COMMAND: "private",
      GIT_TRACE: "private",
      GH_TOKEN: "private",
      GITHUB_TOKEN: "private",
      NODE_OPTIONS: "private",
      SSH_AUTH_SOCK: "existing-agent",
    },
    "/fixed/adapter"
  );
  assert.equal(env.SSH_AUTH_SOCK, "existing-agent");
  assert.equal(env.GIT_SSH, "/fixed/adapter");
  for (const key of [
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_DIR",
    "GIT_SSH_COMMAND",
    "GIT_TRACE",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "NODE_OPTIONS",
  ])
    assert(!env[key]);
});
test("invalid or non-bot refs and missing guard callbacks never invoke a subprocess", async () => {
  const f = fixture();
  for (const change of [
    { ref: "refs/heads/main" },
    { ref: "refs/heads/dependabot/../main" },
    { ref: "refs/heads/dependabot/branch.lock" },
    { sha: "not-a-sha" },
    { verifyAbsent: null },
  ])
    await assert.rejects(restoreViaOwnerSSH({ ...f.target, ...change }, f.options));
  assert.equal(f.calls.length, 0);
});
test("real Git porcelain proves empty-expected leases create absent refs and reject concurrently existing refs", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dependency-lease-test-"));
  try {
    const source = path.join(directory, "source.git"),
      destination = path.join(directory, "remote.git");
    const env = isolatedGitEnvironment(process.env, "/unused");
    const run = (args, input) =>
      execFileSync(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "credential.helper=",
          "-c",
          "init.templateDir=",
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          ...args,
        ],
        { env, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }
      );
    run(["init", "--bare", source]);
    run(["init", "--bare", destination]);
    const tree = run([`--git-dir=${source}`, "mktree"], "").trim();
    const first = run([`--git-dir=${source}`, "commit-tree", tree], "First\n").trim();
    const second = run(
      [`--git-dir=${source}`, "commit-tree", tree, "-p", first],
      "Second\n"
    ).trim();
    const push = () =>
      run([
        `--git-dir=${source}`,
        "push",
        "--porcelain",
        `--force-with-lease=${ref}:`,
        destination,
        `${first}:${ref}`,
      ]);
    assert(createdRefReceipt(push(), first, ref));
    assert(!createdRefReceipt(push(), first, ref)); // Git can report an identical ref as up to date.
    // Even an ordinary fast-forward must fail when the expected destination is absent.
    assert.throws(() =>
      run([
        `--git-dir=${source}`,
        "push",
        "--porcelain",
        `--force-with-lease=${ref}:`,
        destination,
        `${second}:${ref}`,
      ])
    );
    assert.equal(run([`--git-dir=${destination}`, "rev-parse", ref]).trim(), first);
    run([`--git-dir=${source}`, "push", destination, `${second}:${ref}`]);
    assert.throws(push);
    assert.equal(run([`--git-dir=${destination}`, "rev-parse", ref]).trim(), second);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
