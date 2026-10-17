import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { elements, attributes, text } from "./html.mjs";

const links = JSON.parse(await fs.readFile("assets/links.json", "utf8"));
const networks = ["tiktok", "youtube", "instagram", "bluesky", "facebook"];
assert(Array.isArray(links) && links.length > 0, "Links must be a nonempty array");
const html = await fs.readFile("index.html", "utf8");
const nav = html.match(/<nav[^>]+id="links-container"[\s\S]*?<\/nav>/)[0];
const savedLinks = [...nav.matchAll(/<a\b([\s\S]*?)>/g)].map((match) => match[1]);
assert.equal(savedLinks.length, links.length, "Run npm run sync-links after editing links.json");
for (const [index, link] of links.entries()) {
  assert(typeof link.name === "string" && link.name.trim() && link.name.length <= 100);
  const url = new URL(link.url);
  assert(["http:", "https:"].includes(url.protocol) && !url.username && !url.password);
  assert(/^(fa-brands|fa-solid) fa-[a-z-]+$/.test(link.icon));
  assert([0, 50, 100, 150, 200, 250].includes(link.delay));
  assert(link.networkId === null || networks.includes(link.networkId));
  const escape = (value) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/'/g, "&#39;");
  assert(
    savedLinks[index].includes(`href="${escape(link.url)}"`) &&
      savedLinks[index].includes(`data-link-name="${escape(link.name)}"`) &&
      savedLinks[index].includes(`delay-${link.delay}`),
    "Saved links must match links.json"
  );
  await fs.access(`assets/icons/${link.icon.split(" fa-")[1]}.svg`);
}
const metrics = JSON.parse(await fs.readFile("assets/social-metrics.json", "utf8"));
for (const network of networks) {
  const metric = metrics[network];
  assert(Number.isSafeInteger(metric?.count) && metric.count >= 0, `Invalid ${network} count`);
  assert(Number.isFinite(Date.parse(metric.lastSuccessAt)), `Missing ${network} freshness`);
}
for (const filename of ["index.html", "404.html"]) {
  const source = await fs.readFile(filename, "utf8");
  for (const element of elements(source)) {
    const attrs = attributes(element);
    assert(
      !Object.keys(attrs).some((name) => name === "style" || name.startsWith("on")),
      "Inline styles and event handlers are forbidden"
    );
    if (element.tagName === "script") {
      assert(
        attrs.src || attrs.type === "application/ld+json",
        "Executable scripts must be external"
      );
      if (!attrs.src) JSON.parse(text(element));
    }
  }
}
const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)[1];
const notFound = await fs.readFile("404.html", "utf8");
for (const filename of [
  "index.html",
  "404.html",
  "assets/links.json",
  "assets/og.svg",
  "js/ui.js",
]) {
  const source = await fs.readFile(filename, "utf8");
  assert(
    [...source.matchAll(/seeknay/gi)].every((match) => match[0] === "seeknay"),
    `Brand spelling must be lowercase in ${filename}`
  );
}
assert(!/http-equiv="refresh"/.test(notFound), "404 must not auto-redirect");
assert(notFound.includes(new URL("css/styles.css", canonical).href));
assert(notFound.includes(new URL("assets/favicon.svg", canonical).href));
const image = await fs.readFile("assets/og.png");
assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);
assert(image.length > 10000, "Social preview must contain real artwork");
console.log("Site data, saved navigation, CSP markup, 404 assets, and social preview validated");

for (const asset of [
  "css/styles.css",
  "js/ui.js",
  "js/analytics.js",
  "js/followers.js",
  "js/links.js",
  "favicon.ico",
  "assets/favicon-32.png",
  "assets/favicon.svg",
]) {
  const hash = createHash("sha256")
    .update(await fs.readFile(asset))
    .digest("hex")
    .slice(0, 12);
  assert(html.includes(`${asset}?v=${hash}`), `Run npm run version-assets after changing ${asset}`);
  if (!asset.startsWith("js/")) assert(notFound.includes(`${asset}?v=${hash}`));
}
