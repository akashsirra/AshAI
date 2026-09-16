import { randomUUID } from "node:crypto";
import { createPlan } from "./planner.js";
import type { Event, Mission, MissionStep } from "./types.js";
import { ToolRegistry } from "./tool-registry.js";
import type { ModelProvider } from "./model-provider.js";

export class MissionRuntime {
  private readonly missions = new Map<string, Mission>();
  private readonly events = new Map<string, Event[]>();

  constructor(private readonly tools: ToolRegistry, private readonly provider?: ModelProvider) {}

  async createMission(goal: string): Promise<Mission> {
    const now = new Date().toISOString();
    const mission: Mission = { id: randomUUID(), goal, status: "planning", plan: [], createdAt: now, updatedAt: now };
    this.missions.set(mission.id, mission);
    this.events.set(mission.id, []);
    this.emit(mission.id, "mission.created", { goal });
    mission.plan = this.provider ? await this.provider.plan(goal) : createPlan(goal);
    if (mission.plan.length === 0) throw new Error("Mission planner returned an empty plan.");
    this.emit(mission.id, "plan.created", { steps: mission.plan.length, planner: this.provider ? "model" : "deterministic" });
    this.touch(mission);
    return mission;
  }

  getMission(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error(`Mission not found: ${id}`);
    return mission;
  }

  getEvents(id: string): Event[] {
    if (!this.events.has(id)) throw new Error(`Mission not found: ${id}`);
    return this.events.get(id)!;
  }

  async run(id: string, workspace = process.cwd()): Promise<Mission> {
    const mission = this.getMission(id);
    mission.status = "running";
    this.touch(mission);

    try {
      for (const step of mission.plan) {
        const output = await this.runStep(mission, step, workspace);
        if (this.provider && output !== undefined) {
          const decision = await this.provider.decide({ goal: mission.goal, step, toolResult: output });
          this.emit(id, "agent.decision", { stepId: step.id, ...decision });
          if (decision.action === "ask_approval") {
            mission.status = "waiting_approval";
            this.emit(id, "approval.required", { stepId: step.id, reason: decision.summary ?? "Model requested approval" });
            return mission;
          }
          if (decision.action === "call_tool" && decision.tool) {
            await this.runTool(mission, step, decision.tool, decision.input, workspace);
          }
        }
      }
      mission.status = "completed";
      mission.result = `Mission completed: ${mission.goal}`;
      this.emit(id, "mission.completed", { result: mission.result });
    } catch (error) {
      mission.status = "failed";
      mission.error = error instanceof Error ? error.message : String(error);
      this.emit(id, "mission.failed", { error: mission.error });
    }
    this.touch(mission);
    return mission;
  }

  private async runStep(mission: Mission, step: MissionStep, workspace: string): Promise<unknown> {
    step.status = "running";
    this.emit(mission.id, "step.started", { stepId: step.id, title: step.title });
    let output: unknown;
    if (step.tool) {
      output = await this.runTool(mission, step, step.tool, step.input ?? { goal: mission.goal, step: step.description }, workspace);
    }
    step.status = "completed";
    this.emit(mission.id, "step.completed", { stepId: step.id });
    return output;
  }

  private async runTool(mission: Mission, step: MissionStep, toolName: string, input: unknown, workspace: string): Promise<unknown> {
    const tool = this.tools.get(toolName);
    const mutationAllowed = process.env.ASHAI_ALLOW_MUTATIONS === "true";
    if (tool.requiresApproval && !mutationAllowed) {
      mission.status = "waiting_approval";
      this.emit(mission.id, "approval.required", { stepId: step.id, tool: tool.name });
      throw new Error(`Approval required for tool: ${tool.name}. Set ASHAI_ALLOW_MUTATIONS=true to explicitly enable local mutations.`);
    }
    this.emit(mission.id, "tool.called", { stepId: step.id, tool: tool.name, input });
    const output = await tool.execute(input, { missionId: mission.id, workspace });
    this.emit(mission.id, "tool.completed", { stepId: step.id, tool: tool.name, output });
    return output;
  }

  private touch(mission: Mission): void { mission.updatedAt = new Date().toISOString(); }

  private emit(id: string, type: Event["type"], data: Record<string, unknown>): void {
    const event: Event = { id: randomUUID(), missionId: id, type, timestamp: new Date().toISOString(), data };
    this.events.get(id)?.push(event);
  }
}
