import type { AgentProvider, ModelProvider } from "./model-provider.js";
import type { MissionSynthesis, MissionStep } from "./types.js";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export class OpenAICompatibleProvider implements ModelProvider {
  private readonly apiKey = process.env.ASHAI_API_KEY;
  private readonly baseUrl = (process.env.ASHAI_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
  private readonly model = process.env.ASHAI_MODEL ?? "openai/gpt-oss-20b";

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async plan(goal: string): Promise<MissionStep[]> {
    const prompt = `Create a concise execution plan for this software-agent mission: ${goal}\nReturn ONLY JSON: an array of objects with id, title, description, and optional tool. Allowed tools: workspace.inspect, workspace.read, workspace.execute, workspace.verify.`;
    const result = await this.chat(prompt);
    const parsed = JSON.parse(result) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Model returned an invalid plan");
    return parsed.map((item, index) => {
      const value = item as Record<string, unknown>;
      return {
        id: String(value.id ?? `step-${index + 1}`),
        title: String(value.title ?? `Step ${index + 1}`),
        description: String(value.description ?? "Execute the requested work."),
        status: "pending" as const,
        ...(value.tool ? { tool: String(value.tool) } : {}),
      };
    });
  }

  async synthesize(input: { goal: string; steps: MissionStep[]; toolResults: Record<string, unknown> }): Promise<MissionSynthesis> {
    const prompt = [
      "You are AshAI's final mission analyst.",
      "Analyze only the supplied mission evidence and return ONLY valid JSON.",
      "The JSON must contain: summary (string), findings (string array), recommendations (string array), nextAction (string).",
      "Do not invent facts that are absent from the evidence.",
      `MISSION EVIDENCE: ${JSON.stringify(input)}`,
    ].join("\n");
    const result = await this.chat(prompt);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (typeof parsed.summary !== "string" || !Array.isArray(parsed.findings) || !Array.isArray(parsed.recommendations) || typeof parsed.nextAction !== "string") {
      throw new Error("Model returned an invalid mission synthesis");
    }
    if (!parsed.findings.every(item => typeof item === "string") || !parsed.recommendations.every(item => typeof item === "string")) {
      throw new Error("Model returned invalid synthesis arrays");
    }
    return {
      summary: parsed.summary,
      findings: parsed.findings as string[],
      recommendations: parsed.recommendations as string[],
      nextAction: parsed.nextAction,
    };
  }

  async decide(input: Parameters<AgentProvider["decide"]>[0]) {
    const prompt = `You are AshAI's execution controller.\nGoal: ${input.goal}\nCurrent step: ${JSON.stringify(input.step)}\nTool result: ${JSON.stringify(input.toolResult ?? null)}\nReturn ONLY JSON with action equal to call_tool, complete, or ask_approval. If calling a tool, include tool and input.`;
    const result = await this.chat(prompt);
    return JSON.parse(result) as Awaited<ReturnType<AgentProvider["decide"]>>;
  }

  private async chat(content: string): Promise<string> {
    if (!this.apiKey) throw new Error("ASHAI_API_KEY is not configured");
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [{ role: "user", content }],
      }),
    });
    if (!response.ok) throw new Error(`Model request failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as ChatResponse;
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Model returned no content");
    return text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  }
}
