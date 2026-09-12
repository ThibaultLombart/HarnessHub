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

## To decide after discovery

Add the actual decisions here for: multi-user behavior, multi-guild support, default Git behavior, GitHub/GitLab workflow, streaming, approvals, system installation, Pi RPC vs SDK, and related product choices.
