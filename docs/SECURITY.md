# Security — HarnessHub

HarnessHub is a sensitive surface: it receives Discord input and can write files, launch processes, and manipulate development environments.

## Trust boundaries

Treat as untrusted:

- Discord message and interaction content;
- project names, branch names, remotes, and URLs;
- attachments and ZIP archives;
- cloned repositories;
- files inside repositories;
- skills, Pi packages, and extensions;
- MCP configuration and servers;
- Discord attachments and uploaded file names;
- external process output;
- names/IDs supplied by a harness.

## Invariants

1. The service runs without root and without broad sudo access.
2. A project cannot write outside its authorized workspace through a HarnessHub operation.
3. Paths are canonicalized and symlinks are checked before sensitive writes.
4. Do not use `shell: true` or concatenate commands containing user input when structured arguments are possible.
5. Secrets are never sent to Discord or written to logs.
6. Logs explicitly redact tokens, headers, and credentials.
7. Every significant destructive, update, installation, upload, or remote operation requires explicit authorization.
8. Hiding a Discord button is never considered access control.
9. Uploads have limits for size and destination path, and must not overwrite silently.
10. Archives are not extracted until inspected extraction exists: traversal, absolute paths, dangerous symlinks, and ZIP bombs must be rejected before enabling extraction.
11. Installing an external skill, Pi package, MCP server, extension, or harness is treated as supply-chain code execution.
12. A malicious repository must not automatically execute hooks/scripts merely by being imported when that can be avoided.
13. Child processes have explicit lifecycle, timeout/cancellation, and cleanup.
14. Persistent state must not rely on a PID alone.
15. Errors returned to Discord must not expose secrets, sensitive internal stacks, or unnecessary private paths.
16. Repository URLs containing credentials are rejected. Clones use only service-account credentials, and unknown SSH host keys are never accepted automatically.
17. Pi's internal approval configuration does not authorize privileged HarnessHub operations; destructive or hard-to-reverse HarnessHub actions require their own explicit confirmation.
18. Project deletion requires exact slug confirmation, no active session, and a clean Git worktree.
19. Installation, update, and rollback require manual operator action from a reviewed trusted checkout and local checks. Discord may report update availability; update apply is intentionally disabled. Do not grant the service account privileged installer permissions or introduce a Discord-triggered privileged helper.
20. Discord responses avoid returning sensitive absolute server paths when a relative user-facing path is sufficient.

## Resource and package installation

`/resource add` delegates to Pi package installation. Pi packages can contain skills, extensions, prompt templates, themes, dependencies, and executable code. HarnessHub validates source syntax and records state, but it does not prove third-party package safety. Operators must review sources before installation, prefer pinned versions/refs, and remove unused packages.

Pi has no native MCP capability in the pinned documentation. MCP-like functionality for Pi should be provided by reviewed packages/extensions until a native capability exists. Future harnesses must declare MCP support explicitly before HarnessHub writes MCP configuration for them.

## File uploads

`/files upload` writes one Discord attachment to a relative project path. It rejects absolute paths, `..`, NUL/newline characters, symlink escapes, existing destinations, and files larger than the configured limit. ZIP/archive extraction is intentionally not enabled yet.

## Discord-assisted updates

`/system update-check` may inspect the trusted checkout and report whether an update is available. `/system update-apply` is intentionally disabled, regardless of host privileges. An operator manually updates the trusted checkout, installs dependencies, runs checks, and invokes the reviewed installer; rollback is likewise manual. Do not grant the service account privileged installer permissions or sudo rights. Retain the hardened service unit.

## Codex usage polling

Codex usage polling reads Pi's protected OAuth credential only from `PI_CODING_AGENT_DIR/auth.json`, only in memory, and only after POSIX mode checks prove the file is not group/world accessible. On Linux this permits the locked Codex voice counter to call the unofficial ChatGPT usage endpoint with the native Pi credential. On Windows, HarnessHub refuses usage polling before reading the file because POSIX credential permissions cannot be verified; tests assert that no HTTP request is made in those cases. The endpoint is not a documented OpenAI public API, so upstream shape or authorization changes can make usage unavailable without breaking Pi sessions.

## MVP isolation limitation

Pi runs as a child of the same non-root service identity as HarnessHub. The systemd unit constrains that identity's host-level writable paths, but Pi is not sandboxed from HarnessHub's own writable database, session, and tool state. The personal MVP must not be exposed to untrusted Discord users or treated as safe execution for hostile repositories. A separate OS identity, container, VM, or policy sandbox is required for a stronger project-to-control-plane boundary.

Filesystem writes use canonicalization and symlink checks immediately before sensitive operations, but they are not a kernel-enforced sandbox and cannot eliminate every time-of-check/time-of-use race against a hostile same-UID process. Do not run untrusted code as the `harnesshub` service identity; use stronger OS isolation before accepting hostile repositories, tools, or users.

## Surfaces requiring the `security` subagent

- Discord permissions/roles;
- provider/GitHub/GitLab authentication;
- Codex usage polling reads Pi's protected OAuth credential only in memory, refuses Windows permission checks, and never persists or logs token material;
- Pi process restart is project-scoped, administrator-only, refuses active prompts, and requires the literal `RESTART` confirmation;
- `child_process` / shell execution;
- filesystem, symlinks, uploads, ZIP archives;
- repository clone/import;
- installations and updates;
- skills/extensions;
- MCP;
- secret handling;
- destructive Git actions;
- future network exposure.
