/**
 * Tiny static file server for e2e tests (serves the repo root on a random port).
 */
import http from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../../scripts/gen-sw-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/** `sw-assets.js` is generated and git-ignored: make sure a current copy exists (written only when it differs, so parallel test files do not race). */
async function ensureSwAssets() {
  const file = path.join(ROOT, "sw-assets.js");
  const want = render();
  const have = await readFile(file, "utf8").catch(() => null);
  if (have !== want) await writeFile(file, want);
}

/**
 * Start the server.
 * @param {{overrides?: Record<string, string>, root?: string, prefix?: string, cacheControl?: string}} [o] `root` is the directory served (default: the repo root; the site test serves `_site/`).
 *   `overrides` maps a path relative to the site (`/sw-assets.js`) to a body served instead of the file; mutable while running.
 *   `prefix` serves the site under a sub-path (`/pocket-sky`, like GitHub Pages); everything outside it is a 404.
 *   `cacheControl` is the response header (default `no-store`; the deploy tests use `max-age=600` like Pages).
 * @returns {Promise<{url: string, close: () => Promise<void>}>} `url` ends with `/` and includes the prefix.
 */
export async function startServer({ overrides = {}, root = ROOT, prefix = "", cacheControl = "no-store" } = {}) {
  if (root === ROOT) await ensureSwAssets();
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (prefix) {
        if (rel !== prefix && !rel.startsWith(`${prefix}/`)) throw new Error("outside the prefix");
        rel = rel.slice(prefix.length) || "/";
      }
      if (rel.endsWith("/")) rel += "index.html";
      if (Object.hasOwn(overrides, rel)) {
        res.writeHead(200, { "content-type": TYPES[path.extname(rel)] ?? "application/octet-stream", "cache-control": cacheControl });
        return res.end(overrides[rel]);
      }
      const file = path.join(root, rel);
      if (!file.startsWith(root + path.sep) || rel.startsWith("/node_modules/.")) throw new Error("outside");
      if (!(await stat(file)).isFile()) throw new Error("not a file");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": cacheControl });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { "content-type": "text/plain", "cache-control": cacheControl });
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}${prefix}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
