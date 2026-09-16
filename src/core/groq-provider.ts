import type { ModelProvider } from "./model-provider.js";
import type { MissionStep } from "./types.js";

interface GroqProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** Minimal Groq/OpenAI-compatible provider. The key is read from the environment and never persisted. */
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
      "Return ONLY valid JSON: an array of objects with id,title,description and optional tool.",
      "Available tools: workspace.inspect, workspace.execute, workspace.verify.",
    ].join(" ");
    const text = await this.chat(system, goal);
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Groq planner returned a non-array plan.");
    return parsed.map((item, index) => {
      if (!item || typeof item !== "object") throw new Error(`Invalid plan step ${index}.`);
      const value = item as Record<string, unknown>;
      return {
        id: typeof value.id === "string" ? value.id : `step-${index + 1}`,
        title: typeof value.title === "string" ? value.title : `Step ${index + 1}`,
        description: typeof value.description === "string" ? value.description : goal,
        status: "pending" as const,
        tool: value.tool === "workspace.inspect" || value.tool === "workspace.execute" || value.tool === "workspace.verify" ? value.tool : undefined,
        requiresApproval: false,
      };
    });
  }

  async decide(input: { goal: string; step: MissionStep; toolResult?: unknown }) {
    const system = [
      "You are AshAI's execution controller.",
      "Choose the next action for the current mission step.",
      "Return ONLY JSON with action (call_tool|complete|ask_approval), optional tool, input, summary.",
      "Never invent tools. Available tools: workspace.inspect, workspace.execute, workspace.verify.",
    ].join(" ");
    const text = await this.chat(system, JSON.stringify(input));
    return JSON.parse(text) as { action: "call_tool" | "complete" | "ask_approval"; tool?: string; input?: unknown; summary?: string };
  }

  private async chat(system: string, user: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!response.ok) throw new Error(`Groq request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned no message content.");
    return content.trim();
  }
}
