// Response bodies and arbitrary headers are untrusted and must never reach logs.
export function parseGitHubResponse(stdout = "") {
  const match = stdout.match(/^HTTP\/\S+ (\d{3})[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Missing GitHub response headers");
  const headers = new Map();
  for (const line of match[2].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator > 0)
      headers.set(line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim());
  }
  return {
    status: Number(match[1]),
    headers,
    data: match[3].trim() ? JSON.parse(match[3]) : null,
  };
}

export function safeGitHubFailure(args, response) {
  const endpoint = args.find((arg) => /^repos\//.test(arg)) || "";
  const methodIndex = args.indexOf("--method");
  const method = methodIndex >= 0 ? args[methodIndex + 1] : "GET";
  const operations = [
    [/^repos\/[^/]+\/[^/]+\/git\/refs$/, "git-refs"],
    [/^repos\/[^/]+\/[^/]+\/git\/ref\//, "git-ref"],
    [/^repos\/[^/]+\/[^/]+\/branches\/main$/, "main-branch"],
    [/^repos\/[^/]+\/[^/]+\/compare\//, "compare"],
    [/^repos\/[^/]+\/[^/]+\/pulls\/\d+\/files\?/, "pr-files"],
    [/^repos\/[^/]+\/[^/]+\/pulls\/\d+\/commits\?/, "pr-commits"],
    [/^repos\/[^/]+\/[^/]+\/pulls\/\d+$/, "pr"],
    [/^repos\/[^/]+\/[^/]+\/issues\/\d+\/events\?/, "pr-events"],
  ];
  const diagnostic = {
    operation: operations.find(([pattern]) => pattern.test(endpoint))?.[1] || "other",
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : "other",
    classification: "unclassified",
  };
  const message = response?.data?.message;
  if (response?.headers.get("x-ratelimit-remaining") === "0")
    diagnostic.classification = "primary-rate-limit";
  else if (typeof message === "string" && /secondary rate limit/i.test(message))
    diagnostic.classification = "secondary-rate-limit";
  else if (typeof message === "string" && /API rate limit exceeded/i.test(message))
    diagnostic.classification = "rate-limit";
  else if (typeof message === "string" && /Resource not accessible by integration/i.test(message))
    diagnostic.classification = "integration-permission";
  else if (
    typeof message === "string" &&
    /workflows permission|workflow.*without.*workflow/i.test(message)
  )
    diagnostic.classification = "workflow-permission";
  for (const name of [
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-used",
    "x-ratelimit-reset",
    "retry-after",
  ]) {
    const value = response?.headers.get(name);
    if (/^\d{1,12}$/.test(value || "")) diagnostic[name] = Number(value);
  }
  const resource = response?.headers.get("x-ratelimit-resource");
  if (["core", "search", "graphql", "code_search", "integration_manifest"].includes(resource))
    diagnostic["x-ratelimit-resource"] = resource;
  const permissions = response?.headers.get("x-accepted-github-permissions");
  if (
    permissions &&
    /^(?:(?:contents|workflows|pull_requests|actions|metadata|security_events)=(?:read|write))(?:[,;] ?(?:contents|workflows|pull_requests|actions|metadata|security_events)=(?:read|write))*$/.test(
      permissions
    )
  )
    diagnostic["x-accepted-github-permissions"] = permissions;
  return diagnostic;
}
