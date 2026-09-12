# Current State

## Status

**Pre-implementation / discovery complete / implementation plan awaiting approval.**

## Existing material

- initial vision in `PROJECT.md`;
- quality contract in `AGENTS.md`;
- MVP roadmap;
- initial threat model;
- Pi configuration with 5 lightweight agents;
- mandatory Git development workflow;
- confirmed MVP decisions recorded in `PROJECT.md` and `docs/DECISIONS.md`.

## Confirmed scope

- personal use on one non-root Linux VM managed by systemd;
- one Discord guild and one administrator;
- empty project creation plus secure HTTPS/SSH repository cloning;
- automatic Git initialization for empty projects;
- Pi using pre-existing native service-account authentication and its default model;
- ordinary authorized project-channel messages as prompts, with one active execution;
- skills, MCP, uploads, model selection, Discord-assisted login, and provider repository management deferred until after the first complete loop.

## Not validated yet

- exact runtime and dependency versions;
- actual code structure and integration contracts;
- Discord behavior against the real API;
- Pi RPC vs SDK choice after a spike;
- systemd installation on a real Linux host.

## Next step

1. obtain approval for the proposed M0 implementation plan;
2. implement M0 as small, reviewable tasks using TDD where applicable;
3. independently review and validate M0 before proceeding to Discord integration.

Do not write production code or mark a milestone complete without approval and real validation that satisfies `AGENTS.md`.
