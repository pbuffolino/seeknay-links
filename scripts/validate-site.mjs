import fs from "node:fs/promises";
import assert from "node:assert/strict";
import {
  elements,
  attributes,
  text,
  canonicalUrl,
  fallbackMarkup,
  publicHtmlFingerprint,
  GENERATED_LINKS,
  VERSIONED_ASSETS,
  assetHash,
} from "./html.mjs";
import { NETWORKS, validCount } from "./update-social-metrics.mjs";

const links = JSON.parse(await fs.readFile("assets/links.json", "utf8"));
assert(Array.isArray(links) && links.length > 0, "Links must be a nonempty array");
const html = await fs.readFile("index.html", "utf8");
for (const link of links) {
  assert(typeof link.name === "string" && link.name.trim() && link.name.length <= 100);
  const url = new URL(link.url);
  assert(["http:", "https:"].includes(url.protocol) && !url.username && !url.password);
  assert(/^(fa-brands|fa-solid) fa-[a-z-]+$/.test(link.icon));
  assert([0, 50, 100, 150, 200, 250].includes(link.delay));
  assert(link.networkId === null || NETWORKS.includes(link.networkId));
  await fs.access(`assets/icons/${link.icon.split(" fa-")[1]}.svg`);
}
assert.equal(
  publicHtmlFingerprint(html.match(GENERATED_LINKS)[0]),
  publicHtmlFingerprint(fallbackMarkup(links)),
  "Saved links must match links.json; run npm run sync-links"
);
const metrics = JSON.parse(await fs.readFile("assets/social-metrics.json", "utf8"));
for (const network of NETWORKS) {
  const metric = metrics[network];
  assert(validCount(metric?.count), `Invalid ${network} count`);
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
const canonical = canonicalUrl(html);
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

for (const asset of VERSIONED_ASSETS) {
  const hash = await assetHash(asset);
  assert(html.includes(`${asset}?v=${hash}`), `Run npm run version-assets after changing ${asset}`);
  if (!asset.startsWith("js/")) assert(notFound.includes(`${asset}?v=${hash}`));
}
