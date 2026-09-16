import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GroqProvider } from "./core/groq-provider.js";
import { MissionRuntime } from "./core/mission-runtime-v2.js";
import { ToolRegistry } from "./core/tool-registry.js";
import { workspaceExecute, workspaceInspect, workspaceReadFile, workspaceVerify, workspaceWriteFile } from "./tools/builtin.js";

const tools = new ToolRegistry();
for (const tool of [workspaceInspect, workspaceReadFile, workspaceExecute, workspaceVerify, workspaceWriteFile]) tools.register(tool);
const provider = process.env.ASHAI_API_KEY ? new GroqProvider() : undefined;
const runtime = new MissionRuntime(tools, provider);
const port = Number(process.env.PORT ?? 8787);

const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body)); };
const body = async (req: import("node:http").IncomingMessage) => { let text = ""; for await (const chunk of req) text += chunk; return text ? JSON.parse(text) as Record<string, unknown> : {}; };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(resolve(process.cwd(), "web/index.html"), "utf8"); res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html);
    }
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, provider: Boolean(provider), version: "0.2.0" });
    if (req.method === "GET" && url.pathname === "/api/missions") return json(res, 200, await runtime.listMissions());
    const match = url.pathname.match(/^\/api\/missions\/([^/]+)(?:\/(events|approve|retry))?$/);
    if (match) {
      const id = match[1]; const action = match[2];
      if (req.method === "GET" && !action) return json(res, 200, { mission: await runtime.hydrate(id), events: runtime.getEvents(id) });
      if (req.method === "POST" && action === "approve") { await runtime.approve(id); return json(res, 200, await runtime.run(id)); }
      if (req.method === "POST" && action === "retry") return json(res, 200, await runtime.retry(id, process.env.ASHAI_WORKSPACE ?? process.cwd()));
      if (req.method === "GET" && action === "events") return json(res, 200, runtime.getEvents(id));
    }
    if (req.method === "POST" && url.pathname === "/api/missions") {
      const input = await body(req); const mission = await runtime.createMission(String(input.goal ?? ""));
      if (input.autoRun !== false) await runtime.run(mission.id, typeof input.workspace === "string" ? input.workspace : process.env.ASHAI_WORKSPACE ?? process.cwd());
      return json(res, 201, { mission: await runtime.hydrate(mission.id), events: runtime.getEvents(mission.id) });
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, () => console.log(`AshAI control plane: http://localhost:${port}`));
