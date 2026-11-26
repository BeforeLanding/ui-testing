// Demo app for the ui-testing skill: a tiny reading list (SPA + JSON API, no deps).
// Usage: node server.mjs [port]   (state is in memory and resets on restart)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8790);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
let nextId = 4;
let books = [
  { id: 1, title: "The Pragmatic Programmer", author: "Hunt & Thomas", read: true },
  { id: 2, title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", read: false },
  { id: 3, title: "Refactoring", author: "Martin Fowler", read: false },
];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((ok) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok(null); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/books" && req.method === "GET") return json(res, 200, { books });
  if (url.pathname === "/api/books" && req.method === "POST") {
    const b = await body(req);
    if (!b || !String(b.title ?? "").trim()) return json(res, 400, { error: "Title is required" });
    const book = { id: nextId++, title: String(b.title).trim(), author: String(b.author ?? "").trim(), read: false };
    books.push(book);
    return json(res, 201, book);
  }
  const m = /^\/api\/books\/(\d+)$/.exec(url.pathname);
  if (m) {
    const book = books.find((b) => b.id === Number(m[1]));
    if (!book) return json(res, 404, { error: "Not found" });
    if (req.method === "PATCH") { Object.assign(book, { read: !!(await body(req))?.read }); return json(res, 200, book); }
    if (req.method === "DELETE") { books = books.filter((b) => b !== book); return json(res, 200, { ok: true }); }
    return json(res, 200, book);
  }
  const file = path.join(PUBLIC, path.normalize(url.pathname).replace(/^[/\\]+/, ""));
  if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(200, { "content-type": "text/html" });
  fs.createReadStream(path.join(PUBLIC, "index.html")).pipe(res); // SPA fallback
}).listen(PORT, "127.0.0.1", () => console.log(`demo on http://127.0.0.1:${PORT}`));
