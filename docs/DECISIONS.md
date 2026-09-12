# Decisions

Record only durable decisions that change the product or architecture. This is not a session log.

## D-001 — HarnessHub is a control plane, not an agent
**Status: accepted**

Reasoning and development orchestration remain inside the selected harness. HarnessHub manages infrastructure, routing, configuration, control-state persistence, and Discord UX.

## D-002 — Pi is the first harness
**Status: accepted**

The MVP implements Pi for real. Multi-harness support influences architecture boundaries, but no fake adapter will be built merely to “prove” the abstraction.

## D-003 — Harness capabilities are explicit
**Status: accepted**

Skills, MCP, auth, streaming, session resume, and similar features are capabilities. The UI must never pretend a function exists when an adapter does not support it.

## D-004 — Discord is not the source of truth
**Status: accepted**

Mappings and durable state are persisted outside Discord messages.

## D-005 — MVP deployment and tenancy are deliberately narrow
**Status: accepted**

The MVP targets one personal Linux VM, one configured Discord guild, and one administrator Discord user. HarnessHub runs as a non-root systemd service. Administrator and project-user permissions initially map to the same Discord identity, but remain distinct application-layer authorization concepts.

## D-006 — MVP project creation supports empty repositories and secure cloning
**Status: accepted**

An empty project is initialized as a Git repository automatically. A project may instead be cloned from an HTTPS or SSH URL. Cloning uses credentials already configured for the service account; credentials embedded in URLs and Git credentials sent through Discord are rejected. Unknown SSH host keys are not accepted automatically. Adopting arbitrary existing local directories is deferred.

GitHub repository management through `gh` follows the first complete loop; GitLab through `glab` follows GitHub. Creating or linking provider repositories is not required for the MVP.

## D-007 — MVP reuses native Pi authentication and its default model
**Status: accepted**

The operator authenticates Pi/providers under the service account using their native mechanism. HarnessHub detects and reports authentication state without duplicating credentials and initially uses Pi's existing/default model. Discord-assisted native login and model selection are post-MVP work.

The choice between Pi RPC and SDK remains subject to the planned M3 spike and must be based on the most stable machine interface.

## D-008 — Project-channel messages are prompts with one active execution
**Status: accepted**

An ordinary message from the authorized user in a mapped project channel is a Pi prompt. Only one prompt may be active per project; another is rejected clearly instead of silently queued. Discord receives compact progress and results rather than token-by-token output, with interactions for stop/resume.

## D-009 — Skills, MCP, and uploads follow the first complete loop
**Status: accepted**

Global/project skills, MCP, individual files, and archive/config uploads are excluded from the MVP. Their capability and security boundaries remain part of V1.

## D-010 — HarnessHub and Pi have separate approval boundaries
**Status: accepted**

An explicit administrator command authorizes ordinary HarnessHub operations, including creating/cloning projects and installing Pi. Destructive or hard-to-reverse HarnessHub operations require a separate confirmation, including deletion, overwrite, public repository creation, and destructive Git actions. Commands inside a Pi session follow Pi's own approval configuration; that configuration cannot authorize operations performed by HarnessHub.

If a mapped Discord channel or project directory is manually missing or renamed, HarnessHub reports degraded state and requires explicit repair. It does not silently recreate, remap, or delete the counterpart.
