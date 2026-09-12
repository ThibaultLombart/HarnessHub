# HarnessHub Roadmap

The roadmap is ordered by **usable vertical slices**, not by technical layers built in advance.

## M0 — Executable foundation

Goal: a clean, testable, persistent local service.

- initialize TypeScript/Node;
- configuration + validation;
- structured logging with redaction;
- SQLite + migrations;
- minimal Job model;
- internal health check;
- local quality gates: format/lint/typecheck/tests/build.

**Done when:** the service starts against an empty database, migrates cleanly, restarts with its state intact, and passes all gates.

## M1 — Discord bootstrap

Goal: connect one guild and create the workspace.

- bot connection;
- admin allowlist;
- `/setup`;
- HarnessHub category;
- `#workspace-management`;
- idempotent bootstrap;
- persistence of Discord IDs.

**Done when:** running `/setup` twice creates no duplicates and a reboot preserves the mapping.

## M2 — Local project

Goal: create a project that can actually be managed.

- `/project create`;
- name/slug validation;
- directory inside workspace root;
- dedicated channel;
- DB record;
- Git initialization according to the discovery decision;
- `/project status`;
- coherent rollback on partial failure.

**Done when:** creation, errors, reboot, and the decided delete/archive flow are tested without silent desynchronization.

## M3 — Minimal PiAdapter

Goal: talk to Pi from a project channel.

- detection/version;
- capability model;
- RPC vs SDK spike;
- start in the correct cwd;
- prompt → events → Discord response;
- stop;
- session state;
- handled process crash.

**Done when:** two distinct projects never mix cwd, sessions, or messages.

## M4 — Authentication and models

Goal: use the harness's native login mechanisms.

- auth status;
- Discord-compatible login flow;
- no unnecessary secret duplication;
- available models;
- project/session model selection according to Pi capabilities;
- log redaction.

## M5 — Remote Git

Goal: connect projects to GitHub/GitLab.

- GitHub through `gh`;
- GitLab through `glab`;
- auth status;
- link existing repository;
- create repository after confirmation;
- remote/status;
- explicit errors and conflicts.

## M6 — Skills and files

Goal: genuinely prepare a project from Discord.

- global/project skills;
- visible source and compatibility;
- simple uploads;
- inspected ZIP + safe extraction;
- overwrite/conflict policy;
- harness configuration files.

## M7 — MCP + second harness

Goal: validate the abstraction instead of theorizing about it.

- minimal generic MCP registry/config;
- support only when the adapter declares it;
- secrets excluded from logs;
- implement a real second `HarnessAdapter` chosen at that point;
- refine the abstraction based on observed differences.

## Scope rule

Do not start M(n+1) to avoid finishing M(n). One exception is allowed for a short spike that reduces a documented blocking risk.
