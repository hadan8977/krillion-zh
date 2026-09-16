import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real Postgres and real HTTP handlers; only Supabase's REST transport is replaced.
export async function cloudFixture() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../../supabase/schema.sql", import.meta.url), "utf8"));
  const originalFetch = globalThis.fetch;
  const settings = { SUPABASE_URL: "https://database.invalid", SUPABASE_SECRET_KEY: "sb_secret_test_fixture", CRON_SECRET: "test-only-secret-with-at-least-32-characters" };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.origin !== settings.SUPABASE_URL) return originalFetch(input, options);
    if (options.headers.apikey !== settings.SUPABASE_SECRET_KEY) return new Response("Unauthorized", { status: 401 });
    const resource = url.pathname.replace("/rest/v1/", ""), body = options.body ? JSON.parse(options.body) : null;
    try {
      const result = await db.transaction(async tx => {
        await tx.exec("set local role service_role");
        if (/^rpc\/kr_[a-z_]+$/.test(resource)) {
          const name = resource.slice(4), keys = Object.keys(body);
          if (!keys.every(key => /^p_[a-z_]+$/.test(key))) throw new Error("Invalid RPC argument");
          return (await tx.query(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) as result`, Object.values(body))).rows[0].result;
        }
        if (["kr_banks", "kr_channels"].includes(resource) && options.method === "GET") {
          const key = resource === "kr_banks" ? "version" : "base_version", select = url.searchParams.get("select");
          if (!["body", "current_version", "refreshed_on"].includes(select)) throw new Error("Invalid projection");
          return (await tx.query(`select ${select} from public.${resource} where ${key}=$1`, [url.searchParams.get(key).slice(3)])).rows;
        }
        if (resource === "kr_sessions" && options.method === "POST") {
          await tx.query("insert into public.kr_sessions(id,visitor_id,base_version,bank_version) values($1,$2,$3,$4)", [body.id, body.visitor_id, body.base_version, body.bank_version]);
          return null;
        }
        throw new Error("Unexpected storage route: " + resource);
      });
      return Response.json(result);
    } catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
  };
  const routes = new Map(await Promise.all(["bank", "session", "events", "feedback", "review", "refresh"].map(async name => [`/api/${name}`, (await import(`../../api/${name}.js`)).default])));
  const root = new URL("../../", import.meta.url);
  const types = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", webp: "image/webp", woff2: "font/woff2" };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (routes.has(pathname)) return routes.get(pathname)(req, res);
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!["index.html", "style.css"].includes(relative) && !/^(src|vendor|assets)\/[\w./-]+$/.test(relative)) { res.writeHead(404).end(); return; }
    try {
      const content = await readFile(new URL(relative, root));
      res.writeHead(200, { "Content-Type": types[relative.split(".").at(-1)] || "application/octet-stream" }).end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    db, url: `http://127.0.0.1:${server.address().port}`, secret: settings.CRON_SECRET,
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await db.close();
    },
  };
}
