# HarnessHub

HarnessHub is a self-hosted Discord control plane for managing local Git workspaces and Pi coding sessions on an always-on Linux host. HarnessHub routes, validates, persists, and supervises; Pi remains responsible for coding work.

## MVP capabilities

- one configured Discord guild and administrator;
- idempotent `/setup` for a private `HARNESSHUB` category and `#workspace-management` channel;
- empty Git project creation or HTTPS/SSH repository cloning;
- one persisted project directory ↔ Discord channel mapping;
- Pi detection, pinned non-root installation, and native authentication status;
- persistent Pi RPC sessions in the exact project directory;
- ordinary project-channel messages as prompts;
- compact progress, stop/resume controls, process-crash handling, and restart reconciliation.

Skills, MCP, uploads, provider repository management, model selection, and multi-user operation are deliberately outside this MVP.

## Development

Requires Node.js 22.5–24 and Git.

```bash
npm ci
npm run check
```

The checks cover formatting, strict linting, type checking, unit/integration tests, and the production build. Runtime configuration is documented in `.env.example`.

## Install and operate

From a trusted checkout on a Linux/systemd host:

```bash
sudo ./scripts/install.sh
```

The interactive installer builds, validates, configures, installs Pi locally, and starts HarnessHub. Creating the Discord application and approving the native model-provider login remain explicit human trust steps. See [`docs/INSTALLATION.md`](docs/INSTALLATION.md) for prerequisites, options, and the manual procedure. Real credentials belong in `/etc/harnesshub/harnesshub.env`, never in this repository or Discord.

The principal Discord flow is:

1. `/setup`
2. `/project create name:<name> [repository:<https-or-ssh-url>]` in `#workspace-management`
3. `/harness detect` and `/harness auth`
4. send a normal message in the project channel
5. use `/session stop` or `/session resume` when needed

## Project documentation

- `AGENTS.md` — development and validation contract
- `PROJECT.md` — product and architecture source of truth
- `docs/ROADMAP.md` — vertical milestones
- `docs/SECURITY.md` — security invariants
- `docs/DECISIONS.md` — durable decisions
- `docs/DEVELOPMENT_GIT.md` — mandatory Git workflow
- `docs/CURRENT_STATE.md` — verified current state and limitations
