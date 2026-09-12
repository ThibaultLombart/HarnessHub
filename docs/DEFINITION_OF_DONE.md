# Definition of Done — HarnessHub

`AGENTS.md` remains the general authority. This checklist adds HarnessHub-specific requirements.

A task is complete only when:

- observable acceptance criteria are satisfied;
- appropriate tests were actually executed;
- applicable format/lint/typecheck/build checks pass;
- relevant errors and edge cases are covered;
- no Discord/user input is dangerously interpolated into a shell command or path;
- no secret appears in logs/tests/fixtures;
- persistent operations remain coherent after reasonable partial failures;
- the change does not introduce direct harness coupling outside its adapter;
- state/decision documentation is updated only when reality changed;
- independent review has no unresolved BLOCKER or MAJOR findings;
- validations that could not be executed are explicitly declared.

For changes involving auth, processes, filesystem, uploads, archives, remote Git, installation, external skills, MCP, or Discord permissions: a security review is required.

## Git

In addition to the criteria above, a development task is complete only when:

- `docs/DEVELOPMENT_GIT.md` was followed;
- initial Git state was inspected and pre-existing changes were preserved;
- the final diff was reviewed and `git diff --check` reports no errors;
- no out-of-scope file, secret, log, or accidental local artifact is included;
- any commits are coherent, explicit, and do not mix unrelated intentions;
- no Git conflict remains unresolved;
- no remote or destructive Git action occurred without explicit authorization;
- the final report includes branch, commits, working-tree state, and remote actions.

Passing tests do not compensate for a dirty or dangerous Git diff.
