import { randomUUID } from "node:crypto";
import { createPlan } from "./planner.js";
import type { Event, Mission, MissionStep } from "./types.js";
import { ToolRegistry } from "./tool-registry.js";

export class MissionRuntime {
  private readonly missions = new Map<string, Mission>();
  private readonly events = new Map<string, Event[]>();

  constructor(private readonly tools: ToolRegistry) {}

  createMission(goal: string): Mission {
    const now = new Date().toISOString();
    const mission: Mission = {
      id: randomUUID(),
      goal,
      status: "planning",
      plan: createPlan(goal),
      createdAt: now,
      updatedAt: now,
    };

    this.missions.set(mission.id, mission);
    this.events.set(mission.id, []);
    this.emit(mission.id, "mission.created", { goal });
    this.emit(mission.id, "plan.created", { steps: mission.plan.length });
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
        await this.runStep(mission, step, workspace);
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

  private async runStep(mission: Mission, step: MissionStep, workspace: string): Promise<void> {
    step.status = "running";
    this.emit(mission.id, "step.started", { stepId: step.id, title: step.title });

    if (step.tool) {
      const tool = this.tools.get(step.tool);
      if (tool.requiresApproval || step.requiresApproval) {
        mission.status = "waiting_approval";
        this.emit(mission.id, "approval.required", { stepId: step.id, tool: tool.name });
        throw new Error(`Approval required for tool: ${tool.name}`);
      }

      this.emit(mission.id, "tool.called", { stepId: step.id, tool: tool.name });
      const output = await tool.execute({ goal: mission.goal }, { missionId: mission.id, workspace });
      this.emit(mission.id, "tool.completed", { stepId: step.id, tool: tool.name, output });
    }

    step.status = "completed";
    this.emit(mission.id, "step.completed", { stepId: step.id });
  }

  private touch(mission: Mission): void {
    mission.updatedAt = new Date().toISOString();
  }

  private emit(id: string, type: Event["type"], data: Record<string, unknown>): void {
    const event: Event = {
      id: randomUUID(),
      missionId: id,
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    this.events.get(id)?.push(event);
  }
}
