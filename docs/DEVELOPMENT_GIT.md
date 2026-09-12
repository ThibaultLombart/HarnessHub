# Git Workflow — HarnessHub Development

This document defines how Pi and its subagents must use Git **while developing HarnessHub**. It complements `AGENTS.md` and `docs/DEFINITION_OF_DONE.md`.

## 1. Goals

The Git workflow must:

- preserve all existing user work;
- keep `main` stable and readable;
- make every task easy to review, test, and revert;
- prevent commits that mix unrelated concerns;
- produce a useful history rather than opaque snapshots;
- prohibit unauthorized destructive or remote operations.

## 2. Before every meaningful task

The agent must inspect at minimum:

```bash
git status --short --branch
git branch --show-current
git remote -v
```

It must identify:

- the current branch;
- the expected base branch;
- existing tracked and untracked changes;
- conflicts or special Git states;
- whether existing changes belong to the current task.

### Already-modified working tree

Never:

- delete user changes;
- use `reset --hard` to obtain a clean state;
- run `git clean`;
- automatically stash unknown changes;
- rewrite unrelated files merely to make the diff cleaner.

If pre-existing changes may conflict with the task, report that before performing risky edits. If they are clearly unrelated and do not block the work, leave them untouched.

## 3. Branches

For meaningful changes, work on a dedicated branch unless:

- the task is only the repository's initial bootstrap;
- the user explicitly asked to work on the current branch;
- the work is already on an appropriate dedicated branch.

Recommended convention:

```text
feat/<slug>
fix/<slug>
refactor/<slug>
test/<slug>
docs/<slug>
chore/<slug>
```

Examples:

```text
feat/discord-bootstrap
feat/project-creation
fix/sqlite-recovery
chore/ci-foundation
```

A branch must represent one coherent intent. Do not use one branch as a catch-all for multiple independent milestones.

## 4. Commits

Local commits are allowed for a validated task unless the user says otherwise.

A commit must:

- represent one coherent, reviewable change;
- contain only files required for its intent;
- include associated tests when that makes the commit self-contained;
- avoid unrelated formatting changes;
- never contain secrets, credentials, or accidental local artifacts;
- be created only after the relevant task validation succeeds.

Recommended format: Conventional Commits.

```text
feat(discord): bootstrap workspace channels
fix(projects): rollback partial project creation
refactor(pi): isolate rpc process lifecycle
test(git): cover dirty working tree handling
docs: record adapter capability decision
```

Avoid messages such as:

```text
update
fix stuff
wip
changes
final
```

A commit is not validation evidence. Commands that were actually executed must still be reported.

## 5. Diff and review before closing a task

Before a task is considered complete, the primary agent or reviewer must inspect:

```bash
git status --short
git diff --check
git diff --stat
```

If the task already contains commits on a dedicated branch, also inspect the diff against the base branch, for example:

```bash
git diff <base>...HEAD
```

The review must verify:

- no out-of-scope files or changes;
- no secrets;
- no temporary debug code;
- no accidental generated files;
- consistency between code, tests, and documentation;
- no unexplained massive change;
- an understandable final Git state.

## 6. Remote operations

By default, Pi may work locally and create local commits.

Without explicit user authorization, it must not:

- run `git push`;
- create or modify a Pull Request;
- merge a remote branch;
- create/delete/modify a remote;
- create or delete a GitHub/GitLab repository;
- publish a release or remote tag.

Authorization for one specific operation does not grant permanent blanket authorization.

## 7. Prohibited operations or operations requiring explicit approval

Never silently execute:

```text
git reset --hard
git clean -f / -fd / -fdx
git push --force
git push --force-with-lease
git branch -D
git checkout -- <path>
git restore --source ...
rebase of already-published history
deleting tags/remotes
```

If one is genuinely necessary, explain:

1. why;
2. what will be lost or rewritten;
3. the non-destructive alternative that was considered;
4. then wait for explicit user approval.

## 8. Conflicts

Never resolve conflicts with a blind global “take ours/theirs everywhere” strategy.

For every conflict:

- understand the intent of both sides;
- preserve unrelated user changes;
- resolve file by file;
- re-run affected tests;
- report any non-obvious semantic decision.

## 9. Files that must never be committed

At minimum:

- secrets and tokens;
- real `.env` files;
- Discord/GitHub/GitLab/provider credentials;
- local caches;
- local runtime databases;
- runtime logs;
- temporary files;
- build artifacts not required by the repository.

`.gitignore` must evolve when a new tool introduces recurring local artifacts.

## 10. Expected final Git state for a task

The final report must include:

```text
Branch: <branch>
Commit(s): <hash/message or "not committed">
Working tree: clean | dirty (with reason)
Remote actions: none | explicit details
Validation: commands actually executed
```

A task must not be announced as complete when:

- out-of-scope changes are mixed into the diff;
- the working tree contains accidental artifacts;
- a Git conflict remains unresolved;
- the diff was not reviewed;
- a commit contains a secret or unwanted local file.

## 11. Simplicity principle

Do not turn every tiny edit into unnecessary Git ceremony. The goal is safe, readable history.

For a normal task:

```text
inspect -> branch when needed -> edit -> test -> review diff -> coherent local commit -> report
```

For riskier or parallel work, the orchestrator may propose a worktree, but worktrees are not mandatory for HarnessHub's MVP development workflow.
