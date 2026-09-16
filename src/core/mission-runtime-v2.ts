import { randomUUID } from "node:crypto";
import { createPlan } from "./planner.js";
import type { Event, Mission, MissionSynthesis, MissionStep } from "./types.js";
import { ToolRegistry } from "./tool-registry.js";
import type { ModelProvider } from "./model-provider.js";
import { JsonMissionStore, type MissionStore } from "./mission-store.js";

export class MissionRuntime {
  private readonly missions = new Map<string, Mission>();
  private readonly events = new Map<string, Event[]>();
  private readonly approved = new Set<string>();

  constructor(private readonly tools: ToolRegistry, private readonly provider?: ModelProvider, private readonly store: MissionStore = new JsonMissionStore()) {}

  async createMission(goal: string): Promise<Mission> {
    if (!goal.trim()) throw new Error("Mission goal cannot be empty.");
    const now = new Date().toISOString();
    const mission: Mission = { id: randomUUID(), goal: goal.trim(), status: "planning", plan: [], createdAt: now, updatedAt: now };
    this.missions.set(mission.id, mission); this.events.set(mission.id, []);
    await this.persist(mission); await this.emit(mission.id, "mission.created", { goal: mission.goal });
    try {
      mission.plan = this.provider ? await this.provider.plan(mission.goal) : createPlan(mission.goal);
      if (!mission.plan.length) throw new Error("Mission planner returned an empty plan.");
      await this.emit(mission.id, "plan.created", { steps: mission.plan.length, planner: this.provider ? "model" : "deterministic" });
      await this.persist(mission); return mission;
    } catch (error) {
      mission.status = "failed"; mission.error = error instanceof Error ? error.message : String(error); await this.persist(mission); await this.emit(mission.id, "mission.failed", { error: mission.error }); throw error;
    }
  }

  async hydrate(id: string): Promise<Mission> {
    const existing = this.missions.get(id); if (existing) return existing;
    const mission = await this.store.loadMission(id); if (!mission) throw new Error(`Mission not found: ${id}`);
    this.missions.set(id, mission); this.events.set(id, await this.store.loadEvents(id)); return mission;
  }

  getMission(id: string): Mission { const mission = this.missions.get(id); if (!mission) throw new Error(`Mission not found: ${id}`); return mission; }
  async listMissions(): Promise<Mission[]> { return this.store.listMissions(); }
  getEvents(id: string): Event[] { if (!this.events.has(id)) throw new Error(`Mission not found: ${id}`); return this.events.get(id)!; }

  async approve(id: string): Promise<Mission> {
    const mission = await this.hydrate(id);
    if (mission.status !== "waiting_approval") throw new Error("Mission is not waiting for approval.");
    this.approved.add(id); mission.error = undefined;
    for (const step of mission.plan) if (step.status === "running") step.status = "pending";
    await this.emit(id, "approval.granted", { missionId: id }); await this.persist(mission); return mission;
  }

  async run(id: string, workspace = process.cwd()): Promise<Mission> {
    const mission = await this.hydrate(id);
    if (mission.status === "completed") return mission;
    mission.status = "running"; mission.error = undefined; await this.persist(mission);
    const toolResults: Record<string, unknown> = {};
    const signatures = new Set<string>();
    const maxSteps = Math.max(1, Number(process.env.ASHAI_MAX_AGENT_STEPS ?? 24));
    const maxControllerCalls = Math.max(0, Number(process.env.ASHAI_MAX_CONTROLLER_CALLS ?? 4));
    let executed = 0;
    let controllerCalls = 0;
    try {
      for (let index = 0; index < mission.plan.length && executed < maxSteps; index += 1) {
        const step = mission.plan[index];
        if (!step || step.status === "completed") continue;
        try { step.attempts = (step.attempts ?? 0) + 1; toolResults[step.id] = await this.runStep(mission, step, workspace); executed += 1; }
        catch (error) {
          if (this.getMission(id).status === "waiting_approval") { await this.persist(mission); return mission; }
          toolResults[step.id] = { error: error instanceof Error ? error.message : String(error), status: "failed" }; executed += 1;
        }
        const shouldConsultController = this.provider && process.env.ASHAI_AGENT_LOOP !== "false" && controllerCalls < maxControllerCalls && (step.status === "failed" || executed === 1 || executed % 3 === 0);
        if (shouldConsultController && this.getMission(id).status === "running") {
          controllerCalls += 1;
          try {
            const decision = await this.provider!.decide({ goal: mission.goal, step, toolResult: toolResults[step.id] });
            await this.emit(id, "agent.decision", { stepId: step.id, decision });
            if (decision.action === "ask_approval") { mission.status = "waiting_approval"; await this.persist(mission); return mission; }
            if (decision.action === "call_tool" && decision.tool) {
              const signature = `${decision.tool}:${JSON.stringify(decision.input ?? {})}`;
              if (!signatures.has(signature)) {
                signatures.add(signature);
                mission.plan.splice(index + 1, 0, { id: `agent-${randomUUID()}`, title: decision.summary || `Agent follow-up: ${decision.tool}`, description: decision.summary || `Agent-selected follow-up using ${decision.tool}.`, status: "pending", tool: decision.tool, input: decision.input, requiresApproval: decision.tool === "workspace.write_file" });
                await this.persist(mission);
              }
            }
          } catch (error) {
            await this.emit(id, "agent.decision", { stepId: step.id, error: error instanceof Error ? error.message : String(error), fallback: "continue_planned_steps" });
          }
        }
      }
      if (executed >= maxSteps && mission.plan.some(step => step.status === "pending")) mission.error = `Agent step limit reached (${maxSteps}).`;
      mission.status = "verifying"; await this.persist(mission); await this.emit(id, "mission.verifying", { steps: mission.plan.length });
      mission.status = "synthesizing"; await this.persist(mission); await this.emit(id, "mission.synthesizing", { steps: mission.plan.length });
      try {
        mission.synthesis = this.provider ? await this.provider.synthesize({ goal: mission.goal, steps: mission.plan, toolResults: this.limitToolResults(toolResults) }) : this.fallbackSynthesis(mission);
      } catch (error) {
        mission.synthesis = this.fallbackSynthesis(mission);
        await this.emit(id, "agent.decision", { phase: "synthesis", error: error instanceof Error ? error.message : String(error), fallback: "deterministic_synthesis" });
      }
      mission.synthesis = this.cleanSynthesis(mission.synthesis); mission.result = this.formatSynthesis(mission.synthesis);
      await this.emit(id, "mission.synthesized", { synthesis: mission.synthesis });
      const incomplete = mission.plan.some(step => step.status === "pending" || step.status === "running"); const failed = mission.plan.some(step => step.status === "failed");
      mission.status = incomplete ? "failed" : "completed";
      if (failed && !mission.error) mission.error = `Completed with ${mission.plan.filter(step => step.status === "failed").length} recoverable step failure(s); see evidence and timeline.`;
      await this.emit(id, mission.status === "completed" ? "mission.completed" : "mission.failed", { result: mission.result, error: mission.error });
    } catch (error) {
      mission.status = "failed"; mission.error = error instanceof Error ? error.message : String(error); await this.emit(id, "mission.failed", { error: mission.error });
    }
    await this.persist(mission); return mission;
  }

  async retry(id: string, workspace = process.cwd()): Promise<Mission> {
    const mission = await this.hydrate(id);
    for (const step of mission.plan) if (step.status === "failed") step.status = "pending";
    mission.error = undefined; mission.result = undefined; mission.synthesis = undefined;
    await this.emit(id, "mission.retrying", { failedStepsReset: true }); await this.persist(mission); return this.run(id, workspace);
  }

  private async runStep(mission: Mission, step: MissionStep, workspace: string): Promise<unknown> {
    step.status = "running"; await this.emit(mission.id, "step.started", { stepId: step.id, title: step.title });
    try {
      const output = step.tool ? await this.runTool(mission, step, step.tool, step.input ?? { goal: mission.goal, step: step.description }, workspace) : { completed: true, note: step.description };
      step.status = "completed"; await this.emit(mission.id, "step.completed", { stepId: step.id }); await this.persist(mission); return output;
    } catch (error) {
      if (mission.status !== "waiting_approval") step.status = "failed";
      await this.emit(mission.id, "step.failed", { stepId: step.id, error: error instanceof Error ? error.message : String(error) }); await this.persist(mission); throw error;
    }
  }

  private async runTool(mission: Mission, step: MissionStep, toolName: string, input: unknown, workspace: string): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (tool.requiresApproval && !this.approved.has(mission.id) && process.env.ASHAI_ALLOW_MUTATIONS !== "true") {
      mission.status = "waiting_approval"; await this.emit(mission.id, "approval.required", { stepId: step.id, tool: tool.name, input }); throw new Error(`Approval required for tool: ${tool.name}`);
    }
    await this.emit(mission.id, "tool.called", { stepId: step.id, tool: tool.name, input });
    const output = await tool.execute(input, { missionId: mission.id, workspace });
    await this.emit(mission.id, "tool.completed", { stepId: step.id, tool: tool.name, output }); return output;
  }

  private limitToolResults(results: Record<string, unknown>): Record<string, unknown> {
    const limited: Record<string, unknown> = {}; let remaining = 18000;
    for (const [stepId, result] of Object.entries(results)) {
      if (remaining <= 0) { limited[stepId] = { omitted: true, reason: "context limit" }; continue; }
      const text = typeof result === "string" ? result : JSON.stringify(result) ?? String(result); const slice = text.slice(0, Math.min(5000, remaining));
      limited[stepId] = text.length > slice.length ? `${slice}\n[truncated]` : result; remaining -= slice.length;
    }
    return limited;
  }

  private cleanSynthesis(synthesis: MissionSynthesis): MissionSynthesis {
    const unique = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))].slice(0, 10);
    return { summary: synthesis.summary.trim(), findings: unique(synthesis.findings), recommendations: unique(synthesis.recommendations), nextAction: synthesis.nextAction.trim() };
  }

  private fallbackSynthesis(mission: Mission): MissionSynthesis {
    const completed = mission.plan.filter(s => s.status === "completed").length; const failed = mission.plan.filter(s => s.status === "failed").length;
    return { summary: `${completed}/${mission.plan.length} planned steps completed${failed ? `; ${failed} step(s) failed but execution continued.` : "."}`, findings: mission.plan.map(s => `${s.title}: ${s.status}.`), recommendations: failed ? ["Review failed-step evidence and retry only the affected work."] : [], nextAction: failed ? "Review the failed step evidence and retry the affected work." : "Mission complete." };
  }

  private formatSynthesis(s: MissionSynthesis): string { return [s.summary, "", "Findings:", ...s.findings.map(x => `- ${x}`), "", "Recommendations:", ...s.recommendations.map(x => `- ${x}`), "", `Next action: ${s.nextAction}`].join("\n"); }
  private async persist(mission: Mission): Promise<void> { mission.updatedAt = new Date().toISOString(); await this.store.saveMission(mission); }
  private async emit(id: string, type: Event["type"], data: Record<string, unknown>): Promise<void> { const event: Event = { id: randomUUID(), missionId: id, type, timestamp: new Date().toISOString(), data }; this.events.get(id)?.push(event); await this.store.appendEvent(event); }
}
