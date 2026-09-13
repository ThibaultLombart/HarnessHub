# Current State

## Status

**MVP happy path implemented and validated on a live Linux/Discord/Pi environment, with remaining recovery and remote-clone reservations.**

## Implemented

- strict TypeScript service foundation with formatting, linting, type checking, tests, build, and dependency audit scripts;
- runtime-validated configuration and structured logging with credential redaction;
- built-in SQLite persistence, transactional migrations, jobs, workspace/project/session mappings, and restart reconciliation;
- one-guild/one-administrator application-layer authorization;
- idempotent Discord workspace setup and private category/channel provisioning;
- atomic empty Git project creation and validated HTTPS/SSH cloning without shell interpolation;
- explicit degraded state for missing, renamed, moved, or unsafe mapped resources;
- explicit Pi capabilities, detection, pinned non-root installation, and native auth-status reporting;
- supervised Pi RPC subprocesses with strict JSONL framing, persistent session IDs, concurrency limits, stop/resume, and crash recovery;
- ordinary project-channel prompts with compact tool progress, bounded Discord output, and no token-by-token streaming;
- non-root systemd unit, installation documentation, and an interactive idempotent `sudo ./scripts/install.sh` installer with protected credential input and rollback copies;
- installer hardening discovered during live deployment: readable immutable runtime artifacts, isolated optional Pi login, and non-fatal login cancellation;
- Discord startup waits for `ClientReady`, documents the required channel/role permissions, and reports missing setup permissions clearly.

## Automated evidence

The suite uses real temporary SQLite databases, real temporary filesystems and local Git repositories, controlled child processes, fake application ports, and a protocol-faithful fake Pi process. A read-only handshake was also executed against installed Pi `0.85.1` using an empty temporary Pi configuration; detection and `get_available_models` RPC succeeded without invoking a model.

## Live evidence

On a dedicated Linux/systemd VM, operator-provided logs and acceptance confirmation establish that:

- the health checks pass and the service remains active under systemd;
- a real Discord bot authenticates, reaches `ClientReady`, and registers guild commands;
- `/setup` creates the private Discord workspace after granting the documented least-required permissions;
- Pi detection and native provider authentication work under the service identity;
- project creation and an ordinary Discord message complete the Discord → HarnessHub → Pi happy path.

The live exercise exposed and resolved incorrect application artifact modes, inherited stale Pi-session context, optional-login failure semantics, premature Discord readiness checking, and an undocumented `Manage Roles` requirement.

## Remaining reservations

- `/setup` idempotency and project/session persistence have automated coverage but were not explicitly re-exercised after a live project restart;
- stop/resume and process-crash recovery have automated coverage but no recorded live failure simulation;
- HTTPS/SSH cloning has not been exercised against a real remote using service-account credentials;
- `systemd-analyze security` and a restore from a real Proxmox backup have not been recorded;
- isolation between Pi and HarnessHub's writable control-plane state remains intentionally limited: both use the same constrained non-root service identity, as documented in `docs/SECURITY.md`.

The MVP is **Validated with reservations**: its live happy path works, while the explicit recovery, remote-clone, and backup checks above remain outstanding.

## Next step

Verify restart persistence for the created live project, exercise stop/resume and one remote clone, then capture and restore an encrypted Proxmox backup.
