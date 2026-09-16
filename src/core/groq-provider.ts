import type { ModelProvider } from "./model-provider.js";
import type { MissionStep } from "./types.js";

interface GroqProviderOptions { apiKey?: string; baseUrl?: string; model?: string; }

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
      "Return ONLY JSON: {\"steps\":[{\"id\":\"...\",\"title\":\"...\",\"description\":\"...\",\"tool\":\"workspace.inspect|workspace.read_file|workspace.execute|workspace.verify|workspace.write_file\"}]}.",
      "Do not call tools, use tool syntax, or output markdown.",
      "Prefer inspect/read before execute/write. Use write_file only when the goal explicitly requires changing files.",
    ].join(" ");
    const parsed = JSON.parse(await this.chat(system, goal)) as Record<string, unknown>;
    const steps = parsed.steps;
    if (!Array.isArray(steps)) throw new Error("Groq planner returned no steps array.");
    return steps.map((item, index) => {
      if (!item || typeof item !== "object") throw new Error(`Invalid plan step ${index}.`);
      const value = item as Record<string, unknown>;
      const allowed = new Set(["workspace.inspect", "workspace.read_file", "workspace.execute", "workspace.verify", "workspace.write_file"]);
      return {
        id: typeof value.id === "string" ? value.id : `step-${index + 1}`,
        title: typeof value.title === "string" ? value.title : `Step ${index + 1}`,
        description: typeof value.description === "string" ? value.description : goal,
        status: "pending" as const,
        tool: typeof value.tool === "string" && allowed.has(value.tool) ? value.tool : undefined,
        requiresApproval: value.tool === "workspace.write_file",
      };
    });
  }

  async decide(input: { goal: string; step: MissionStep; toolResult?: unknown }) {
    const system = [
      "You are AshAI's execution controller.",
      "Inspect the current tool result and decide the next useful action.",
      "Return ONLY JSON: {\"action\":\"call_tool|complete|ask_approval\",\"tool\":\"optional tool\",\"input\":{},\"summary\":\"...\"}.",
      "Never invent tools. Available tools: workspace.inspect, workspace.read_file, workspace.execute, workspace.verify, workspace.write_file.",
      "Use workspace.read_file to inspect source. Use workspace.execute for safe development commands. Use workspace.write_file only for requested code changes; if a write is needed, return ask_approval unless mutation is explicitly enabled by the runtime.",
      "Do not call tools or output markdown.",
    ].join(" ");
    const decision = JSON.parse(await this.chat(system, JSON.stringify(input))) as Record<string, unknown>;
    return {
      action: decision.action as "call_tool" | "complete" | "ask_approval",
      tool: typeof decision.tool === "string" ? decision.tool : undefined,
      input: decision.input,
      summary: typeof decision.summary === "string" ? decision.summary : undefined,
    };
  }

  private async chat(system: string, user: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, temperature: 0.1, tool_choice: "none", response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!response.ok) throw new Error(`Groq request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned no message content.");
    return content.trim();
  }
}
