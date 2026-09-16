import "dotenv/config";
import { ToolRegistry } from "./core/tool-registry.js";
import { MissionRuntime } from "./core/mission-runtime.js";
import { workspaceExecute, workspaceInspect, workspaceVerify } from "./tools/builtin.js";

const registry = new ToolRegistry();
registry.register(workspaceInspect);
registry.register(workspaceExecute);
registry.register(workspaceVerify);

const runtime = new MissionRuntime(registry);

const goal = process.argv.slice(2).join(" ").trim();

if (!goal) {
  console.log("AshAI Mission Engine");
  console.log("\nUsage:");
  console.log('  npm run dev -- "Analyze this project and identify the next useful action"');
  console.log("\nRegistered tools:");
  for (const tool of registry.list()) console.log(`  - ${tool.name}: ${tool.description}`);
  process.exit(0);
}

const mission = runtime.createMission(goal);
console.log(JSON.stringify({ event: "mission.created", mission }, null, 2));

const completed = await runtime.run(mission.id);
console.log(JSON.stringify({
  event: "mission.finished",
  mission: completed,
  timeline: runtime.getEvents(completed.id),
}, null, 2));
