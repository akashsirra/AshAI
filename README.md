# AshAI

**Mission Engine — give the system a goal, not a prompt.**

AshAI turns an outcome into an executable mission: plan the work, call explicit tools, collect evidence, verify it, pause risky actions for approval, persist the mission, and produce a grounded deliverable.

```text
Goal → Planner → Mission Runtime → Tools → Evidence → Verification → Synthesis → Deliverable
                         │                 │
                         ├── persistence  ├── approval / resume
                         ├── retry        └── event timeline
                         └── HTTP control plane
```

## What is implemented

- Model-driven Groq planner with strict structured output
- Provider abstraction for model portability
- Explicit workspace tool registry
- Safe path confinement for workspace file access
- Allowlisted development command execution
- Verification tool
- Evidence collection passed to final synthesis
- Evidence-grounded structured synthesis with deduplication and bounded context
- Durable local JSON mission/event store with a production-store interface
- Resumable approval flow for mutation tools
- Mission retry/checkpoint behavior
- Artifact store for generated deliverables
- HTTP API and browser control plane
- Health endpoint and mission/event endpoints
- Runtime tests for execution, persistence, and approval/resume
- GitHub Actions typecheck, build, tests and smoke verification

## Run

```bash
cp .env.example .env
# put your Groq-compatible key in ASHAI_API_KEY
npm install
npm run typecheck
npm run build
npm test
npm run server
```

Open `http://localhost:8787` for Mission Control.

CLI mode:

```bash
npm run dev -- "Inspect this project, verify it, and explain what should improve first"
```

Mutation tools remain blocked unless the mission is explicitly approved or `ASHAI_ALLOW_MUTATIONS=true` is set.

## API

- `GET /api/health` — runtime health/provider status
- `GET /api/missions` — persisted missions
- `POST /api/missions` — create and optionally run a mission (`goal`, `workspace`, `autoRun`)
- `GET /api/missions/:id` — mission plus timeline
- `GET /api/missions/:id/events` — event timeline
- `POST /api/missions/:id/approve` — approve and resume a waiting mission
- `POST /api/missions/:id/retry` — retry failed steps

## Architecture boundaries

The runtime is deliberately provider-agnostic. Groq currently supplies planning and synthesis. The execution layer only operates through registered tools, so new capabilities can be added without coupling them to the model.

The local JSON store is the development durability layer. `MissionStore` is the seam for a PostgreSQL implementation when AshAI is deployed as a multi-user service. The current command runner is an allowlist-based development guardrail, **not** an OS/container sandbox; production execution of untrusted code requires real isolation.

The `AgentProvider.decide()` contract exists for future closed-loop autonomous execution, but the stable default path is intentionally deterministic after planning: the model creates an explicit plan, the runtime executes it, then the model synthesizes evidence. This avoids redundant model/tool calls and keeps execution inspectable.

## Product direction

AshAI is being built toward a general mission system rather than a chat wrapper:

1. **Mission** — persistent goal and state
2. **Planning** — model creates an executable plan
3. **Execution** — specialist tools perform work
4. **Evidence** — every important action becomes inspectable
5. **Verification** — results are checked before delivery
6. **Approval** — risky actions pause instead of silently mutating the workspace
7. **Recovery** — checkpoint/retry/resume rather than starting over
8. **Artifacts** — outputs become durable deliverables
9. **Control plane** — missions can be launched and inspected over HTTP/web
10. **Scale** — PostgreSQL, isolated containers, GitHub integrations, streaming events and multi-agent delegation can replace the local adapters without changing the mission abstraction

## Status

AshAI is a working engine prototype with a durable local runtime and web control plane. It is not yet a production SaaS or a secure untrusted-code sandbox.
