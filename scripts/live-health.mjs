import fs from "node:fs/promises";
import tls from "node:tls";
import { publicHtmlFingerprint } from "./html.mjs";

const origin = "https://links.seeknay.com";
const now = Date.now();
let failures = 0;
async function check(name, run) {
  try {
    if (!(await run())) throw new Error("Check failed");
    console.log(`PASS: ${name}`);
  } catch {
    failures++;
    console.error(`REVIEW: ${name}`);
  }
}
async function get(pathname) {
  return fetch(`${origin}${pathname}`, {
    signal: AbortSignal.timeout(20000),
    headers: { "Cache-Control": "no-cache" },
    redirect: "manual",
  });
}
function headers(response) {
  return (
    response.headers.get("x-content-type-options") === "nosniff" &&
    response.headers.get("x-frame-options") === "DENY" &&
    response.headers.get("referrer-policy") === "strict-origin-when-cross-origin" &&
    /frame-ancestors\s+'none'/.test(response.headers.get("content-security-policy") || "")
  );
}
await check("HTTPS homepage matches this checkout and has security headers", async () => {
  const response = await get(`/?health=${now}`);
  const html = await response.text();
  return (
    response.status === 200 &&
    headers(response) &&
    publicHtmlFingerprint(html) ===
      publicHtmlFingerprint(await fs.readFile("index.html", "utf8")) &&
    !html.includes("static.cloudflareinsights.com/beacon")
  );
});
await check("HTTP redirects to HTTPS", async () => {
  const response = await fetch("http://links.seeknay.com/", {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  return [301, 308].includes(response.status) && response.headers.get("location") === `${origin}/`;
});
await check("Nested 404 has the saved error page and security headers", async () => {
  const response = await get(`/health-check-missing-${now}/nested/path`);
  return (
    response.status === 404 &&
    headers(response) &&
    (await response.text()) === (await fs.readFile("404.html", "utf8"))
  );
});
// Only literal public paths are sent over the network. Never derive request URLs from local files.
const resources = [
  "assets/links.json",
  "robots.txt",
  "sitemap.xml",
  "assets/og.png",
  "favicon.ico",
  "assets/favicon-32.png",
  "assets/favicon.svg",
  "css/styles.css",
  "js/ui.js",
  "js/analytics.js",
  "js/followers.js",
  "js/links.js",
  "assets/avatar-96.jpg",
  "assets/avatar-192.jpg",
];
for (const resource of resources) {
  await check(`Published resource matches this checkout: ${resource.split("?")[0]}`, async () => {
    const response = await get(`/${resource}`);
    const expected = await fs.readFile(resource.split("?")[0]);
    return response.status === 200 && Buffer.from(await response.arrayBuffer()).equals(expected);
  });
}
await check("All platform metrics have successful updates within 48 hours", async () => {
  const response = await get(`/assets/social-metrics.json?health=${now}`);
  const metrics = await response.json();
  return (
    response.status === 200 &&
    ["youtube", "instagram", "tiktok", "bluesky", "facebook"].every((network) => {
      const value = metrics[network];
      const age = now - Date.parse(value?.lastSuccessAt);
      return (
        Number.isSafeInteger(value?.count) &&
        value.count >= 0 &&
        !value.lastError &&
        Number.isFinite(age) &&
        age >= -5 * 60 * 1000 &&
        age <= 48 * 60 * 60 * 1000
      );
    })
  );
});
await check(
  "GitHub Pages origin certificate validates the custom hostname",
  () =>
    new Promise((resolve) => {
      // Connect directly to the public Pages origin while validating the custom-domain SNI.
      const socket = tls.connect({
        host: "pbuffolino.github.io",
        port: 443,
        servername: "links.seeknay.com",
        rejectUnauthorized: true,
      });
      socket.setTimeout(15000);
      socket.once("secureConnect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    })
);
process.exitCode = failures ? 1 : 0;
