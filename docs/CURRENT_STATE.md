# Current State

## Status

**MVP happy path implemented and live-validated; the active `fix/audit-reliability` branch hardens the 1.0 control-plane work before release.**

The base MVP was validated on a real Linux/systemd VM, Discord guild, and authenticated Pi provider. The current audit branch is locally validated on Windows and still requires the feature-branch CI Linux matrix and a full live Discord/systemd regression test before release.

## Implemented in the base MVP

- strict TypeScript service foundation with formatting, linting, type checking, tests, build, and dependency audit scripts;
- runtime-validated configuration and structured logging with credential redaction;
- built-in SQLite persistence, transactional migrations, jobs, workspace/project/session mappings, and restart reconciliation;
- one-guild/one-administrator application-layer authorization;
- idempotent Discord workspace setup and private category/channel provisioning;
- atomic empty Git project creation and validated HTTPS/SSH cloning without shell interpolation;
- explicit degraded state for missing, renamed, moved, or unsafe mapped resources;
- explicit Pi capabilities, detection, pinned non-root installation, and native auth-status reporting;
- supervised Pi RPC subprocesses with strict JSONL framing, persistent session IDs, concurrency limits, stop/resume, and crash recovery;
- ordinary project-channel prompts with compact bounded Discord output;
- live Pi progress dashboard showing the observable stage, active and recent actions, turn/action/failure/retry/compaction counts, action and total timing, possible-stall warning, and the actual model reported by Pi;
- non-root systemd unit, installation documentation, and an interactive idempotent `sudo ./scripts/install.sh` installer with protected credential input and rollback copies;
- Discord startup waits for `ClientReady`, documents the required channel/role permissions, and reports missing setup permissions clearly.

## Implemented in the current 1.0 branch line

- managed Pi package resources through `/resource add`, `/resource list`, and `/resource remove`;
- resource scopes: `global` and `project`;
- validated resource sources: `npm:`, `git:`, safe HTTPS, and safe SSH;
- persistent resource state: `installed`, `failed`, `removed`;
- project model management through `/model list`, `/model status`, `/model set`, and `/model reset`;
- per-project model preference persisted in SQLite and supplied to Pi sessions via `--model provider/model-id`;
- locked Codex voice counter showing free percentages for short and weekly subscription windows, refreshed every 15 minutes and after prompts;
- project channel names synchronized with session state: 🟢 idle, 🟡 working, and 🔴 failed/stopped/degraded;
- confirmation-gated `/session restart` that refuses active prompts, recreates the Pi process, preserves session history, and reloads resources;
- project archive/delete commands with exact slug confirmation;
- deletion protections for active sessions and dirty Git worktrees;
- enriched `/project status` dashboard with model, remote, resources, and recent jobs;
- job inspection through `/jobs list` and `/jobs status`;
- local Git inspection/linking through `/git status`, `/git remote`, and `/git link`;
- safe single-file upload through `/files upload` with path traversal, symlink escape, size, and overwrite protections;
- degraded mapping diagnosis through `/repair status`;
- backup guidance through `/backup status`;
- MCP capability status through `/mcp status`;
- runtime status through `/system status`;
- Discord-triggered update check through `/system update-check`; update apply is intentionally disabled. Installation, updates, and rollback are manual trusted-checkout operator procedures, without service-account installer privileges.

See [`DISCORD_COMMANDS.md`](DISCORD_COMMANDS.md) for command usage and security notes.

## Automated evidence

The suite uses real temporary SQLite databases, real temporary filesystems and local Git repositories, controlled child processes, fake application ports, and a protocol-faithful fake Pi process. A read-only handshake was also executed against installed Pi `0.85.1` using an empty temporary Pi configuration; detection and `get_available_models` RPC succeeded without invoking a model.

Current branch automated validation records local command results only; they do not prove that a deployment, live Discord regression, or Linux CI run has completed.

- `npm run check` passes on Windows;
- 31 test files pass;
- 173 tests pass;
- format, strict lint, typecheck, Vitest, and production build pass;
- `npm run test:coverage` passes on Windows;
- `npm audit --audit-level=moderate` reports 0 vulnerabilities;
- feature-branch push CI is configured for Ubuntu and Windows Node 22/24, but the Linux matrix is pending until the lead pushes this branch.

## Live evidence

On a dedicated Linux/systemd VM, operator-provided logs and acceptance confirmation established that the base MVP happy path works:

- the health checks pass and the service remains active under systemd;
- a real Discord bot authenticates, reaches `ClientReady`, and registers guild commands;
- `/setup` creates the private Discord workspace after granting the documented least-required permissions;
- Pi detection and native provider authentication work under the service identity;
- project creation and an ordinary Discord message complete the Discord → HarnessHub → Pi happy path.

The live exercise exposed and resolved incorrect application artifact modes, inherited stale Pi-session context, optional-login failure semantics, premature Discord readiness checking, and an undocumented `Manage Roles` requirement.

## Remaining reservations before 1.0 release

- run a full live regression of all new commands from `feat/resource-management` on the VM;
- validate real Pi package install/remove from at least one trusted package source;
- validate real project model switch against the authenticated provider;
- validate the Codex quota endpoint and Discord channel rename against a real OpenAI OAuth subscription (the endpoint is unofficial and may change);
- validate Unicode project-status channel renames against the live Discord guild;
- validate `/project delete` on a disposable project and confirm dirty-Git protection;
- validate `/files upload` from Discord with normal and rejected paths;
- validate `/system update-check`; keep installation, update, and rollback manual, with update apply disabled and no service-account privileged installer permissions;
- validate HTTPS/SSH cloning and `/git link` against real remotes using service-account credentials;
- record `systemd-analyze security` output;
- capture and restore a real backup from `/backup status` guidance, including stopping the service, copying `/var/lib/harnesshub` and the workspace root, restoring them to a disposable host or state directory, verifying ownership/modes, starting the service, and checking `/repair status`, `/backup status`, and a disposable project before trusting the backup.

The current state is **Validated with reservations**: automated checks are green, the MVP happy path has live evidence, and new 1.0-oriented commands require operator live validation.
