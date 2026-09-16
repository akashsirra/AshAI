import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MissionRuntime } from "./mission-runtime-v2.js";
import { JsonMissionStore } from "./mission-store.js";
import { ToolRegistry } from "./tool-registry.js";
import type { MissionStep, ToolDefinition } from "./types.js";

const echo: ToolDefinition = { name: "test.echo", description: "test", async execute(input) { return { ok: true, input }; } };
const write: ToolDefinition = { name: "test.write", description: "test mutation", requiresApproval: true, async execute() { return { written: true }; } };

const data = await mkdtemp(join(tmpdir(), "ashai-test-"));
try {
  const registry = new ToolRegistry(); registry.register(echo); registry.register(write);
  const provider = {
    async plan(_goal: string): Promise<MissionStep[]> { return [{ id: "one", title: "One", description: "evidence", status: "pending", tool: "test.echo", input: { x: 1 } }]; },
    async decide() { return { action: "complete" as const }; },
    async synthesize(input: { goal: string; steps: MissionStep[]; toolResults: Record<string, unknown> }) { return { summary: `done: ${input.goal}`, findings: ["evidence collected"], recommendations: [], nextAction: "finished" }; },
  };
  const runtime = new MissionRuntime(registry, provider, new JsonMissionStore(data));
  const mission = await runtime.createMission("test mission");
  const result = await runtime.run(mission.id, data);
  assert.equal(result.status, "completed");
  assert.match(result.result ?? "", /evidence collected/);
  assert.ok(runtime.getEvents(mission.id).some(event => event.type === "mission.synthesized"));

  let followUpCalls = 0;
  const loopProvider = {
    ...provider,
    async decide() { followUpCalls += 1; return followUpCalls === 1 ? { action: "call_tool" as const, tool: "test.echo", input: { followUp: true }, summary: "Collect follow-up evidence" } : { action: "complete" as const }; },
  };
  const loopRuntime = new MissionRuntime(registry, loopProvider, new JsonMissionStore(data));
  const loopMission = await loopRuntime.createMission("closed loop");
  const loopResult = await loopRuntime.run(loopMission.id, data);
  assert.equal(loopResult.status, "completed");
  assert.ok(loopResult.plan.some(step => step.description.includes("follow-up")));
  assert.ok(loopRuntime.getEvents(loopMission.id).some(event => event.type === "agent.decision"));

  const approvalProvider = {
    ...provider,
    async plan(_goal: string): Promise<MissionStep[]> { return [{ id: "write", title: "Write", description: "mutation", status: "pending", tool: "test.write", input: {} }]; },
  };
  const guarded = new MissionRuntime(registry, approvalProvider, new JsonMissionStore(data));
  const pending = await guarded.createMission("approval test");
  const paused = await guarded.run(pending.id, data);
  assert.equal(paused.status, "waiting_approval");
  assert.equal(paused.plan[0]?.status, "running");
  await guarded.approve(pending.id);
  assert.equal(guarded.getMission(pending.id).plan[0]?.status, "pending");
  const resumed = await guarded.run(pending.id, data);
  assert.equal(resumed.status, "completed");
} finally { await rm(data, { recursive: true, force: true }); }

console.log("AshAI runtime tests passed");
