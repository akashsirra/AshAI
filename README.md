# AshAI

**Mission Engine — give the system a goal, not a prompt.**

AshAI is a model-driven agent-runtime foundation for goal-oriented AI work. The core abstraction is a **Mission**:

```text
Goal
  ↓
AI Planner
  ↓
Executable Plan
  ↓
Execute Explicit Tools
  ↓
Collect Evidence
  ↓
AI Synthesis
  ↓
Findings + Recommendations + Next Action
  ↓
Deliverable
```

## Architecture

```text
                 MISSION
                    │
             ┌──────▼──────┐
             │ AI Planner  │
             └──────┬──────┘
                    │
             ┌──────▼──────┐
             │   Runtime   │◄──── event timeline
             └──────┬──────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     Tools       Providers   Approval
        │           │           │
        └───────────┼───────────┘
                    ▼
             Evidence Collection
                    │
             ┌──────▼──────┐
             │ AI Synthesis│
             └──────┬──────┘
                    ▼
               Deliverable
```

## Current vertical slice

The repository now contains a working model-driven mission execution path:

- mission and step state model
- Groq LLM planner with strict structured output
- deterministic planner fallback
- explicit tool registry
- event-driven mission runtime
- workspace inspection and file-reading tools
- controlled command execution adapter
- verification tool
- mutation approval flag for write operations
- collection of tool results across a mission
- bounded synthesis context to prevent oversized model requests
- evidence-grounded Groq final synthesis with structured findings, recommendations, and next action
- deterministic synthesis fallback when no model provider is configured
- TypeScript typechecking/build and GitHub Actions CI

The runtime deliberately does **not** make a redundant model decision call after every planned step. The planner produces explicit tool inputs, the runtime executes them, and one final model call analyzes the collected evidence.

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
5. **Evidence before conclusions** — synthesis must distinguish observed facts from unverified assumptions.
6. **Approval is a first-class state** — risky actions can pause a mission.
7. **Everything important becomes an event** — missions should be inspectable and resumable.
8. **Verification matters** — execution results are collected before synthesis.

## Roadmap

- [x] LLM planner/provider adapter
- [x] model-driven mission synthesis
- [x] explicit workspace toolset
- [x] typecheck/build CI
- [ ] persistent PostgreSQL mission store
- [ ] streaming event API
- [ ] isolated sandbox execution
- [ ] full approval + resume workflow
- [ ] GitHub workspace toolset
- [ ] artifact/deliverable store
- [ ] mission retry/checkpointing
- [ ] web control plane
- [ ] multi-agent delegation

## Safety boundary

The current command executor is a development guardrail, not a production-grade sandbox. It uses an allowlist and blocks several mutation patterns, but commands such as Node/npm/git can have broader effects through their arguments. Production deployment should add OS/container-level isolation before accepting untrusted missions.

## Status

Early working foundation. AshAI now has a complete **plan → execute → evidence → synthesize → deliver** path. The next major engineering layers are persistence, real isolation, resumable approvals, and a control plane.
