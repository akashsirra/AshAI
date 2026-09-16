export type MissionStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_approval"
  | "verifying"
  | "completed"
  | "failed";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface Mission {
  id: string;
  goal: string;
  status: MissionStatus;
  plan: MissionStep[];
  createdAt: string;
  updatedAt: string;
  result?: string;
  error?: string;
}

export interface MissionStep {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  tool?: string;
  requiresApproval?: boolean;
}

export interface ToolContext {
  missionId: string;
  workspace: string;
}

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
    | "approval.required"
    | "step.completed"
    | "mission.completed"
    | "mission.failed";
  timestamp: string;
  data: Record<string, unknown>;
}
