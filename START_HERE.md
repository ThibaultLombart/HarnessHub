# Starting with Pi

Use this prompt on the first run:

> Read `AGENTS.md`, `PROJECT.md`, `docs/CURRENT_STATE.md`, `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/DEVELOPMENT_GIT.md`, and `docs/DECISIONS.md` in full.
>
> Before coding, run a short discovery of my vision. Ask at most 10 genuinely important questions, in no more than two groups. Prioritize decisions that change the product or architecture: Discord UX, project lifecycle, Git, harnesses, authentication, permissions/security, and behavior after restart. Do not ask me reversible technical details that you can choose cleanly yourself.
>
> After my answers, summarize the decisions, flag only blocking ambiguities, then update `PROJECT.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, and `docs/CURRENT_STATE.md` when necessary.
>
> Then propose the first small vertical MVP milestone with acceptance criteria and a validation plan. Wait for my approval of the plan before starting the first meaningful implementation.
>
> Once the plan is approved, work according to `AGENTS.md` and use the subagents in `.pi/agents/` only when they provide real value. Avoid unnecessary delegation.

## Git discipline during development

Pi must treat `docs/DEVELOPMENT_GIT.md` as mandatory. For every meaningful task: inspect Git state, preserve existing changes, work on a dedicated branch when appropriate, keep the diff coherent, run validation, review the diff, create a clean local commit once the task is validated, then report branch/commit/working-tree state. No remote or destructive Git action is allowed without my explicit authorization.
