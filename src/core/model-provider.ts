import type { MissionStep } from "./types.js";

export interface PlannerProvider {
  plan(goal: string): Promise<MissionStep[]>;
}

export interface AgentProvider {
  decide(input: {
    goal: string;
    step: MissionStep;
    toolResult?: unknown;
  }): Promise<{ action: "call_tool" | "complete" | "ask_approval"; tool?: string; input?: unknown; summary?: string }>;
}

/** Provider adapters live behind these interfaces so the runtime is model-agnostic. */
export interface ModelProvider extends PlannerProvider, AgentProvider {}
