import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" };
const port = Number(process.env.PORT || 3210);
createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
  let name;
  try { name = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400).end(); return; }
  if (name === "/") name = "/index.html";
  const target = path.resolve(root, `.${name}`);
  const relative = path.relative(root, target).replaceAll("\\", "/");
  const allowed = ["index.html", "style.css"].includes(relative) || /^(assets|src|node_modules\/opencc-js\/dist\/esm)\//.test(relative);
  if (!allowed || relative.startsWith("..") || !types[path.extname(target)]) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(target);
    response.writeHead(200, { "Content-Type": types[path.extname(target)], "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") console.error("Failed to serve a game asset:", error.code);
    response.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`Krillion Chinese: http://localhost:${port}`));
