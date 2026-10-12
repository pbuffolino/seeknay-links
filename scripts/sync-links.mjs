import fs from "node:fs/promises";

export function fallbackMarkup(links) {
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
    );
  return links
    .map(
      (
        link
      ) => `          <a class="link-button delay-${link.delay}" href="${escape(link.url)}" target="_blank" rel="noopener noreferrer" data-link-name="${escape(link.name)}">
            <span class="link-main">
              <i class="${escape(link.icon)} link-icon" aria-hidden="true"></i>
              <span class="link-info-group">
                <span class="link-label">${escape(link.name)}</span>${link.networkId ? `\n                <span class="link-followers" data-network="${escape(link.networkId)}"></span>` : ""}
              </span>
            </span>
            <i class="fa-solid fa-arrow-up-right-from-square link-arrow" aria-hidden="true"></i>
          </a>`
    )
    .join("\n");
}

const html = await fs.readFile("index.html", "utf8");
const links = JSON.parse(await fs.readFile("assets/links.json", "utf8"));
await fs.writeFile(
  "index.html",
  html.replace(
    /<!-- generated-links:start -->[\s\S]*?<!-- generated-links:end -->/,
    `<!-- generated-links:start -->\n${fallbackMarkup(links)}\n          <!-- generated-links:end -->`
  )
);
const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)[1];
const base = new URL(canonical);
const notFound = await fs.readFile("404.html", "utf8");
await fs.writeFile(
  "404.html",
  notFound
    .replace(/href="[^"]+assets\/favicon.svg"/, `href="${new URL("assets/favicon.svg", base)}"`)
    .replace(/href="[^"]+css\/styles.css"/, `href="${new URL("css/styles.css", base)}"`)
    .replace(/<a href="[^"]+">/, `<a href="${base}">`)
);
