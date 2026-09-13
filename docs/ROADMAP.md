# HarnessHub Roadmap

The roadmap is ordered by **usable vertical slices**, not by technical layers built in advance.

Implementation exists for the M0–M3 MVP path and for a large part of the 1.0 control-plane ergonomics on `feat/resource-management`. Automated checks cover core and infrastructure contracts; the original happy path has been operator-validated on a real Linux/systemd VM, Discord guild, and authenticated Pi provider. New 1.0-oriented commands still require live regression before release; `docs/CURRENT_STATE.md` records evidence and reservations.

## M0 — Executable foundation

Goal: a clean, testable, persistent local service.

Status: **implemented and automated-test validated**.

- initialize TypeScript/Node;
- configuration + validation;
- structured logging with redaction;
- SQLite + migrations;
- minimal Job model;
- internal health check;
- non-root Linux/systemd service packaging and operator setup documentation;
- local quality gates: format/lint/typecheck/tests/build.

## M1 — Discord bootstrap

Goal: connect one guild and create the workspace.

Status: **implemented and live-validated for the happy path**.

- bot connection;
- one configured guild and administrator allowlist;
- `/setup`;
- HarnessHub category;
- `#workspace-management`;
- idempotent bootstrap;
- persistence of Discord IDs.

## M2 — Local project

Goal: create a project that can actually be managed.

Status: **implemented; live happy path validated; real remote-clone validation still outstanding**.

- `/project create` for an empty project or HTTPS/SSH clone;
- name/slug and repository URL validation;
- directory inside workspace root;
- dedicated channel;
- DB record;
- automatic Git initialization for empty projects;
- clone using only service-account credentials, with no embedded URL credentials or automatic SSH host-key acceptance;
- `/project status`, including explicit degraded state for missing mapped resources;
- coherent rollback on partial failure.

## M3 — Minimal PiAdapter

Goal: talk to Pi from a project channel.

Status: **implemented and live happy-path validated**.

- detection/version;
- capability model;
- start in the correct cwd;
- authorized ordinary project-channel message → prompt → events → compact Discord response;
- live progress updates without token-by-token Discord streaming;
- reject a concurrent prompt with a clear busy response;
- stop/resume interactions;
- session state;
- handled process crash;
- use Pi's existing/default model and detected native service-account authentication.

## M4 — Authentication and models

Goal: extend native auth-status detection with model visibility and project model choice.

Status: **partially implemented on `feat/resource-management`**.

Implemented:

- auth status;
- available models through `/model list`;
- project model status through `/model status`;
- project/session model selection through `/model set`;
- reset to Pi default through `/model reset`;
- model choice persisted per project;
- log/error redaction constraints preserved.

Remaining:

- Discord-assisted native login flow;
- richer thinking/reasoning-level selection if exposed by the harness;
- live validation of model switching on the VM.

## M5 — Remote Git

Goal: connect projects to GitHub/GitLab.

Status: **local Git inspection/linking implemented; provider workflows remaining**.

Implemented:

- `/git status`;
- `/git remote`;
- `/git link` with safe URL validation and no overwrite of existing origin.

Remaining:

- GitHub through `gh`;
- GitLab through `glab`;
- provider auth status;
- create repository after confirmation;
- remote push/pull status;
- explicit provider errors and conflicts.

## M6 — Skills, resources, and files

Goal: genuinely prepare a project from Discord.

Status: **partially implemented on `feat/resource-management`**.

Implemented:

- managed Pi packages through `/resource add`, `/resource list`, `/resource remove`;
- global/project resource scope;
- visible source and persisted installation state;
- bounded individual file upload through `/files upload`;
- traversal, absolute path, symlink escape, overwrite, and size protection.

Remaining:

- inspected ZIP + safe extraction;
- explicit resource enable/disable without removal when supported;
- richer package/source inspection before install;
- harness configuration file templates;
- live validation with trusted real Pi package sources.

## M7 — MCP + second harness

Goal: validate the abstraction instead of theorizing about it.

Status: **MCP status implemented; native MCP registry and second harness remaining**.

Implemented:

- `/mcp status` explains current Pi capability and points to packages/extensions.

Remaining:

- minimal generic MCP registry/config;
- support only when the adapter declares it;
- secrets excluded from logs;
- implement a real second `HarnessAdapter` chosen at that point;
- refine the abstraction based on observed differences.

## M8 — Project lifecycle and observability

Goal: make day-to-day operation safe and visible.

Status: **mostly implemented on `feat/resource-management`**.

Implemented:

- enriched `/project status` dashboard;
- `/project archive` with exact slug confirmation;
- `/project delete` with exact slug confirmation;
- active-session and dirty-Git deletion protections;
- `/jobs list` and `/jobs status`;
- `/repair status` degraded mapping diagnosis;
- `/backup status` backup/restore guidance;
- `/system status` runtime status.

Remaining:

- actual repair actions after operator confirmation;
- backup creation helper and restore test automation;
- project user permissions beyond the single administrator;
- live validation of lifecycle commands.

## M9 — Update operations

Goal: make test/dev updates easier while preserving safety.

Status: **implemented with host-authorization reservation**.

Implemented:

- `/system update-check`;
- `/system update-apply confirm:UPDATE`;
- clean checkout requirement;
- fast-forward-only update;
- `npm ci`, `npm run check`, installer execution;
- safe failure when sudo/root host policy does not authorize the operation.

Remaining:

- decide and document the production authorization mechanism: sudoers rule or dedicated root-owned helper;
- live validation on the VM;
- rollback reporting in Discord after installer failure.

## Scope rule

Do not start M(n+1) to avoid finishing M(n). One exception is allowed for a short spike that reduces a documented blocking risk.
