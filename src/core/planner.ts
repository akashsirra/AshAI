import type { MissionStep } from "./types.js";

/**
 * Deterministic starter planner. The model adapter will replace this with
 * model-driven planning without changing the runtime contract.
 */
export function createPlan(goal: string): MissionStep[] {
  const normalized = goal.toLowerCase();
  const steps: MissionStep[] = [
    {
      id: "understand",
      title: "Understand the mission",
      description: `Clarify the desired outcome and constraints for: ${goal}`,
      status: "pending",
    },
    {
      id: "inspect",
      title: "Inspect available context",
      description: "Gather the files, data, project state, and tools relevant to the goal.",
      status: "pending",
      tool: "workspace.inspect",
    },
    {
      id: "execute",
      title: "Execute the work",
      description: normalized.includes("code") || normalized.includes("build")
        ? "Implement the requested change in the isolated workspace."
        : "Perform the core work required to satisfy the mission.",
      status: "pending",
      tool: "workspace.execute",
      requiresApproval: false,
    },
    {
      id: "verify",
      title: "Verify the result",
      description: "Check the output against the original goal and surface any failures.",
      status: "pending",
      tool: "workspace.verify",
    },
    {
      id: "deliver",
      title: "Deliver the result",
      description: "Return a concise summary of what was completed, evidence, and remaining work.",
      status: "pending",
    },
  ];

  return steps;
}
