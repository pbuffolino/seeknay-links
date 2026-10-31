import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

test("ESLint glob discovery still checks nested modules and honors local-only ignores", async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "eslint-globs-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const fixtures = {
    "root.js": "console.log(missingRoot);\n",
    "nested/deeper/module.mjs": "console.log(missingModule);\n",
    "nested/.hidden.js": "console.log(missingHidden);\n",
    ".worktrees/other/broken.js": "this is not JavaScript\n",
    ".claude/broken.mjs": "this is not JavaScript\n",
  };
  for (const [name, source] of Object.entries(fixtures)) {
    await fs.mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
    await fs.writeFile(path.join(cwd, name), source);
  }
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: fileURLToPath(new URL("../eslint.config.mjs", import.meta.url)),
  });
  // Exercise CLI glob traversal as well as config-array file and ignore matching.
  const results = await eslint.lintFiles(["**/*.{js,mjs}"]);
  assert.deepEqual(
    results.map((result) => path.relative(cwd, result.filePath).split(path.sep).join("/")).sort(),
    ["nested/.hidden.js", "nested/deeper/module.mjs", "root.js"]
  );
  for (const result of results) {
    assert.equal(result.errorCount, 1, result.filePath);
    assert.equal(result.messages[0].ruleId, "no-undef", result.filePath);
  }
});
