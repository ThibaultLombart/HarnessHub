# Discord commands

HarnessHub is operated from one configured Discord guild by the configured administrator. Commands that affect global state must be run from `#workspace-management`; project commands must be run from the mapped project channel unless stated otherwise.

## Workspace and harness

### `/setup`

Creates or reconnects the private `HARNESSHUB` category and `#workspace-management` channel. The command is idempotent. If the persisted Discord mapping is degraded, HarnessHub refuses silent remapping and reports that explicit repair is required.

### `/harness detect`

Checks whether Pi is installed and records the detected version/status.

### `/harness auth`

Checks Pi's native provider authentication by asking Pi for available models. HarnessHub does not collect provider credentials through Discord.

### `/harness install`

Installs the pinned Pi package into HarnessHub's non-root tools directory after explicit administrator command.

## Projects

### `/project create name:<name> [repository:<url>]`

Run in `#workspace-management`. Creates a local project directory and Discord project channel. Without `repository`, HarnessHub initializes an empty Git repository. With `repository`, HarnessHub clones an HTTPS or SSH repository using only credentials already configured for the service account.

Repository URLs with embedded credentials, query parameters, fragments, unsupported protocols, or shell-like unsafe prefixes are rejected. SSH host keys must already be trusted by the service account.

Project channel names carry a status suffix: `🟢` means idle/available, `🟡` means Pi is working, and `🔴` means the last session failed, was stopped, or the project needs intervention. A successful prompt or resume returns the channel to green. Status rename failures are logged but never block project work.

### `/project status`

Run in a project channel. Shows a compact dashboard:

- project state and degraded mapping warnings;
- harness;
- selected model or Pi default;
- session status;
- Git branch/cleanliness;
- Git remote;
- active global/project resources;
- recent project jobs.

### `/project archive confirm:<slug>`

Run in a project channel. Archives the project after the project slug is typed exactly. New prompts are rejected because archived projects are no longer active. The local directory is preserved.

### `/project delete confirm:<slug>`

Run in a project channel. Deletes the Discord channel, local project directory, and active HarnessHub project mapping after exact slug confirmation.

Safety rules:

- refuses when a session is active;
- refuses when Git reports uncommitted changes;
- stops any idle session before deletion;
- keeps job history as non-sensitive audit metadata.

## Prompt/session control

### Ordinary project-channel message

A non-empty message in a mapped project channel becomes a Pi prompt. HarnessHub starts or resumes Pi in the exact project directory. Concurrent prompts for the same project are rejected with a clear busy response.

The progress message shows the current observable stage in plain language, the active action and its running time, completed/failed action counts, turn/retry/compaction counts, recent actions, total elapsed time, last activity age, and a possible-stall warning. It deliberately does not invent a completion percentage or expose chain-of-thought, command arguments, raw tool output, or secrets. Every progress, completion, continuation, and safe-error message ends with `Model used: provider/model-id`; before a new default-model session reports its state, the initial value may briefly read `Pi default`. HarnessHub does not stream every token to Discord.

### `/session stop`

Stops the active Pi operation for the current project. Safe to repeat.

### `/session resume`

Starts/resumes the Pi session for the current project and leaves it idle.

## Resources, skills, and packages

### `/resource add scope:<global|project> source:<source>`

Installs a managed Pi package. Global resources apply to all Pi sessions for the service account. Project resources are installed with Pi's project-local mode from the mapped project directory.

Supported source forms:

- `npm:package`
- `npm:@scope/package@version`
- `git:github.com/user/repo@ref`
- `git:git@github.com:user/repo@ref`
- `https://github.com/user/repo`
- `ssh://git@github.com/user/repo`

External resources are trusted code/supply-chain inputs. Review the source before installation.

### `/resource list [scope:<global|project>]`

Lists HarnessHub-managed resources. From `#workspace-management`, lists global resources by default or the requested scope. From a project channel, lists global plus project resources unless filtered.

### `/resource remove scope:<global|project> id:<resource-id>`

Removes a managed resource using Pi's native remove command and marks it removed in HarnessHub state. Project resources must be removed from their project channel.

## Models

### `/model list`

Lists models available to Pi using native Pi authentication in the current context.

### `/model status`

Run in a project channel. Shows whether the project uses Pi's default model or a project-specific selection.

### `/model set model:<provider/model-id>`

Run in a project channel. Validates the model against Pi's available model list, persists the selection, and applies it to an active session when one exists. Future sessions start with `--model provider/model-id`.

### `/model reset`

Run in a project channel. Clears the project-specific model preference and returns to Pi's default model.

## Git

### `/git status`

Run in a project channel. Shows current branch, clean/dirty state, and origin remote.

### `/git remote`

Run in a project channel. Shows the origin remote or `none`.

### `/git link repository:<url>`

Run in a project channel. Adds `origin` if none exists. The same URL safety rules as project cloning apply. Existing origins are not overwritten.

## Files

### `/files upload attachment:<file> path:<relative-path>`

Run in a project channel. Downloads one Discord attachment and writes it to a relative destination inside the project without overwriting.

Safety rules:

- maximum size is 5 MiB;
- destination must be relative;
- `..`, absolute paths, NUL/newlines, symlink escapes, and existing destinations are rejected;
- server absolute paths are not returned in Discord.

ZIP/archive extraction is not enabled yet; archives should be uploaded as ordinary files until inspected extraction is implemented.

## Jobs and operations

### `/jobs list [limit:<1-25>]`

Run in `#workspace-management`. Lists recent long-running HarnessHub jobs with safe status information.

### `/jobs status id:<job-id>`

Run in `#workspace-management`. Shows one job status. Errors returned to Discord are sanitized.

### `/repair status`

Run in `#workspace-management` or a project channel. Diagnoses workspace/project mapping health. HarnessHub reports degraded state but does not silently recreate, remap, or delete resources.

### `/backup status`

Run in `#workspace-management`. Shows the database path, state directory, workspace root, and recommended stop/backup/start procedure. State and workspaces must be backed up and restored together.

### `/mcp status`

Shows current MCP support. Pi has no native MCP capability in the pinned Pi documentation; install Pi packages/extensions via `/resource add` for equivalent integrations. Future harnesses can expose native MCP as a declared capability.

### `/system status`

Run in `#workspace-management`. Shows HarnessHub version, health, database schema, workspace root, current permission model, and manual update guidance.

### `/system update-check`

Run in `#workspace-management`. Checks the configured trusted Git checkout for updates without changing the installation.

### `/system update-apply confirm:UPDATE`

Run in `#workspace-management`. Attempts a fast-forward update from the configured checkout:

1. verifies exact `UPDATE` confirmation;
2. checks the checkout is clean;
3. fetches/prunes;
4. fast-forwards only;
5. runs `npm ci`;
6. runs `npm run check`;
7. runs `sudo -n ./scripts/install.sh --no-pi-login`.

This requires explicit host authorization for the non-root service account to run the installer non-interactively. If sudo/systemd policy does not allow it, the command fails safely and leaves the current service running.
