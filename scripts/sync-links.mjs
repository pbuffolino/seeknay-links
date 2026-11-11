import fs from "node:fs/promises";
import { GENERATED_LINKS, canonicalUrl, fallbackMarkup } from "./html.mjs";

const html = await fs.readFile("index.html", "utf8");
const links = JSON.parse(await fs.readFile("assets/links.json", "utf8"));
await fs.writeFile(
  "index.html",
  html.replace(
    GENERATED_LINKS,
    `<!-- generated-links:start -->\n${fallbackMarkup(links)}\n          <!-- generated-links:end -->`
  )
);
const base = new URL(canonicalUrl(html));
const notFound = await fs.readFile("404.html", "utf8");
await fs.writeFile(
  "404.html",
  notFound
    .replace(/href="[^"]+assets\/favicon.svg"/, `href="${new URL("assets/favicon.svg", base)}"`)
    .replace(
      /href="[^"]+css\/styles.css(?:\?v=[a-f0-9]+)?"/,
      `href="${new URL("css/styles.css", base)}"`
    )
    .replace(/<a href="[^"]+">/, `<a href="${base}">`)
);
