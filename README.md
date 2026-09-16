# AshAI

**Mission Engine — give the system a goal, not a prompt.**

AshAI is an agent-runtime foundation for long-running, goal-driven AI work. The core abstraction is a **Mission**:

```text
Goal
  ↓
Plan
  ↓
Execute tools
  ↓
Inspect results
  ↓
Verify
  ↓
Deliver
```

## Architecture

```text
                 MISSION
                    │
             ┌──────▼──────┐
             │   Planner   │
             └──────┬──────┘
                    │
             ┌──────▼──────┐
             │   Runtime   │◄──── persistent event stream
             └──────┬──────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     Tools       Sandbox     Providers
        │           │           │
        └───────────┼───────────┘
                    ▼
                 Verify
                    │
                    ▼
                Deliverable
```

## Current vertical slice

The repository intentionally starts small and safe:

- mission and step state model
- deterministic planner contract ready for an LLM planner
- tool registry
- event-driven mission runtime
- workspace inspection tool
- execution adapter boundary (no arbitrary shell execution yet)
- verification step

## Run locally

```bash
npm install
npm run dev -- "Analyze this workspace and identify the next useful action"
```

## Design principles

1. **Goal over prompt** — users describe outcomes.
2. **Execution over generation** — agents should perform work, not only describe it.
3. **Provider agnostic** — the runtime should not depend on one model vendor.
4. **Tools are explicit capabilities** — every external action has a contract.
5. **Approval is a first-class state** — risky actions can pause a mission.
6. **Everything important becomes an event** — missions should be inspectable and resumable.
7. **Verification is mandatory** — completion means evidence, not just a model saying “done”.

## Roadmap

- [ ] LLM planner/provider adapter
- [ ] persistent PostgreSQL mission store
- [ ] streaming event API
- [ ] isolated sandbox execution
- [ ] approval gates
- [ ] GitHub workspace toolset
- [ ] artifact/deliverable store
- [ ] mission resume/retry/checkpointing
- [ ] web control plane
- [ ] multi-agent delegation

## Status

Early foundation. The runtime is deliberately being built before the UI so the product is based on a real execution engine rather than a chatbot shell.
