import "dotenv/config";
import { GroqProvider } from "./core/groq-provider.js";
import { MissionRuntime } from "./core/mission-runtime-v2.js";
import { ToolRegistry } from "./core/tool-registry.js";
import { workspaceExecute, workspaceFindFiles, workspaceInspect, workspaceReadFile, workspaceSearch, workspaceVerify, workspaceWriteFile } from "./tools/builtin.js";

const registry = new ToolRegistry();
for (const tool of [workspaceInspect, workspaceFindFiles, workspaceSearch, workspaceReadFile, workspaceExecute, workspaceVerify, workspaceWriteFile]) registry.register(tool);

const provider = process.env.ASHAI_API_KEY ? new GroqProvider() : undefined;
const runtime = new MissionRuntime(registry, provider);
const goal = process.argv.slice(2).join(" ").trim();

if (!goal) {
  console.log("AshAI Mission Engine");
  console.log('\nUsage: npm run dev -- "Inspect this project and explain what should improve first"');
  console.log("\nRegistered tools:");
  for (const tool of registry.list()) console.log(`  - ${tool.name}: ${tool.description}${tool.requiresApproval ? " [approval]" : ""}`);
  console.log(`\nPlanner: ${provider ? "Groq" : "deterministic fallback (set ASHAI_API_KEY to enable Groq)"}`);
  console.log(`Agent loop: ${process.env.ASHAI_AGENT_LOOP === "false" ? "disabled" : "enabled (bounded)"}`);
  console.log(`Mutations: ${process.env.ASHAI_ALLOW_MUTATIONS === "true" ? "enabled" : "disabled (approval required)"}`);
  process.exit(0);
}

try {
  const mission = await runtime.createMission(goal);
  console.log(JSON.stringify({ event: "mission.created", mission }, null, 2));
  const completed = await runtime.run(mission.id, process.env.ASHAI_WORKSPACE ?? process.cwd());
  console.log(JSON.stringify({ event: "mission.finished", mission: completed, timeline: runtime.getEvents(completed.id) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
