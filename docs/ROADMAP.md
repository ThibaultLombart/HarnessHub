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
- non-root Linux/systemd service packaging and operator setup documentation;
- local quality gates: format/lint/typecheck/tests/build.

**Done when:** the service starts against an empty database, migrates cleanly, restarts with its state intact, has a verifiable non-root systemd installation path, and passes all gates.

## M1 — Discord bootstrap

Goal: connect one guild and create the workspace.

- bot connection;
- one configured guild and administrator allowlist;
- `/setup`;
- HarnessHub category;
- `#workspace-management`;
- idempotent bootstrap;
- persistence of Discord IDs.

**Done when:** running `/setup` twice creates no duplicates and a reboot preserves the mapping.

## M2 — Local project

Goal: create a project that can actually be managed.

- `/project create` for an empty project or HTTPS/SSH clone;
- name/slug and repository URL validation;
- directory inside workspace root;
- dedicated channel;
- DB record;
- automatic Git initialization for empty projects;
- clone using only service-account credentials, with no embedded URL credentials or automatic SSH host-key acceptance;
- `/project status`, including explicit degraded state for missing mapped resources;
- coherent rollback on partial failure.

**Done when:** empty creation, cloning, unsafe input, partial failures, manual mapping drift, and reboot are tested without silent desynchronization.

## M3 — Minimal PiAdapter

Goal: talk to Pi from a project channel.

- detection/version;
- capability model;
- RPC vs SDK spike;
- start in the correct cwd;
- authorized ordinary project-channel message → prompt → events → compact Discord response;
- reject a concurrent prompt with a clear busy response;
- stop/resume interactions;
- session state;
- handled process crash;
- use Pi's existing/default model and detected native service-account authentication.

**Done when:** two distinct projects never mix cwd, sessions, or messages; concurrent prompts do not overlap; and no model output or sensitive process detail is leaked to the wrong channel.

## M4 — Authentication and models

Goal: extend the MVP's native auth-status detection with Discord-assisted login and model choice.

- auth status;
- Discord-compatible native login flow;
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
- bounded individual file uploads;
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
