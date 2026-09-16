import type { ModelProvider } from "./model-provider.js";

/** Tries configured model providers in order and fails over on transient or provider errors. */
export class ProviderRouter implements ModelProvider {
  constructor(private readonly providers: Array<{ name: string; provider: ModelProvider }>) {
    if (!providers.length) throw new Error("ProviderRouter requires at least one provider.");
  }

  private async run<T>(operation: string, fn: (provider: ModelProvider) => Promise<T>): Promise<T> {
    const errors: string[] = [];
    for (const { name, provider } of this.providers) {
      try { return await fn(provider); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${name}: ${message}`);
      }
    }
    throw new Error(`All AshAI model providers failed during ${operation}. ${errors.join(" | ")}`);
  }

  plan(goal: string) { return this.run("planning", provider => provider.plan(goal)); }
  decide(input: Parameters<ModelProvider["decide"]>[0]) { return this.run("agent decision", provider => provider.decide(input)); }
  synthesize(input: Parameters<ModelProvider["synthesize"]>[0]) { return this.run("synthesis", provider => provider.synthesize(input)); }
}
