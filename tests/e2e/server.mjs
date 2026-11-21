/**
 * Tiny static file server for e2e tests (serves the repo root on a random port).
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Start the server.
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
export async function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || rel.startsWith("/node_modules/.")) throw new Error("outside");
      if (!(await stat(file)).isFile()) throw new Error("not a file");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
