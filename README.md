# HarnessHub

HarnessHub is a self-hosted control plane operated from Discord for managing development workspaces and their coding harnesses.

The goal is simple: let an always-on VM handle development work while projects are managed remotely from Discord, without turning HarnessHub into another AI agent.

## Reference documents

1. `AGENTS.md` — general quality contract for AI development agents.
2. `PROJECT.md` — HarnessHub product vision and architecture.
3. `docs/CURRENT_STATE.md` — actual project state and next step.
4. `docs/ROADMAP.md` — MVP construction order.
5. `docs/SECURITY.md` — project-specific security invariants.
6. `docs/DECISIONS.md` — durable architecture/product decisions.
7. `docs/DEVELOPMENT_GIT.md` — mandatory Git workflow during development.
8. `START_HERE.md` — recommended first prompt for Pi.

## Pi

Pi agent configs live in `.pi/agents/`:

- `orchestrator` — primary agent;
- `explorer` — read-only repository exploration;
- `implementer` — focused implementation;
- `reviewer` — independent review and verification;
- `security` — audit of trust-sensitive surfaces.

The project deliberately starts with Pi as the first supported harness. The architecture must allow additional harnesses without pretending they all support the same capabilities.
