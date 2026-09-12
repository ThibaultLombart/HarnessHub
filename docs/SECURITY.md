# Security — HarnessHub

HarnessHub is a sensitive surface: it receives Discord input and can write files, launch processes, and manipulate development environments.

## Trust boundaries

Treat as untrusted:

- Discord message and interaction content;
- project names, branch names, remotes, and URLs;
- attachments and ZIP archives;
- cloned repositories;
- files inside repositories;
- skills and extensions;
- MCP configuration and servers;
- external process output;
- names/IDs supplied by a harness.

## Invariants

1. The service runs without root and without broad sudo access.
2. A project cannot write outside its authorized workspace through a HarnessHub operation.
3. Paths are canonicalized and symlinks are checked before sensitive writes.
4. Do not use `shell: true` or concatenate commands containing user input when structured arguments are possible.
5. Secrets are never sent to Discord or written to logs.
6. Logs explicitly redact tokens, headers, and credentials.
7. Every significant destructive or remote operation requires explicit authorization.
8. Hiding a Discord button is never considered access control.
9. Uploads have limits for size, count, depth, and extracted volume.
10. Archives are inspected before extraction: traversal, absolute paths, dangerous symlinks, and ZIP bombs are rejected.
11. Installing an external skill/MCP server/harness is treated as supply-chain code execution.
12. A malicious repository must not automatically execute hooks/scripts merely by being imported when that can be avoided.
13. Child processes have explicit lifecycle, timeout/cancellation, and cleanup.
14. Persistent state must not rely on a PID alone.
15. Errors returned to Discord must not expose secrets, sensitive internal stacks, or unnecessary private paths.
16. Repository URLs containing credentials are rejected. Clones use only service-account credentials, and unknown SSH host keys are never accepted automatically.
17. Pi's internal approval configuration does not authorize privileged HarnessHub operations; destructive or hard-to-reverse HarnessHub actions require their own explicit confirmation.

## Surfaces requiring the `security` subagent

- Discord permissions/roles;
- provider/GitHub/GitLab authentication;
- `child_process` / shell execution;
- filesystem, symlinks, uploads, ZIP archives;
- repository clone/import;
- installations and updates;
- skills/extensions;
- MCP;
- secret handling;
- destructive Git actions;
- future network exposure.
