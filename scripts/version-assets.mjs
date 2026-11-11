import fs from "node:fs/promises";
import { VERSIONED_ASSETS, assetHash } from "./html.mjs";

const hashes = await Promise.all(VERSIONED_ASSETS.map(assetHash));
for (const filename of ["index.html", "404.html"]) {
  let source = await fs.readFile(filename, "utf8");
  VERSIONED_ASSETS.forEach((asset, index) => {
    const pattern = new RegExp(
      `((?:href|src)="[^"]*${asset.replaceAll(".", "\\.")})(?:\\?v=[a-f0-9]+)?"`,
      "g"
    );
    source = source.replace(pattern, `$1?v=${hashes[index]}"`);
  });
  await fs.writeFile(filename, source);
}
