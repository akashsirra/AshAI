import "dotenv/config";
import { GroqProvider } from "./core/groq-provider.js";
import { MissionRuntime } from "./core/mission-runtime.js";
import { ToolRegistry } from "./core/tool-registry.js";
import { workspaceExecute, workspaceInspect, workspaceVerify } from "./tools/builtin.js";

const registry = new ToolRegistry();
registry.register(workspaceInspect);
registry.register(workspaceExecute);
registry.register(workspaceVerify);

const provider = process.env.ASHAI_API_KEY ? new GroqProvider() : undefined;
const runtime = new MissionRuntime(registry, provider);

const goal = process.argv.slice(2).join(" ").trim();

if (!goal) {
  console.log("AshAI Mission Engine");
  console.log("\nUsage:");
  console.log('  npm run dev -- "Analyze this project and identify the next useful action"');
  console.log("\nRegistered tools:");
  for (const tool of registry.list()) console.log(`  - ${tool.name}: ${tool.description}`);
  console.log(`\nPlanner: ${provider ? "Groq" : "deterministic fallback (set ASHAI_API_KEY to enable Groq)"}`);
  process.exit(0);
}

try {
  const mission = await runtime.createMission(goal);
  console.log(JSON.stringify({ event: "mission.created", mission }, null, 2));

  const completed = await runtime.run(mission.id);
  console.log(JSON.stringify({
    event: "mission.finished",
    mission: completed,
    timeline: runtime.getEvents(completed.id),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
