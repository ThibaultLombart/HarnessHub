# HarnessHub — Project

> **Status:** MVP product decisions confirmed; implementation has not started.
> **Role:** product and architecture source of truth.
> **Development contract:** `AGENTS.md`.

## 1. Vision

HarnessHub is a **self-hosted control plane for coding harnesses, operated from Discord**.

It runs on an always-available VM or server. Discord becomes the remote interface for creating and managing projects, configuring their harness, and talking to the agent working inside each project.

HarnessHub is not an AI agent and must not orchestrate the internal development work of a project. The selected harness — Pi first — remains responsible for reasoning, coding, its sessions, and its internal orchestration.

### Summary

```text
Discord
   |
   v
HarnessHub
   |-- workspace / projects
   |-- Git / GitHub / GitLab
   |-- harness installation and configuration
   |-- authentication and models through harness-native mechanisms
   |-- skills / MCP / configuration files
   |-- process and job lifecycle
   |
   +--> Pi (V0)
   +--> other harnesses later
```

## 2. Target experience

### 2.1 Setup

The MVP targets one personal Linux VM, one Discord guild, and one administrator. The operator creates the Discord application and token out of band, configures the token, guild ID, administrator user ID, and workspace root locally, then runs HarnessHub as a non-root systemd service.

The administrator runs `/setup`. HarnessHub idempotently creates a workspace category containing at least:

```text
HARNESSHUB
├── #workspace-management
└── #<project-name>       // created as projects are added
```

`#workspace-management` is used for global operations: project creation or repository cloning, harness installation/detection, authentication status, system status, and jobs. Skills, MCP configuration, and uploads are post-MVP capabilities.

### 2.2 Project

By default:

```text
1 HarnessHub project = 1 local directory = 1 Discord channel
```

The mapping is persisted explicitly; it does not depend only on the channel name.

Example:

```text
#harnesshub <-> /srv/harnesshub/workspaces/harnesshub/
```

Inside a project channel, the user must be able to:

- view project status;
- select/configure the harness;
- perform required logins when a provider is not already authenticated globally;
- select a compatible model;
- install/enable skills;
- add MCP servers or equivalent mechanisms when supported by the harness;
- upload configuration files and archives;
- send prompts to the harness;
- follow meaningful execution events;
- stop/resume a session.

## 3. Non-negotiable principles

### 3.1 Discord is an interface

Durable state lives in the database, filesystem, Git, and native harness stores. Deleting a Discord message must never delete a project.

### 3.2 Pi first, multi-harness by design

The first usable version supports **Pi**.

The core must not directly depend on Pi. Differences between harnesses are represented as capabilities rather than hidden behind a fake universal interface.

### 3.3 HarnessHub does not replace the harness

HarnessHub routes, validates, supervises, and configures. It does not plan features, maintain competing AI memory, or decide how code should be written inside the repository.

### 3.4 Long-running operations are jobs

Clone, installation, update, extraction, complex configuration, and other long-running operations must expose observable state: `queued`, `running`, `succeeded`, `failed`, or `cancelled`.

### 3.5 Secure by default

The bot executes commands and manipulates credentials, repositories, and files. Every Discord input, archive, URL, project name, configuration, skill, MCP server, and repository is untrusted by default.

## 4. MVP scope

The MVP must provide one complete loop:

1. install and start HarnessHub as a non-root systemd service on one Linux VM;
2. connect the configured Discord guild and administrator;
3. run `/setup` to create or reuse the category and `#workspace-management`;
4. create either an empty project or a project cloned from an HTTPS/SSH Git URL;
5. create its directory and Discord channel;
6. initialize Git automatically for an empty project, or preserve the cloned repository;
7. select Pi as the harness;
8. detect Pi or install it through an explicit administrator action;
9. detect native provider authentication already configured for the service account;
10. start/resume a Pi session with Pi's default model in the exact project directory;
11. send an ordinary message from the mapped project channel as the first prompt;
12. display a compact answer and useful progress without token-by-token Discord streaming;
13. allow the active session to be stopped and reject concurrent prompts with a clear busy response;
14. survive a HarnessHub restart without losing the project/channel mapping.

MVP repository cloning uses credentials already configured for the non-root service account. HarnessHub rejects credentials embedded in repository URLs and does not accept Git credentials through Discord. Unknown SSH host keys fail with setup guidance rather than being trusted automatically.

### Included later in V1

- GitHub through `gh`, followed by GitLab through `glab`: authentication and repository creation/linking;
- Discord-assisted native provider login;
- model selection;
- global and project skills;
- secure individual file and ZIP uploads;
- generic MCP support through harness capabilities;
- compact project dashboard;
- stronger session/job recovery after crashes;
- adopting an existing local directory;
- a second real `HarnessAdapter` to validate the abstraction.

### Initially out of scope

- web UI;
- multi-tenant SaaS;
- Kubernetes;
- multi-server orchestration;
- custom secrets manager;
- public marketplace;
- automatic production deployment;
- general-purpose AI workflow engine;
- perfect code-execution sandboxing.

## 5. Architecture

Target logical architecture:

```text
Discord Gateway
      |
      v
Application / Use Cases
      |
      +----------------------+---------------------+
      |                      |                     |
      v                      v                     v
Project/Git             Harness Core          Jobs / State
      |                      |                     |
      v                      v                     v
FS + git + gh/glab      HarnessAdapter[]        SQLite
                             |
                             +--> PiAdapter
```

### 5.1 Layer rules

**Discord Gateway**
- receives interactions/messages/attachments;
- verifies identity and permissions;
- translates input into application use cases;
- renders embeds, buttons, menus, and progress;
- contains no critical business logic.

**Application / Use Cases**
- `SetupWorkspace`;
- `CreateProject`;
- `ImportProject`;
- `LinkRepository`;
- `SelectHarness`;
- `InstallSkill`;
- `ConfigureMcp`;
- `UploadProjectFiles`;
- `StartSession`;
- `SendPrompt`.

**Infrastructure**
- Discord;
- SQLite;
- filesystem;
- Git;
- GitHub/GitLab;
- child processes;
- harness adapters.

Discord handlers must not manipulate SQLite, the filesystem, or `child_process` directly.

## 6. Recommended initial stack

To confirm during discovery unless there is a better reason:

- strict TypeScript;
- pinned Node.js LTS;
- discord.js;
- SQLite;
- runtime validation with Zod or equivalent;
- Vitest or equivalent;
- structured logger;
- systemd service for the first Linux installation path.

These stack and deployment defaults are confirmed for the MVP. Exact supported versions and secondary libraries remain reversible implementation decisions.

## 7. HarnessAdapter

An adapter exposes the actual capabilities of a harness.

Conceptually:

```ts
type HarnessCapability =
  | "install"
  | "subscriptionAuth"
  | "modelSelection"
  | "projectSkills"
  | "globalSkills"
  | "mcp"
  | "streaming"
  | "sessionResume"
  | "attachments"
  | "usageMetrics";

interface HarnessAdapter {
  readonly id: string;
  detect(): Promise<HarnessDetection>;
  getCapabilities(): Promise<Set<HarnessCapability>>;
  install?(): Promise<void>;
  getAuthStatus?(): Promise<AuthStatus[]>;
  beginLogin?(provider: string): Promise<AuthFlow>;
  listModels?(): Promise<ModelDescriptor[]>;
  configureProject(project: Project): Promise<void>;
  installSkill?(request: InstallSkillRequest): Promise<void>;
  configureMcp?(request: ConfigureMcpRequest): Promise<void>;
  startSession(request: StartSessionRequest): Promise<HarnessSession>;
  sendPrompt(request: SendPromptRequest): Promise<void>;
  stopSession(request: StopSessionRequest): Promise<void>;
}
```

The exact interface must emerge from real use cases. Do not implement methods before they are actually needed.

## 8. PiAdapter V0

Pi is the first adapter.

HarnessHub must be able to:

- detect the installation and version;
- explicitly install Pi when the user authorizes it;
- work inside the exact project directory;
- use Pi's RPC mode in a separate supervised process, with strict LF-delimited JSONL framing;
- send a prompt and receive useful events;
- identify/preserve a session when Pi supports it;
- stop a session cleanly;
- detect a dead process;
- avoid parsing human terminal output when a machine interface exists.

Pi-specific details remain confined to `PiAdapter`.

## 9. Authentication and models

Goal: prefer **subscriptions and native authentication flows supported by the harness**, rather than building a token-billed API proxy.

For the MVP, the operator authenticates Pi/providers natively under the non-root service account outside Discord. HarnessHub detects and reports that status and uses Pi's existing/default model. Discord-assisted native login and model selection follow after the first complete loop.

Rules:

- HarnessHub never asks for provider passwords;
- use native OAuth/device flow/browser/CLI authentication when available;
- reuse global harness credentials when they are designed to be shared;
- do not duplicate a token that the harness already stores correctly;
- store only required metadata inside HarnessHub;
- distinguish provider, credential, subscription, model, and harness;
- never claim a provider is included in a subscription unless that can be established.

Discord must be able to represent an interactive flow with links, codes, buttons, or modals without exposing secrets in logs.

## 10. Git workflow for building HarnessHub

HarnessHub development itself follows `docs/DEVELOPMENT_GIT.md`.

Mandatory criteria for development agents:

- inspect Git state before every meaningful task;
- preserve pre-existing user changes;
- use a dedicated branch for meaningful changes unless a documented exception applies;
- keep one task equal to one coherent, reviewable diff;
- create clean local commits after validation unless instructed otherwise;
- review the diff and run `git diff --check` before closing the task;
- never reset, clean, force-push, or destructively rewrite history without explicit approval;
- never push, merge, create a PR, or modify remotes without explicit authorization;
- report branch, commits, working-tree state, and remote actions at the end.

Git quality is part of the Definition of Done, just like tests.

## 11. Git, GitHub, and GitLab — product feature

### Local

When creating a project:

- create the directory atomically/safely;
- run `git init` automatically for an empty project;
- optionally clone an HTTPS/SSH repository URL into the new project;
- use only credentials already configured for the service account;
- reject credentials embedded in URLs and never collect Git credentials through Discord;
- fail safely on unknown SSH host keys and provide setup guidance;
- never build Git commands by shell-concatenating user input;
- preserve real errors and provide explicit recovery paths.

### Providers

Prefer official CLIs (`gh`, `glab`) when this reduces custom credential handling.

Significant remote actions — creating/deleting repositories, making a repository public, force-pushing, deleting remotes — must be explicit and auditable.

## 12. Skills

HarnessHub distinguishes:

- global skills;
- project-specific skills.

A skill has at minimum: name, source, version/revision when available, scope, compatible harnesses, and installation state.

Installing an external skill is a trust operation: show its source and never silently execute unexpected scripts.

The actual installation format is the responsibility of the `HarnessAdapter`.

## 13. MCP

MCP is a **capability**, not a universal assumption.

HarnessHub may define a canonical MCP server representation, then let each adapter:

- translate it;
- reject it when unsupported;
- explain an alternative mechanism.

MCP secrets must never be exposed in Discord, logs, or plaintext database fields when a more appropriate store exists.

## 14. Files and archives

A project channel may receive files intended for its workspace.

Minimum rules:

- destination must remain inside the project;
- canonicalize/resolve paths before writing;
- reject `..`, absolute paths, and symlink escapes;
- enforce file count and size limits;
- inspect ZIP archives before extraction;
- defend against ZIP bombs;
- never overwrite silently;
- treat `.env`, private keys, and secrets as sensitive;
- record the operation without logging secret contents.

## 15. Jobs and processes

Minimum states:

```text
queued -> running -> succeeded | failed | cancelled
```

A job contains: type, optional project, timestamps, status, safe error, and non-sensitive metadata.

For harness processes:

- a PID alone is not a sufficient identity after reboot;
- detect dead/orphaned processes;
- perform explicit cleanup;
- support configurable concurrency limits;
- make cancellation idempotent;
- do not let a Discord crash make state unrecoverable.

## 16. Initial data model

Evolve through migrations.

```text
GuildWorkspace
- id
- discordGuildId
- categoryId
- managementChannelId
- workspaceRoot

Project
- id
- workspaceId
- name
- slug
- channelId
- path
- harnessId?
- gitRemote?
- createdAt
- archivedAt?

HarnessInstallation
- id
- harnessId
- version?
- status
- lastCheckedAt

HarnessSession
- id
- projectId
- harnessId
- externalSessionId?
- status
- startedAt
- lastActivityAt

Job
- id
- projectId?
- type
- status
- createdAt
- startedAt?
- finishedAt?
- safeError?
```

Do not store secrets in these tables for convenience.

## 17. Permissions

At least two levels:

- HarnessHub administrator: setup, installs, global auth, destructive operations;
- project user: prompts and authorized project operations.

The MVP maps both roles to the single configured administrator Discord user ID, while retaining the explicit boundary in application authorization. One Discord guild is supported.

Authorization checks happen in the application layer; hiding a Discord button is not access control.

## 18. Discord UX

Prefer a compact UX: slash commands for actions, selects/buttons for short choices, edited messages for progress, and the project channel for prompts.

In the MVP, ordinary messages from the authorized user in a mapped project channel become Pi prompts. While Pi is working, another prompt is rejected with a clear busy response rather than queued silently. Stop/resume controls use interactions, and progress is summarized rather than streamed token by token.

Avoid:

- streaming every model token into Discord;
- creating a separate command for every micro-action;
- displaying secrets;
- making raw logs the primary UX.

Example project status:

```text
HarnessHub / my-project
Harness: Pi
Model: <current>
Session: idle | working | waiting | failed
Git: main / clean|dirty
Last activity: ...
```

## 19. Recovery

After reboot:

- the database restores workspace/project mappings;
- `/setup` remains idempotent;
- existing channels are reused;
- interrupted `running` jobs are reconciled;
- sessions resume when the harness supports it, otherwise they are marked stopped with an explicit resume action;
- no duplicate project/channel/process is created automatically;
- a manually missing or renamed mapped channel/directory produces an explicit degraded state and repair action; HarnessHub does not silently recreate, remap, or delete its counterpart.

## 20. Project-specific quality

In addition to `AGENTS.md`, critical paths should use real integration tests where practical:

- SQLite migrations;
- temporary filesystem;
- real local Git repositories;
- controlled child processes;
- fake `HarnessAdapter` only for application-layer tests, followed by real contract tests for `PiAdapter`;
- separated Discord gateway so the whole business layer does not require Discord mocks.

A feature is not validated merely because its Discord handler responds.

## 21. Approval boundary

An explicit administrator command is sufficient authorization for ordinary HarnessHub operations such as creating or cloning a project and installing Pi. A separate confirmation is required for destructive or hard-to-reverse HarnessHub operations, including deletion, overwrite, public repository creation, and destructive Git actions.

Commands executed inside Pi sessions follow Pi's own approval configuration. Pi configuration does not authorize privileged operations performed by HarnessHub itself.

## 22. Confirmed MVP constraints

- personal, single-administrator use;
- one configured Discord guild;
- one non-root Linux VM with systemd;
- empty project creation and HTTPS/SSH repository cloning;
- automatic Git initialization for empty projects;
- Pi first, using pre-existing native authentication and its default model;
- ordinary project-channel messages as prompts, one active prompt per project;
- GitHub/GitLab management, skills, MCP, uploads, model selection, and Discord-assisted login deferred until after the first complete loop.
