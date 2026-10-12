import fs from "node:fs/promises";
import { createHash } from "node:crypto";

const paths = [
  "css/styles.css",
  "js/ui.js",
  "js/analytics.js",
  "js/followers.js",
  "js/links.js",
  "favicon.ico",
  "assets/favicon-32.png",
  "assets/favicon.svg",
];
for (const filename of ["index.html", "404.html"]) {
  let source = await fs.readFile(filename, "utf8");
  for (const asset of paths) {
    const hash = createHash("sha256")
      .update(await fs.readFile(asset))
      .digest("hex")
      .slice(0, 12);
    const pattern = new RegExp(
      `((?:href|src)="[^"]*${asset.replaceAll(".", "\\.")})(?:\\?v=[a-f0-9]+)?"`,
      "g"
    );
    source = source.replace(pattern, `$1?v=${hash}"`);
  }
  await fs.writeFile(filename, source);
}
