# Pi live controls: operator guide

## Scope and prerequisites

This interface is for one configured administrator in one guild, in mapped active project channels. Use Node.js 22.5–24, a reviewed HarnessHub checkout, the pinned installed Pi **0.85.1**, and the Discord permissions/intents in [INSTALLATION.md](INSTALLATION.md). Authentication is performed through Pi locally, never by entering credentials in Discord. Pi and reviewed extensions run with the service identity's permissions; this is not a sandbox for hostile projects.

Ordinary project messages start/resume Pi in the mapped directory. Progress shows lifecycle, known tool names, counts/timing, bounded finalized public explanations, and available subagent status. It does not invent percentages or expose raw commands/results. Progress, completion, and questions use the actual model reported by the current runtime, or `unknown` until that evidence is available; configured preferences are not treated as evidence. Each question retains its own model snapshot through pagination and closure. No prompt queue or automatic replay on resume is implemented.

## Questions and integrated controls

After initialization, Pi's serializable `select`, `confirm`, `input`, and `editor` requests are relayed to the originating project channel:

- select menus use pages of 25 options; option indices, not RPC IDs or hidden values, travel through Discord;
- confirm uses explicit Confirm/No buttons, never automatic approval;
- input/editor use a Respond button and modal (no private prefill is published);
- Cancel remains available if a modal is dismissed;
- only the configured administrator in the same guild/channel/project may answer;
- process/session-scoped handles reject foreign, duplicate, expired, remapped, and replaced-session submissions;
- a failed Discord send/acknowledgement cancels rather than approving.

Limits: at most four pending questions per process, 500 options per question (2 KiB each), 4 KiB answers (Discord modal 4,000 characters), and a five-minute lifetime or the shorter Pi timeout. Entire title/message/options must be safely displayable without truncating decision context. If material is suppressed or too long for the control, the question is cancelled; an opaque approval/select is never offered. Long or secret-containing questions must be rewritten by the reviewed extension.

### Installed question-tool evidence and limits

On this host, the installed `extensions/ask-user-question.ts` registers `ask_user_question` and `ask_question`. `tests/question-tool-installed.test.ts` loads that actual file through **Pi's own extension loader** (which provides its documented legacy-package compatibility), executes both actual tool callbacks with a controlled RPC context, and verifies select → Other → input, cancellation, and abort-signal forwarding. It does not call a provider or the extension's independent Discord bridge/TUI. Plain Node import is not an equivalent compatibility test: the legacy `@mariozechner/pi-tui` import requires Pi's loader.

Separately, `tests/pi-installed-live.test.ts` exercises actual installed Pi's post-init select/input/confirm/editor JSONL exchange with production `PiSession` correlation and an isolated fixture extension. The primitive transport test uses a low-level RPC command solely to trigger the dialogs, not as an application command feature. Production `sendPrompt` is exercised by native-command rejection and an actual ordinary `input` hook returning `{ action: "handled" }`: the latter must fail explicitly, terminate its process, and allow a clean replacement without hidden replay. Regular agent lifecycle and integrated Discord controls still use local fixture subprocesses, not a paid/provider-backed task.

Only reviewed global extensions exposing those serializable primitives are covered. Project executable resources remain subject to Pi's `--no-approve` boundary. Custom TUI/questionnaire interfaces using `ctx.ui.custom()`, detached child dialogs, and arbitrary third-party question tools are not supported by this evidence. Installed-source tests skip when those host-specific sources/binaries are absent; a passing suite with skips is not compatibility proof for another installation.

## Pi 0.85.1 initialization limitation

The installed RPC implementation awaits extension binding/`session_start` **before attaching the stdin JSONL reader**. An awaited startup question cannot consume its answer even if HarnessHub subscribed early. No installed runtime is patched.

HarnessHub detects an initialization-time serializable UI request, closes initialization and terminates that process promptly, and reports an explicit Pi 0.85.1 supported-version limitation in Discord. It displays no startup approval controls and sends no approval. Initialization also has a 30-second general command timeout; the detected-dialog path does not wait for it.

Move the dialog out of `session_start` in the reviewed extension or disable that extension through local operator configuration. An upstream upgrade is only a potential remedy: **no upstream replacement version has been verified here**. Before changing the pin, review its RPC lifecycle and rerun an isolated actual-binary `session_start` dialog regression. Do not claim that upgrading automatically fixes it.

## Native Pi commands and discovery

Messages beginning with `/` after leading whitespace are rejected by production `sendPrompt` **before dispatch**. Inline extension commands can finish without `agent_settled`; no uniform safe completion contract is verified. Use ordinary prompts and HarnessHub's own `/session` commands instead. This conservative rule also rejects message text beginning with an absolute POSIX path; put a normal instruction before the path.

Auth/model discovery uses Pi's documented `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-themes`, and `--no-context-files` flags. The installed-Pi regression verifies that a discovered extension's startup hook cannot execute during either query. Built-in/native registry and non-executable configured models remain available as Pi reports them. Models registered only by executable provider extensions may be absent. No safe non-executing registry discovery for arbitrary dynamic providers has been verified; an empty catalogue must not be presented as definitive lack of authentication for those providers. Ordinary working sessions still load reviewed global extensions; discovery isolation does not disable their runtime behavior.

### Ordinary handled input and silent preflight

Pi 0.85.1 acknowledges an ordinary input hook returning `action: "handled"` but emits no `agent_settled`. An ACK is acceptance, **not verified completion**; HarnessHub never substitutes cached assistant text for success in this case. A **five-second start watchdog** applies before ACK and after ACK when no supported agent lifecycle has started, no human question is pending, and no compaction/retry is active. Answering, cancelling, or expiring a question restarts that grace period for remaining silent preflight cleanup. Notifications/widgets do not count as active model work.

On expiry, the operation fails explicitly and the process is terminated/inactivated before failure returns. Resume never replays the input. Review/disable the intercepting or blocked extension locally. This conservative boundary can also reject a legitimate but silent slow auth/input/before-agent hook; move human decisions to supported dialogs and expose supported lifecycle activity rather than relying on an indefinite silent preflight. No generic completion contract for handled input has been verified. There is **no overall model-run deadline**: after `agent_start`/`turn_start`, long quiet model work remains allowed; long active compaction/retry and pending human questions are not cut off by this watchdog. Question lifetimes still apply. A missing lifecycle end after active work still requires operator Stop; the watchdog is not proof that every third-party extension finishes correctly.

## Stop, resume, restart, and shutdown

`/session stop` invalidates the project operation reserved **before** initial Discord progress delivery, resource/status preflight, filesystem initialization, or process registration. Cancellation is rechecked after asynchronous preparation and before prompt dispatch: a stopped send or preflight cannot later spawn Pi or send work. Every stopped process, initializing or initialized, is **terminated and invalidated**, and pending operations reject as stopped. Pi 0.85.1 `abort()` does not cancel a pending `before_agent_start` callback: merely cancelling a question, clearing queues, and aborting can still dispatch an agent later. Stop therefore signals termination before releasing UI callbacks, closes stale handles, and never retains that runtime for resume. On Linux a private process group receives SIGTERM, then SIGKILL after two seconds if needed; Stop awaits confirmed parent exit and also kills remaining same-process-group descendants. A four-second confirmation bound fails explicitly rather than reporting successful termination if exit cannot be confirmed. Reviewed extensions must not daemonize/escape the process group; Stop cannot guarantee cancelling deliberately detached descendants or already-issued external operations. This is not cgroup/sandbox isolation for hostile extensions. Existing service/systemd isolation is unchanged; no extra privileges were added. Equivalent Windows/other-platform tree termination is not validated.

A concurrent prompt/resume/restart is rejected while an operation owns the project. A cancelled preflight retains its reservation until its outstanding I/O unwinds; Stop does not forcibly cancel Discord/filesystem APIs. Retry after that operation settles. Shutdown prevents new adapter work, invalidates pending initialization, closes processes/discovery clients, and clears questions. Stale handles from a replaced process cannot answer the replacement's questions.

`/session resume` starts/resumes the persisted conversation and leaves it idle; it does not replay the stopped prompt. Stopping a process does not delete or rewrite its conversation history. Pi defers creating a new session file until an assistant message: if this adapter observed a new, empty, never-agent-dispatched process and confirms its exact file is absent, replacement starts a new empty conversation with an explicit history-unavailable notice. The old prompt is never replayed. Ordinary prompt completion/error messages retain this notice even if the operation finishes before the next progress update; continuation chunks do not repeat it. Error recovery guidance does not assume history was saved. After an application restart, or if an agent had already dispatched, absent history fails closed rather than silently starting over.

Resume resolves a **full exact session UUID** only in that project's canonical session directory and passes a validated absolute file path, never Pi's prefix/global lookup. The pinned version-3 header must match ID and canonical project directory; symlinks, ambiguous matches, corrupt/empty JSONL, records over 16 MiB, and permission/I/O errors fail closed, not as absent history. Existing conversation entries remain intact (Pi itself may append startup name/thinking-level metadata). Rare maintenance `/session restart confirm:RESTART` reloads the actual Pi process, preserves conversation history, and refuses active work. Authorization and active-project checks remain application-layer boundaries, not merely hidden buttons.

## Privacy and subagent status

Content projection is bounded/idempotent and separate from presentation escaping; Markdown is escaped once at the display boundary. Useful ordinary path narratives, formatting text, and security explanations survive. Known credential assignments, private-key/API-key forms, credential-bearing/signed/token URLs, and embedded private-thinking tags are suppressed. Mentions are disabled on progress, questions, errors, completion, and continuation messages.

This is **not a perfect sanitizer for arbitrary model output**. Operators must keep project channels private and avoid prompting for confidential material. Public assistant explanations/finals can contain sensitive prose not recognizable by pattern matching. Raw reasoning/deltas, tool arguments/commands/results, subagent tasks/outputs, widget labels containing task text, private editor prefills, notifications, and arbitrary extension internals are not published. Tool activity uses conservative name/result metadata, not raw dumps. Flooded updates are coalesced and histories/requests bounded. Progress rendering reserves the **escaped actual-model footer** before fitting the final 2,000-character Discord payload. Stage, lifecycle counts, active action, timing, history-unavailable notice, stall warning, model, and controls are retained; optional narrative/recent-action/subagent rows are dropped in deterministic reverse order with an explicit omission notice, never silently sliced mid-escape.

The infrastructure-only `subagent-widget.ts` decoder covers installed `pi-subagents` **0.67.0**'s `subagent-async` widget, `PI_SUBAGENT_ASYNC_JSON:` prefix, version-1 `pi-subagents.async-status-snapshot`. The actual installed encoder, session-scoping helper, publisher, and schema are verified by `tests/subagent-widget-installed.test.ts`, without spawning agents or reading artifacts. Only known role labels/state metadata/times are projected. `needs_attention` remains attention, not failure; unsupported state remains `unknown`. Unrecognized versions are omitted, not invented as success/failure. Host-step rows and artifact discovery are not implemented. No widget means status unavailable, not successful execution.

## Troubleshooting and rollback

- Startup limitation: review/disable the startup dialog locally; do not approve an opaque request or wait/retry indefinitely.
- No question: verify a reviewed RPC-compatible tool is loaded after initialization. Unsafe/oversized question context is cancelled deliberately. Do not paste credentials into the modal.
- No dynamic-provider model in `/model list`: discovery intentionally excludes executable extensions; inspect the reviewed provider setup locally rather than enabling hooks in observational commands.
- Stale controls: use the current question in the originating project; stopped/expired/replaced controls cannot be reused.
- Busy after Stop: let outstanding preflight I/O settle. Do not spawn a duplicate process to work around the reservation.
- Unsupported ordinary input/silent preflight: completion was not verified; the runtime was terminated. Review the local hook and resume without replay. If the first conversation was never persisted, expect an explicit new-empty-conversation notice, not a claim that history was recovered.
- History resolution failure: inspect only this project's local session storage. Do not bypass a corrupt, ambiguous, foreign, or inaccessible file by pretending it is missing.
- Generic process failure: inspect redacted local logs. Never post full RPC records, credentials, or private extension output to Discord for diagnosis.

Installation, updates, and rollback are **manual trusted-checkout operator actions** as described in [INSTALLATION.md](INSTALLATION.md). `/system update-apply` is intentionally disabled regardless of host permissions. Do not grant the service account privileged installer permissions. Preserve matching application/state backups before a manual update; rollback to the reviewed previous application copy and matching state, then validate on disposable state. No installation, live Discord test, service restart, deployment, or rollback was performed for this repair.

## Validation and dependency rationale

Reproduce locally with:

```bash
npm ci --ignore-scripts
npm run check
git diff --check
npm audit --omit=dev
```

The exact zod pin is patched from 4.6.3 to **4.6.6** for GHSA-mrhx-c7xc-m3w5. The undici lock entry is patched from 6.28.1 to **6.29.1** within Discord's existing `^6.27.0`/REST constraints for GHSA-4qv8-2p9j-2685 and GHSA-xjj6-f33q-929c. These are minimal patch-line repairs, not forced or broad upgrades; Pi's installed runtime and its dependencies were not changed.

### Final automated evidence

Validated with reservations on Node.js **22.23.4** / npm **10.9.9**:

- The three independent-review regressions were observed failing first: installed preflight PID survived Stop, real installed ordinary handled input stayed busy, and escaped progress plus footer exceeded 2,000 characters. Their repaired tests pass. The edit-chain integration separately failed at 2,013 characters without reserving the footer, then passed with the budget.
- `tests/pi-stop-preflight-installed.test.ts` runs production Stop/Hub state tracking against a subprocess invoking the actual installed `AgentSession.prompt` and `abort` methods with controlled dependencies and a dispatch tripwire (no agent/provider). A question is cancelled, cleanup is held, Stop returns, then cleanup is released: the PID is gone, no dispatch occurs, persisted stopped status/history survive, and stale handles/finalizers cannot affect a replacement. This is not a full provider-backed AgentSession run.
- `tests/pi-process-close.test.ts` verifies bounded forced termination of a SIGTERM-resistant parent and descendant. Deterministic watchdog tests cover pre/post-ACK silence, pending dialogs, compaction, and healthy hour-long model work without a job deadline. Actual installed-binary tests cover handled failure, missing-first-history replacement, and exact persisted-history resume; history unit tests cover corruption, ambiguity, symlinks, traversal, and I/O failures.
- Four missing-history Discord regressions (fast success/failure, each with unknown/actual model evidence) failed first because final messages lost the notice. They pass after repair, including repeated-event deduplication, notice reset on the next prompt, bounded long escaped completion chunks, model footers, and recovery guidance without a saved-history claim. These use the production Discord event handler with controlled application events/results, not live Discord or a provider.
- Only changed implementation, fixture, test, and documentation files were formatted with the project's Prettier.
- `npm run check` passed: formatting, zero-warning ESLint, TypeScript checking, **47 test files / 271 tests passed**, and the production TypeScript build. Installed Pi/question-tool/subagent-source tests ran on this host without skips; no provider call or agent task was needed. Strict lint initially caught implementation issues and passed after repair; existing runtime SQLite experimental warnings remain.
- `git diff --check` passed.
- `npm audit --omit=dev` reported **0 vulnerabilities**. This audit does not cover Pi's separately installed runtime or executable extensions.

Real Discord/systemd/provider-backed acceptance remains unvalidated; installed command-only tests and fixture integration do not substitute for it. No commit, push, merge, service change, or deployment was performed as part of this repair.
