import type { ModelProvider } from "./model-provider.js";
import type { MissionSynthesis, MissionStep } from "./types.js";

interface GeminiProviderOptions { apiKey?: string; baseUrl?: string; model?: string; }
type AgentAction = "call_tool" | "complete" | "ask_approval";
const TOOL_NAMES = ["workspace.inspect", "workspace.find_files", "workspace.search", "workspace.read_file", "workspace.execute", "workspace.verify", "workspace.write_file"] as const;
type ToolName = (typeof TOOL_NAMES)[number];

const plannerSchema = { type: "object", additionalProperties: false, properties: { steps: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, tool: { type: ["string", "null"], enum: [...TOOL_NAMES, null] }, input: { type: "string" } }, required: ["id", "title", "description", "tool", "input"] } } }, required: ["steps"] } as const;
const decisionSchema = { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["call_tool", "complete", "ask_approval"] }, tool: { type: ["string", "null"], enum: [...TOOL_NAMES, null] }, input: { type: "string" }, summary: { type: "string" } }, required: ["action", "tool", "input", "summary"] } as const;
const synthesisSchema = { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, findings: { type: "array", items: { type: "string" } }, recommendations: { type: "array", items: { type: "string" } }, nextAction: { type: "string" } }, required: ["summary", "findings", "recommendations", "nextAction"] } as const;

function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "additionalProperties") continue;
    if (key === "type" && Array.isArray(value)) {
      const types = value.filter(v => typeof v === "string');
      output.type = types.find(v => v !== "null") ?? "string";
      if (types.includes("null")) output.nullable = true;
      continue;
    }
    output[key] = geminiSchema(value);
  }
  return output;
}

function defaultInput(tool?: ToolName): unknown {
  switch (tool) {
    case "workspace.inspect":
    case "workspace.find_files": return { path: "." };
    case "workspace.read_file": return { path: "README.md" };
    case "workspace.execute":
    case "workspace.verify": return { command: "npm run typecheck" };
    case "workspace.search": return { pattern: "TODO|FIXME", regex: true, max: 50 };
    default: return undefined;
  }
}

function parseInput(raw: unknown, tool?: ToolName): unknown {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return defaultInput(tool);
  let value = raw.trim();
  if (value.startsWith("```") && value.endsWith("```")) value = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { let parsed: unknown = JSON.parse(value); if (typeof parsed === "string") parsed = JSON.parse(parsed); return parsed; }
  catch { return defaultInput(tool); }
}

export class GeminiProvider implements ModelProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ASHAI_GEMINI_API_KEY ?? "";
    this.baseUrl = (options.baseUrl ?? process.env.ASHAI_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    this.model = options.model ?? process.env.ASHAI_GEMINI_MODEL ?? "gemini-3.8-flash";
    if (!this.apiKey) throw new Error("ASHAI_GEMINI_API_KEY is required when using the Gemini provider.");
  }

  async plan(goal: string): Promise<MissionStep[]> {
    const system = ["You are AshAI's mission planner. Create a concise executable plan and return structured JSON only.", "For repository analysis, use workspace.find_files early so you know what exists; then read exact files and search targeted evidence.", "Use workspace.verify or workspace.execute for verification. For execute use {\"command\":\"npm run typecheck\"}; inspect {\"path\":\".\"}; find_files {\"path\":\".\",\"max\":300}; search {\"pattern\":\"...\"}.", "Use workspace.write_file only when the user explicitly requests changes. Never infer absence from lack of inspection.", "For every tool step, input is a JSON object encoded as a string. If you cannot provide valid JSON, use an empty string and AshAI will apply a safe tool default."] .join(" ");
    const parsed = JSON.parse(await this.chat(system, goal, plannerSchema)) as Record<string, unknown>;
    if (!Array.isArray(parsed.steps)) throw new Error("Gemini planner returned no steps array.");
    return parsed.steps.map((item, index) => { if (!item || typeof item !== "object") throw new Error(`Invalid plan step ${index}.`); const value = item as Record<string, unknown>; const tool = typeof value.tool === "string" && TOOL_NAMES.includes(value.tool as ToolName) ? value.tool as ToolName : undefined; return { id: typeof value.id === "string" ? value.id : `step-${index + 1}`, title: typeof value.title === "string" ? value.title : `Step ${index + 1}`, description: typeof value.description === "string" ? value.description : goal, status: "pending" as const, tool, input: parseInput(value.input, tool), requiresApproval: tool === "workspace.write_file" }; });
  }

  async synthesize(input: { goal: string; steps: MissionStep[]; toolResults: Record<string, unknown> }): Promise<MissionSynthesis> {
    const system = ["You are AshAI's evidence-grounded final analyst. Use ONLY the supplied goal, steps, and tool results.", "Every factual finding must be directly supported by supplied evidence. Never invent files, commands, errors, tests, CI configuration, APIs, or missing capabilities.", "Positive evidence overrides generic assumptions: if supplied evidence shows a build, test, CI workflow, or script exists, never claim that it does not exist.", "Never treat an uninspected item as absent; if evidence is insufficient say not verified. Separate observations from recommendations.", "Do not repeat findings. Return at most 10 findings and 8 recommendations, concise and actionable.", "Return structured JSON only."].join(" ");
    const context = JSON.stringify({ goal: input.goal, steps: input.steps.map(({ id, title, description, status, tool, input: stepInput }) => ({ id, title, description, status, tool, input: stepInput })), toolResults: input.toolResults });
    const parsed = JSON.parse(await this.chat(system, context, synthesisSchema)) as Record<string, unknown>;
    const strings = (value: unknown, field: string): string[] => { if (!Array.isArray(value) || !value.every(item => typeof item === "string")) throw new Error(`Gemini synthesis returned invalid ${field}.`); return value as string[]; };
    if (typeof parsed.summary !== "string" || typeof parsed.nextAction !== "string") throw new Error("Gemini synthesis returned an invalid summary or nextAction.");
    return { summary: parsed.summary, findings: strings(parsed.findings, "findings"), recommendations: strings(parsed.recommendations, "recommendations"), nextAction: parsed.nextAction };
  }

  async decide(input: { goal: string; step: MissionStep; toolResult?: unknown }): Promise<Awaited<ReturnType<ModelProvider["decide"]>>> {
    const system = ["You are AshAI's bounded execution controller.", "Use call_tool only when another concrete evidence or verification action is useful; otherwise complete.", "Use ask_approval for mutations when approval is required.", "Return structured JSON only. For call_tool, input is a JSON object encoded as a string."] .join(" ");
    const decision = JSON.parse(await this.chat(system, JSON.stringify(input), decisionSchema)) as Record<string, unknown>;
    const action = decision.action; if (action !== "call_tool" && action !== "complete" && action !== "ask_approval") throw new Error(`Gemini returned invalid agent action: ${String(action)}`);
    const tool = typeof decision.tool === "string" && TOOL_NAMES.includes(decision.tool as ToolName) ? decision.tool as ToolName : undefined;
    return { action: action as AgentAction, tool, input: parseInput(decision.input, tool), summary: typeof decision.summary === "string" ? decision.summary : undefined };
  }

  private async chat(system: string, user: string, schema: unknown): Promise<string> {
    const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { responseMimeType: "application/json", responseSchema: geminiSchema(schema), temperature: 0.1 } })
    });
    if (!response.ok) { const body = await response.text(); throw new Error(`Gemini request failed (${response.status}): ${body}`); }
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const content = payload.candidates?.[0]?.content?.parts?.map(part => part.text ?? "").join("").trim();
    if (!content) throw new Error("Gemini returned no message content.");
    return content;
  }
}
