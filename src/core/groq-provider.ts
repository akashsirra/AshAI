import type { ModelProvider } from "./model-provider.js";
import type { MissionStep } from "./types.js";

interface GroqProviderOptions { apiKey?: string; baseUrl?: string; model?: string; }

type AgentAction = "call_tool" | "complete" | "ask_approval";

const TOOL_NAMES = [
  "workspace.inspect",
  "workspace.read_file",
  "workspace.execute",
  "workspace.verify",
  "workspace.write_file",
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

const plannerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          tool: { type: ["string", "null"], enum: [...TOOL_NAMES, null] },
          input: { type: "string" },
        },
        required: ["id", "title", "description", "tool", "input"],
      },
    },
  },
  required: ["steps"],
} as const;

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["call_tool", "complete", "ask_approval"] },
    tool: { type: ["string", "null"], enum: [...TOOL_NAMES, null] },
    input: { type: "string" },
    summary: { type: "string" },
  },
  required: ["action", "tool", "input", "summary"],
} as const;

function parseInput(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try { return JSON.parse(raw); }
  catch { throw new Error("Groq returned invalid tool input JSON."); }
}

export class GroqProvider implements ModelProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: GroqProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ASHAI_API_KEY ?? "";
    this.baseUrl = (options.baseUrl ?? process.env.ASHAI_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
    this.model = options.model ?? process.env.ASHAI_MODEL ?? "openai/gpt-oss-20b";
    if (!this.apiKey) throw new Error("ASHAI_API_KEY is required when using the Groq provider.");
  }

  async plan(goal: string): Promise<MissionStep[]> {
    const system = [
      "You are AshAI's mission planner.",
      "Create a concise executable plan for the user's goal.",
      "Return the requested structured JSON only.",
      "For every tool step, input must be a JSON object encoded as a string.",
      "For workspace.read_file use input like {\"path\":\"README.md\"}.",
      "For workspace.execute or workspace.verify use input like {\"command\":\"npm run typecheck\"}.",
      "For workspace.inspect use input like {\"path\":\".\"}.",
      "For workspace.write_file use input like {\"path\":\"src/file.ts\",\"content\":\"...\"}.",
      "Prefer inspect/read before execute/write.",
      "Use write_file only when the goal explicitly requires changing files.",
    ].join(" ");
    const parsed = JSON.parse(await this.chat(system, goal, plannerSchema, "mission_plan")) as Record<string, unknown>;
    const steps = parsed.steps;
    if (!Array.isArray(steps)) throw new Error("Groq planner returned no steps array.");
    return steps.map((item, index) => {
      if (!item || typeof item !== "object") throw new Error(`Invalid plan step ${index}.`);
      const value = item as Record<string, unknown>;
      const tool = typeof value.tool === "string" && TOOL_NAMES.includes(value.tool as ToolName) ? value.tool as ToolName : undefined;
      return {
        id: typeof value.id === "string" ? value.id : `step-${index + 1}`,
        title: typeof value.title === "string" ? value.title : `Step ${index + 1}`,
        description: typeof value.description === "string" ? value.description : goal,
        status: "pending" as const,
        tool,
        input: parseInput(value.input),
        requiresApproval: tool === "workspace.write_file",
      };
    });
  }

  async decide(input: { goal: string; step: MissionStep; toolResult?: unknown }): Promise<Awaited<ReturnType<ModelProvider["decide"]>>> {
    const system = [
      "You are AshAI's execution controller.",
      "Inspect the current tool result and decide the next useful action.",
      "Return only the requested structured JSON.",
      "If action is call_tool, input must be a JSON object encoded as a string.",
      "Use workspace.read_file to inspect source.",
      "Use workspace.execute for safe development commands.",
      "Use workspace.write_file only for requested code changes.",
      "If a write is needed and mutation is not explicitly enabled, return ask_approval.",
      "If no further action is needed for this step, return complete.",
    ].join(" ");
    const raw = await this.chat(system, JSON.stringify(input), decisionSchema, "agent_decision");
    const decision = JSON.parse(raw) as Record<string, unknown>;
    const action = decision.action;
    if (action !== "call_tool" && action !== "complete" && action !== "ask_approval") {
      throw new Error(`Groq returned invalid agent action: ${String(action)}`);
    }
    const tool = typeof decision.tool === "string" && TOOL_NAMES.includes(decision.tool as ToolName)
      ? decision.tool as ToolName
      : undefined;
    return {
      action: action as AgentAction,
      tool,
      input: parseInput(decision.input),
      summary: typeof decision.summary === "string" ? decision.summary : undefined,
    };
  }

  private async chat(system: string, user: string, schema: Record<string, unknown>, schemaName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        reasoning_effort: "low",
        reasoning_format: "hidden",
        response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
        messages: [{ role: "user", content: `${system}\n\nUSER REQUEST:\n${user}` }],
      }),
    });
    if (!response.ok) throw new Error(`Groq request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned no message content.");
    return content.trim();
  }
}