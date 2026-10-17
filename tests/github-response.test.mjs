import { test } from "node:test";
import assert from "node:assert/strict";
import { createGitHubRequest, githubRequest } from "../scripts/merge-dependabot.mjs";
import { parseGitHubResponse, safeGitHubFailure } from "../scripts/github-response.mjs";

const args = [
  "api",
  "--method",
  "POST",
  "repos/example/public/git/refs",
  "-f",
  "sha=private-sentinel",
];
function response(message, headers = "") {
  return `HTTP/2.0 403 Forbidden\r\n${headers}X-Private: private-sentinel\r\n\r\n${JSON.stringify({ message, token: "private-sentinel" })}`;
}
test("response parser accepts JSON and empty native API responses", () => {
  assert.deepEqual(parseGitHubResponse('HTTP/2.0 200 OK\nX-Test: ignored\n\n{"ok":true}').data, {
    ok: true,
  });
  assert.equal(
    parseGitHubResponse("HTTP/2.0 204 No Content\r\nX-Test: ignored\r\n\r\n").data,
    null
  );
});
test("403 diagnostics distinguish primary, secondary, integration and unknown errors without leaking data", () => {
  for (const [message, headers, classification] of [
    ["private-sentinel", "X-RateLimit-Remaining: 0\r\n", "primary-rate-limit"],
    [
      "You exceeded a secondary rate limit private-sentinel",
      "Retry-After: 60\r\n",
      "secondary-rate-limit",
    ],
    [
      "Resource not accessible by integration private-sentinel",
      "X-RateLimit-Remaining: 4999\r\n",
      "integration-permission",
    ],
    ["private-sentinel", "Retry-After: private-sentinel\r\n", "unclassified"],
  ]) {
    const diagnostic = safeGitHubFailure(args, parseGitHubResponse(response(message, headers)));
    assert.equal(diagnostic.classification, classification);
    assert.equal(diagnostic.operation, "git-refs");
    assert.equal(diagnostic.method, "POST");
    assert(!JSON.stringify(diagnostic).includes("private-sentinel"));
  }
});
test("request wrapper preserves HTTP status and safe diagnostics, never response content", async () => {
  const request = createGitHubRequest(async (binary, argv) => {
    assert.equal(binary, "gh");
    assert.equal(argv[1], "--include");
    const failure = new Error("private-sentinel");
    failure.stdout = response(
      "Resource not accessible by integration",
      "X-RateLimit-Remaining: 4371\r\nX-RateLimit-Reset: 1792200000\r\n"
    );
    failure.stderr = "private-sentinel HTTP 403";
    throw failure;
  });
  await assert.rejects(request(...args), (error) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /integration-permission/);
    assert.match(error.message, /4371/);
    assert(!error.message.includes("private-sentinel"));
    return true;
  });
});
test("request wrapper parses successful and empty responses and fails closed on malformed output", async () => {
  for (const [stdout, expected] of [
    ['HTTP/2.0 200 OK\nX-Test: ignored\n\n{"ok":true}', { ok: true }],
    ["HTTP/2.0 204 No Content\nX-Test: ignored\n\n", null],
  ]) {
    assert.deepEqual(await createGitHubRequest(async () => ({ stdout }))("api", "user"), expected);
  }
  await assert.rejects(
    createGitHubRequest(async () => ({ stdout: "private-sentinel" }))("api", "user"),
    (error) => !error.message.includes("private-sentinel")
  );
});
// Live read-only CLI protocol proof is performed separately, never a network-dependent unit test.
assert.equal(typeof githubRequest, "function");
