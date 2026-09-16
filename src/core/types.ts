export type MissionStatus = "queued" | "planning" | "running" | "waiting_approval" | "verifying" | "synthesizing" | "completed" | "failed";
export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface MissionSynthesis {
  summary: string;
  findings: string[];
  recommendations: string[];
  nextAction: string;
}

export interface Mission {
  id: string;
  goal: string;
  status: MissionStatus;
  plan: MissionStep[];
  createdAt: string;
  updatedAt: string;
  result?: string;
  synthesis?: MissionSynthesis;
  error?: string;
}

export interface MissionStep {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  tool?: string;
  input?: unknown;
  requiresApproval?: boolean;
}

export interface ToolContext { missionId: string; workspace: string; }

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  requiresApproval?: boolean;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

export interface Event {
  id: string;
  missionId: string;
  type:
    | "mission.created"
    | "plan.created"
    | "step.started"
    | "tool.called"
    | "tool.completed"
    | "agent.decision"
    | "approval.required"
    | "step.completed"
    | "mission.synthesizing"
    | "mission.synthesized"
    | "mission.completed"
    | "mission.failed";
  timestamp: string;
  data: Record<string, unknown>;
}
