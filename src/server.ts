import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GroqProvider } from "./core/groq-provider.js";
import { MissionRuntime } from "./core/mission-runtime-v2.js";
import { ArtifactStore } from "./core/artifact-store.js";
import { ToolRegistry } from "./core/tool-registry.js";
import { workspaceExecute, workspaceFindFiles, workspaceInspect, workspaceReadFile, workspaceSearch, workspaceVerify, workspaceWriteFile } from "./tools/builtin.js";

const tools = new ToolRegistry();
for (const tool of [workspaceInspect, workspaceFindFiles, workspaceSearch, workspaceReadFile, workspaceExecute, workspaceVerify, workspaceWriteFile]) tools.register(tool);
const provider = process.env.ASHAI_API_KEY ? new GroqProvider() : undefined;
const runtime = new MissionRuntime(tools, provider);
const artifacts = new ArtifactStore();
const port = Number(process.env.PORT ?? 8787);
const workspaceDefault = process.env.ASHAI_WORKSPACE ?? process.cwd();

const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const body = async (req: import("node:http").IncomingMessage) => { let text = ""; for await (const chunk of req) { text += chunk; if (text.length > 1_000_000) throw new Error("Request body too large."); } return text ? JSON.parse(text) as Record<string, unknown> : {}; };

const responseFor = async (id: string) => ({ mission: await runtime.hydrate(id), events: runtime.getEvents(id) });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
    if (req.method === "GET" && url.pathname === "/") { const html = await readFile(resolve(process.cwd(), "web/index.html"), "utf8"); res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html); }
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, provider: Boolean(provider), model: process.env.ASHAI_MODEL ?? "openai/gpt-oss-20b", agentLoop: process.env.ASHAI_AGENT_LOOP !== "false", version: "0.3.0" });
    if (req.method === "GET" && url.pathname === "/api/tools") return json(res, 200, tools.list());
    if (req.method === "GET" && url.pathname === "/api/missions") return json(res, 200, await runtime.listMissions());

    const match = url.pathname.match(/^\/api\/missions\/([^/]+)(?:\/(events|approve|retry))?$/);
    if (match) {
      const id = decodeURIComponent(match[1] ?? ""); const action = match[2];
      if (!id) return json(res, 400, { error: "Mission id is required" });
      if (req.method === "GET" && !action) return json(res, 200, await responseFor(id));
      if (req.method === "GET" && action === "events") return json(res, 200, runtime.getEvents(id));
      if (req.method === "POST" && action === "approve") { await runtime.approve(id); const mission = await runtime.run(id, workspaceDefault); return json(res, 200, { ...(await responseFor(id)), mission, resumed: true }); }
      if (req.method === "POST" && action === "retry") return json(res, 200, await runtime.retry(id, workspaceDefault).then(async mission => ({ mission, events: runtime.getEvents(id) })));
    }

    if (req.method === "POST" && url.pathname === "/api/missions") {
      const input = await body(req);
      const goal = typeof input.goal === "string" ? input.goal.trim() : "";
      if (!goal) return json(res, 422, { error: "goal is required" });
      const mission = await runtime.createMission(goal);
      const workspace = typeof input.workspace === "string" && input.workspace.trim() ? input.workspace : workspaceDefault;
      if (input.autoRun !== false) {
        const finished = await runtime.run(mission.id, workspace);
        let artifact;
        if (finished.result) artifact = await artifacts.save(finished.id, "mission-report.txt", finished.result);
        return json(res, 201, { mission: finished, events: runtime.getEvents(finished.id), artifact });
      }
      void runtime.run(mission.id, workspace).catch(() => undefined);
      return json(res, 202, await responseFor(mission.id));
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, () => console.log(`AshAI control plane: http://localhost:${port}`));
