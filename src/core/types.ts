export type MissionStatus = "queued" | "planning" | "running" | "waiting_approval" | "verifying" | "synthesizing" | "completed" | "failed";
export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface MissionSynthesis { summary: string; findings: string[]; recommendations: string[]; nextAction: string; }
export interface MissionArtifact { id: string; missionId: string; name: string; path: string; size: number; createdAt: string; }

export interface Mission {
  id: string;
  goal: string;
  status: MissionStatus;
  plan: MissionStep[];
  createdAt: string;
  updatedAt: string;
  result?: string;
  synthesis?: MissionSynthesis;
  artifacts?: MissionArtifact[];
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
  attempts?: number;
}

export interface ToolContext { missionId: string; workspace: string; }
export interface ToolDefinition<TInput = unknown, TOutput = unknown> { name: string; description: string; requiresApproval?: boolean; execute(input: TInput, context: ToolContext): Promise<TOutput>; }

export interface Event {
  id: string;
  missionId: string;
  type:
    | "mission.created" | "plan.created" | "step.started" | "tool.called" | "tool.completed"
    | "agent.decision" | "approval.required" | "approval.granted" | "step.completed" | "step.failed"
    | "mission.verifying" | "mission.synthesizing" | "mission.synthesized" | "mission.retrying"
    | "artifact.created" | "mission.completed" | "mission.failed";
  timestamp: string;
  data: Record<string, unknown>;
}
