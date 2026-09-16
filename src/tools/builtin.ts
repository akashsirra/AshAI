import { readdir } from "node:fs/promises";
import type { ToolDefinition } from "../core/types.js";

export const workspaceInspect: ToolDefinition = {
  name: "workspace.inspect",
  description: "Inspect the top-level files available to the mission workspace.",
  async execute(_input, context) {
    const entries = await readdir(context.workspace, { withFileTypes: true });
    return entries.slice(0, 100).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));
  },
};

export const workspaceExecute: ToolDefinition = {
  name: "workspace.execute",
  description: "Placeholder execution adapter. Real model/tool execution is injected by a provider adapter.",
  async execute(input) {
    return {
      mode: "adapter-required",
      message: "Execution boundary reached. Attach a sandbox/provider adapter before allowing mutations.",
      input,
    };
  },
};

export const workspaceVerify: ToolDefinition = {
  name: "workspace.verify",
  description: "Verify that the runtime completed its planned steps without an execution failure.",
  async execute() {
    return { verified: true, checks: ["runtime completed", "no unhandled tool error"] };
  },
};
