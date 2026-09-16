# AshAI

**Mission Engine — give the system a goal, not a prompt.**

AshAI is an agent-runtime foundation for long-running, goal-driven AI work. The core abstraction is a **Mission**:

```text
Goal
  ↓
AI Plan
  ↓
Execute tools
  ↓
Collect evidence
  ↓
AI Synthesis
  ↓
Findings + Recommendations
  ↓
Deliverable
```

## Architecture

```text
                 MISSION
                    │
             ┌──────▼──────┐
             │   Planner   │  ← Groq structured output
             └──────┬──────┘
                    │
             ┌──────▼──────┐
             │   Runtime   │  ← event timeline
             └──────┬──────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     Tools       Sandbox     Providers
        │           │           │
        └───────────┼───────────┘
                    ▼
             ┌──────────────┐
             │   Synthesis  │  ← evidence-based final analysis
             └──────┬───────┘
                    ▼
               Deliverable
```

## Current vertical slice

The repository now contains a working model-driven mission execution path:

- mission and step state model
- Groq LLM planner with strict structured output
- explicit tool registry
- event-driven mission runtime
- workspace inspection and file-reading tools
- controlled command execution adapter
- verification tool
- mutation approval flag for write operations
- collection of tool results across a mission
- bounded synthesis context to prevent oversized model requests
- Groq final synthesis with structured findings, recommendations, and next action
- deterministic synthesis fallback when no model provider is configured
- inspectable mission timeline

The runtime deliberately does **not** make a redundant model decision call after every planned step. The planner produces explicit tool inputs, the runtime executes them, and one final model call analyzes the collected evidence. This avoids coupling structured-output synthesis to provider-native tool calling.

## Run locally

Set the Groq-compatible API key in your environment:

```bash
export ASHAI_API_KEY="your-key"
```

Then:

```bash
npm install
npm run typecheck
npm run build
npm run dev -- "Inspect this project, read the README, run the typecheck, and tell me what needs improvement"
```

The final mission object contains both a structured `synthesis` and a formatted `result`.

## Design principles

1. **Goal over prompt** — users describe outcomes.
2. **Execution over generation** — agents should perform work, not only describe it.
3. **Provider agnostic** — the runtime should not depend on one model vendor.
4. **Tools are explicit capabilities** — every external action has a contract.
5. **Approval is a first-class state** — risky actions can pause a mission.
6. **Everything important becomes an event** — missions should be inspectable and resumable.
7. **Verification is mandatory** — completion means evidence, not just a model saying “done”.
8. **Evidence before synthesis** — final recommendations should be grounded in actual tool output.

## Roadmap

- [x] LLM planner/provider adapter
- [x] mission result synthesis
- [ ] persistent PostgreSQL mission store
- [ ] streaming event API
- [ ] isolated sandbox execution
- [ ] approval gates with resume API
- [ ] GitHub workspace toolset
- [ ] artifact/deliverable store
- [ ] mission retry/checkpointing
- [ ] web control plane
- [ ] multi-agent delegation

## Status

Early but functional foundation. AshAI can now turn a natural-language goal into an LLM-generated execution plan, run explicit workspace tools, collect evidence, and produce a structured final analysis. The runtime is deliberately being built before the UI so the product is based on a real execution engine rather than a chatbot shell.

**Important:** the current command executor is a development guardrail, not a production-grade sandbox. Production isolation is a separate roadmap item.
