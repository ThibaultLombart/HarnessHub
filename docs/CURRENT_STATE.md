# Current State

## Status

**MVP implementation present / automated local validation passing / live environment validation outstanding.**

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
- non-root systemd unit and installation documentation.

## Automated evidence

The suite uses real temporary SQLite databases, real temporary filesystems and local Git repositories, controlled child processes, fake application ports, and a protocol-faithful fake Pi process. A read-only handshake was also executed against installed Pi `0.85.1` using an empty temporary Pi configuration; detection and `get_available_models` RPC succeeded without invoking a model.

## Not validated yet

- connection, permission behavior, and command registration against a real Discord guild;
- an end-to-end prompt using a real authenticated provider/model;
- HTTPS/SSH cloning against a real remote and service-account credentials;
- systemd unit verification and restart behavior on a real Linux host (`systemd-analyze` is unavailable in the current Windows environment);
- real user acceptance of Discord timing, copy, and progress behavior;
- isolation between Pi and HarnessHub's writable control-plane state: both currently run as the same constrained non-root service identity, as documented in `docs/SECURITY.md`.

The MVP must be reported as **Validated with reservations**, not fully validated, until those environment-dependent checks are completed.

## Next step

Run the documented Linux installation with dedicated test credentials, execute the complete Discord → project → Pi journey, verify restart recovery, and resolve any findings before declaring the MVP fully validated.
