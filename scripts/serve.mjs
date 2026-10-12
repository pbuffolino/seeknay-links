import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};
http
  .createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const filename = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
      if (!filename.startsWith(root + path.sep) || /(?:^|\/)\./.test(pathname))
        throw new Error("Invalid path");
      const allowed =
        /^(?:\/index.html|\/404.html|\/css\/[\w.-]+|\/js\/[\w.-]+|\/assets\/(?:icons\/)?[\w.-]+)$/;
      if (!allowed.test(pathname === "/" ? "/index.html" : pathname)) throw new Error("Not public");
      const data = await fs.readFile(filename);
      response.writeHead(200, {
        "Content-Type": types[path.extname(filename)] || "application/octet-stream",
      });
      response.end(data);
    } catch {
      response.writeHead(404, { "Content-Type": "text/html" });
      response.end(await fs.readFile("404.html"));
    }
  })
  .listen(Number(process.env.PORT || 4173), "127.0.0.1", () =>
    console.log("Serving http://127.0.0.1:" + (process.env.PORT || 4173))
  );
