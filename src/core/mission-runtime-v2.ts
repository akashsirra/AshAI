import { randomUUID } from "node:crypto";
import { createPlan } from "./planner.js";
import type { Event, Mission, MissionSynthesis, MissionStep } from "./types.js";
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
    mission.error = undefined;
    this.touch(mission);

    const toolResults: Record<string, unknown> = {};

    try {
      for (const step of mission.plan) {
        toolResults[step.id] = await this.runStep(mission, step, workspace);
      }

      mission.status = "synthesizing";
      this.touch(mission);
      this.emit(id, "mission.synthesizing", { steps: mission.plan.length });

      mission.synthesis = this.provider
        ? await this.provider.synthesize({
            goal: mission.goal,
            steps: mission.plan,
            toolResults: this.limitToolResults(toolResults),
          })
        : this.fallbackSynthesis(mission, toolResults);

      mission.result = this.formatSynthesis(mission.synthesis);
      this.emit(id, "mission.synthesized", { synthesis: mission.synthesis });
      mission.status = "completed";
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
    try {
      let output: unknown;
      if (step.tool) {
        output = await this.runTool(mission, step, step.tool, step.input ?? { goal: mission.goal, step: step.description }, workspace);
      }
      step.status = "completed";
      this.emit(mission.id, "step.completed", { stepId: step.id });
      return output;
    } catch (error) {
      step.status = "failed";
      this.emit(mission.id, "mission.failed", {
        error: error instanceof Error ? error.message : String(error),
        stepId: step.id,
      });
      throw error;
    }
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

  private limitToolResults(results: Record<string, unknown>): Record<string, unknown> {
    const limited: Record<string, unknown> = {};
    let remaining = 24000;
    for (const [stepId, result] of Object.entries(results)) {
      if (remaining <= 0) {
        limited[stepId] = "[tool result omitted: synthesis context limit reached]";
        continue;
      }
      const serialized = typeof result === "string" ? result : JSON.stringify(result);
      const text = serialized ?? String(result);
      const slice = text.slice(0, Math.min(6000, remaining));
      limited[stepId] = text.length > slice.length ? `${slice}\n[truncated]` : result;
      remaining -= slice.length;
    }
    return limited;
  }

  private fallbackSynthesis(mission: Mission, results: Record<string, unknown>): MissionSynthesis {
    const completed = mission.plan.filter(step => step.status === "completed").length;
    const failed = mission.plan.filter(step => step.status === "failed").length;
    const findings = [
      `${completed} of ${mission.plan.length} planned steps completed successfully.`,
      ...mission.plan.filter(step => step.tool).map(step => `${step.title}: ${step.status}.`),
    ];
    if (failed > 0) findings.push(`${failed} step(s) failed; inspect the mission timeline for details.`);
    return {
      summary: `Mission execution finished for: ${mission.goal}`,
      findings,
      recommendations: ["Enable a model provider for evidence-based analysis of tool results."],
      nextAction: "Review the collected tool results and act on the recommendations.",
    };
  }

  private formatSynthesis(synthesis: MissionSynthesis): string {
    return [
      synthesis.summary,
      "",
      "Findings:",
      ...synthesis.findings.map(item => `- ${item}`),
      "",
      "Recommendations:",
      ...synthesis.recommendations.map(item => `- ${item}`),
      "",
      `Next action: ${synthesis.nextAction}`,
    ].join("\n");
  }

  private touch(mission: Mission): void { mission.updatedAt = new Date().toISOString(); }

  private emit(id: string, type: Event["type"], data: Record<string, unknown>): void {
    const event: Event = { id: randomUUID(), missionId: id, type, timestamp: new Date().toISOString(), data };
    this.events.get(id)?.push(event);
  }
}
