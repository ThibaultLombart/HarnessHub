# HarnessHub

HarnessHub is a self-hosted Discord control plane for managing local Git workspaces and Pi coding sessions on an always-on Linux host. HarnessHub routes, validates, persists, and supervises; Pi remains responsible for coding work.

## MVP capabilities

- one configured Discord guild and administrator;
- idempotent `/setup` for a private `HARNESSHUB` category and `#workspace-management` channel;
- empty Git project creation or HTTPS/SSH repository cloning;
- one persisted project directory ↔ Discord channel mapping, with 🟢 idle, 🟡 working, and 🔴 blocked status suffixes;
- Pi detection, pinned non-root installation, and native authentication status;
- managed Pi package resources globally or per project for skills/extensions/prompts;
- persistent Pi RPC sessions in the exact project directory;
- ordinary project-channel messages as prompts;
- compact progress, stop/resume controls, process-crash handling, and restart reconciliation;
- a read-only Codex subscription-usage channel refreshed every 15 minutes and after prompts.

The MVP intentionally started small; the 1.0 path now adds managed Pi packages/skills, model selection, uploads, project lifecycle, job visibility, local Git controls, diagnostics, backup guidance, and Discord-assisted update checks. Native MCP, provider repository creation, and multi-user operation remain later work.

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

The interactive installer builds, validates, configures, installs Pi locally, and starts HarnessHub. Creating the Discord application and approving the native model-provider login remain explicit human trust steps. For a complete empty-VM walkthrough, follow [`docs/PROXMOX_VM_GUIDE.md`](docs/PROXMOX_VM_GUIDE.md). See [`docs/INSTALLATION.md`](docs/INSTALLATION.md) for concise prerequisites, options, and the manual procedure. Real credentials belong in `/etc/harnesshub/harnesshub.env`, never in this repository or Discord.

The principal Discord flow is:

1. `/setup`
2. `/project create name:<name> [repository:<https-or-ssh-url>]` in `#workspace-management`
3. `/harness detect` and `/harness auth`
4. optionally manage Pi packages with `/resource add`, `/resource list`, and `/resource remove`
5. optionally inspect/select project models with `/model list`, `/model status`, `/model set`, and `/model reset`
6. send a normal message in the project channel and follow live progress updates
7. use `/session stop` or `/session resume` when needed

Useful operations include `/project status`, `/project archive`, `/project delete`, `/git status`, `/git link`, `/files upload`, `/jobs list`, `/repair status`, `/backup status`, `/mcp status`, and `/system status`.

## Project documentation

- `AGENTS.md` — development and validation contract
- `PROJECT.md` — product and architecture source of truth
- `docs/PROXMOX_VM_GUIDE.md` — complete Proxmox VM installation tutorial
- `docs/INSTALLATION.md` — concise installer and manual-installation guide
- `docs/DISCORD_COMMANDS.md` — complete Discord command reference
- `docs/ROADMAP.md` — vertical milestones
- `docs/SECURITY.md` — security invariants
- `docs/DECISIONS.md` — durable decisions
- `docs/DEVELOPMENT_GIT.md` — mandatory Git workflow
- `docs/CURRENT_STATE.md` — verified current state and limitations
