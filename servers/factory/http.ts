import { createServer, type Server, type IncomingMessage } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { appHtmlPath } from "./paths.js";
import type { FactoryService } from "./service.js";
import { clean } from "./service.js";

export interface Dashboard {
  server: Server;
  origin: string;
  url: () => string;
  close: () => Promise<void>;
}
export async function startDashboard(
  service: FactoryService,
  port = 0,
): Promise<Dashboard> {
  const handoffs = new Map<string, number>(),
    sessions = new Map<string, number>();
  let origin = "";
  let cookieName = "";
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  const prune = () => {
    for (const map of [handoffs, sessions])
      for (const [key, expiry] of map) if (expiry < Date.now()) map.delete(key);
  };
  const authenticated = (req: IncomingMessage) => {
    const value = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    return !!value && (sessions.get(digest(value)) ?? 0) > Date.now();
  };
  const body = async (req: IncomingMessage) => {
    req.setEncoding("utf8");
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 400000)
        throw new Error("Request body too large.");
    }
    return JSON.parse(text);
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      prune();
      if (req.headers.host !== new URL(origin).host)
        return json(403, { error: "Invalid Host." });
      if (req.headers.origin && req.headers.origin !== origin)
        return json(403, { error: "Invalid Origin." });
      const url = new URL(req.url ?? "/", origin);
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(await readFile(appHtmlPath, "utf8"));
        return;
      }
      if (req.method === "GET" && url.pathname === "/health")
        return json(200, { status: "ok", version: "1.0.0" });
      if (req.method === "POST" && url.pathname === "/api/session") {
        if (req.headers.origin !== origin)
          return json(403, { error: "Origin required." });
        const data = await body(req);
        const token = typeof data.token === "string" ? data.token : "";
        const key = digest(token);
        const expiry = handoffs.get(key);
        handoffs.delete(key);
        if (!expiry || expiry < Date.now())
          return json(401, {
            error: "Session link expired. Open a fresh link from Iron Legion.",
          });
        const session = randomBytes(32).toString("base64url");
        sessions.set(digest(session), Date.now() + 8 * 3600000);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        return json(200, { ok: true });
      }
      if (!authenticated(req))
        return json(401, {
          error:
            "Open the dashboard link printed by the server or use factory__open in your MCP host.",
        });
      if (req.method === "GET" && url.pathname === "/api/snapshot")
        return json(
          200,
          service.snapshot(url.searchParams.get("release") || undefined),
        );
      if (req.method === "GET" && url.pathname === "/api/artifact")
        return json(
          200,
          service.store.artifact(url.searchParams.get("id") ?? ""),
        );
      if (req.method === "POST" && url.pathname === "/api/control") {
        if (
          req.headers.origin !== origin ||
          !req.headers["content-type"]?.startsWith("application/json")
        )
          return json(403, { error: "JSON and same-origin request required." });
        return json(200, await service.control(await body(req)));
      }
      return json(404, { error: "Not found." });
    } catch (e) {
      return json(400, {
        error: clean(e instanceof Error ? e.message : String(e)),
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Dashboard failed to bind.");
  origin = `http://127.0.0.1:${address.port}`;
  cookieName = `iron_legion_${address.port}`;
  return {
    server,
    origin,
    url: () => {
      prune();
      const token = randomBytes(32).toString("base64url");
      handoffs.set(digest(token), Date.now() + 60000);
      return `${origin}/#session=${token}`;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
